import { Router } from "express";
import { getDb } from "../db/connection";
import { parts, serialNumbers } from "../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const inventoryRouter = Router();

inventoryRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 200);
  const segment = (req.query.segment as string) || "all";
  const q = (req.query.q as string)?.trim();

  const allParts = await db.query.parts.findMany({
    where: eq(parts.isActive, true),
    orderBy: [parts.partName],
    limit: 10000,
  });

  // ── Fetch all serial numbers and their actual statuses ──
  // stockedOut is now derived from the serial's actual status, NOT from transfer_items,
  // to avoid double-counting serials that were received (status returned to in_stock).
  const [activeTransfersRes, transferItemsRes, reservedItemsRes, inTransitSerialsRes, serialsRes] = await Promise.all([
    db.execute(sql`
      SELECT t.id, t.created_at, t.packed_at, t.status
      FROM transfers t
      WHERE t.status IN ('in_transit', 'received')
      ORDER BY t.created_at DESC LIMIT 1500
    `),
    db.execute(sql`
      SELECT ti.transfer_id, ti.part_id, ti.serial_id, ti.qty
      FROM transfer_items ti
      JOIN transfers t ON t.id = ti.transfer_id
      WHERE t.status IN ('in_transit', 'received')
      LIMIT 10000
    `),
    db.execute(sql`
      SELECT ti.transfer_id, ti.part_id, ti.serial_id, t.status AS transferStatus
      FROM transfer_items ti
      JOIN transfers t ON t.id = ti.transfer_id
      WHERE t.status IN ('draft', 'packed', 'in_transit')
      LIMIT 10000
    `),
    db.execute(sql`
      SELECT ti.serial_id
      FROM transfer_items ti
      JOIN transfers t ON t.id = ti.transfer_id
      WHERE t.status IN ('in_transit')
        AND ti.serial_id IS NOT NULL
      LIMIT 10000
    `),
    db.execute(sql`
      SELECT sn.id, sn.part_id AS partId, sn.status, sn.stock_in_at AS stockInAt
      FROM serial_numbers sn
      ORDER BY sn.stock_in_at DESC
      LIMIT 50000
    `),
  ]);

  const activeTransfersRows = (activeTransfersRes as unknown as any[])[0] ?? [];
  const transferItemsRows = (transferItemsRes as unknown as any[])[0] ?? [];
  const reservedItemsRows = (reservedItemsRes as unknown as any[])[0] ?? [];
  const inTransitSerialsRows = (inTransitSerialsRes as unknown as any[])[0] ?? [];
  const serialsRows = (serialsRes as unknown as any[])[0] ?? [];

  const inTransitSerialIds = new Set<string>(inTransitSerialsRows.map((r: any) => r.serial_id));

  const itemsByTransfer = new Map<string, any[]>();
  for (const item of transferItemsRows) {
    if (!itemsByTransfer.has(item.transfer_id)) {
      itemsByTransfer.set(item.transfer_id, []);
    }
    itemsByTransfer.get(item.transfer_id)!.push(item);
  }

  const byPart = new Map<string, {
    partId: string; partName: string; partNumber: string; category: string;
    partType: string; inStock: number; stockedOut: number;
    reserved: number; reservedForAvailable: number; available: number;
    lastStockInAt: string | null; lastStockOutAt: string | null;
  }>();

  for (const p of allParts) {
    byPart.set(p.id, {
      partId: p.id,
      partName: p.partName,
      partNumber: p.partNumber,
      category: p.category ?? "Uncategorized",
      partType: p.partType === "product" || p.partType === "material" ? p.partType : "unknown",
      inStock: 0, stockedOut: 0, reserved: 0, reservedForAvailable: 0, available: 0,
      lastStockInAt: null, lastStockOutAt: null,
    });
  }

  // ── Count inStock and stockedOut from ACTUAL serial status ──
  // This is the single source of truth — the serial_numbers.status column.
  for (const s of serialsRows) {
    const entry = byPart.get(s.partId);
    if (!entry) continue;

    if (s.status === "in_stock" && !inTransitSerialIds.has(s.id)) {
      entry.inStock++;
    } else if (["transferred", "consumed", "void"].includes(s.status)) {
      // Truly stocked out — the serial is no longer available
      entry.stockedOut++;
    } else if (s.status === "in_stock" && inTransitSerialIds.has(s.id)) {
      // in_stock but currently in an in_transit transfer — count as stocked out (in transit)
      entry.stockedOut++;
    }

    const stockInAt = s.stockInAt ? new Date(s.stockInAt).toISOString() : null;
    if (stockInAt && (!entry.lastStockInAt || stockInAt > entry.lastStockInAt)) {
      entry.lastStockInAt = stockInAt;
    }
  }

  // ── Derive lastStockOutAt from transfer dates (for display only) ──
  for (const t of activeTransfersRows) {
    const stkOutAt = t.packed_at ?? t.created_at;
    const items = itemsByTransfer.get(t.id) ?? [];
    for (const item of items) {
      const entry = byPart.get(item.part_id);
      if (!entry) continue;
      const outAt = stkOutAt ? new Date(stkOutAt).toISOString() : null;
      if (outAt && (!entry.lastStockOutAt || outAt > entry.lastStockOutAt)) {
        entry.lastStockOutAt = outAt;
      }
    }
  }

  const reservedSerialKeys = new Set<string>();
  const draftPackedReservedKeys = new Set<string>();
  for (const item of reservedItemsRows) {
    if (!item.part_id || !item.serial_id) continue;
    const key = `${item.part_id}:${item.serial_id}`;
    if (reservedSerialKeys.has(key)) continue;
    reservedSerialKeys.add(key);
    const entry = byPart.get(item.part_id);
    if (entry) entry.reserved++;
    // Track draft/packed separately for available calculation
    if (item.transferStatus === 'draft' || item.transferStatus === 'packed') {
      if (!draftPackedReservedKeys.has(key)) {
        draftPackedReservedKeys.add(key);
        if (entry) entry.reservedForAvailable = (entry.reservedForAvailable ?? 0) + 1;
      }
    }
  }

  for (const entry of byPart.values()) {
    const draftPackedReserved = entry.reservedForAvailable ?? 0;
    entry.available = Math.max(entry.inStock - draftPackedReserved, 0);
  }

  let rows = Array.from(byPart.values())
    .filter((r) => r.lastStockInAt !== null)
    .sort((a, b) => a.partName.localeCompare(b.partName));

  if (segment === "in_stock") rows = rows.filter((r) => r.inStock > 0);
  if (segment === "stocked_out") rows = rows.filter((r) => r.stockedOut > 0);

  if (q) {
    const lq = q.toLowerCase();
    rows = rows.filter(
      (r) => r.partName.toLowerCase().includes(lq) ||
             r.partNumber.toLowerCase().includes(lq) ||
             r.category.toLowerCase().includes(lq),
    );
  }

  const total = rows.length;
  rows = rows.slice(page * pageSize, (page + 1) * pageSize);

  res.json({ rows, total, source: "mysql" });
});

inventoryRouter.get("/site", authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT
      sn.current_site_id AS currentSiteId,
      s.site_name AS siteName, s.site_code AS siteCode,
      p.part_name AS partName, p.part_number AS partNumber
    FROM serial_numbers sn
    LEFT JOIN parts p ON p.id = sn.part_id
    LEFT JOIN sites s ON s.id = sn.current_site_id
    WHERE sn.status = 'transferred'
    ORDER BY s.site_name, p.part_name
    LIMIT 10000
  `);
  const rows = (result as unknown as any[])[0] ?? [];

  const grouped = new Map<string, any>();
  for (const r of rows) {
    const key = `${r.currentSiteId}:${r.partNumber}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        current_site_id: r.currentSiteId,
        qty: 0,
        sites: [{ siteName: r.siteName, siteCode: r.siteCode }],
        parts: [{ partName: r.partName, partNumber: r.partNumber }],
      });
    }
    grouped.get(key)!.qty++;
  }

  res.json(Array.from(grouped.values()));
});

inventoryRouter.get("/site/:siteId", authMiddleware, async (req, res) => {
  const db = await getDb();
  const [inTransitRes, result] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ti.serial_id AS id FROM transfer_items ti
      JOIN transfers t ON t.id = ti.transfer_id
      WHERE t.destination_site_id = ${req.params.siteId} AND t.status = 'in_transit' AND ti.serial_id IS NOT NULL
    `),
    db.execute(sql`
      SELECT
        sn.current_site_id AS currentSiteId,
        p.part_name AS partName, p.part_number AS partNumber,
        s.site_name AS siteName, s.site_code AS siteCode
      FROM serial_numbers sn
      LEFT JOIN parts p ON p.id = sn.part_id
      LEFT JOIN sites s ON s.id = sn.current_site_id
      WHERE sn.current_site_id = ${req.params.siteId}
        AND sn.status = 'transferred'
      ORDER BY sn.stock_in_at DESC
      LIMIT 5000
    `),
  ]);
  const serials = (result as unknown as any[])[0] ?? [];

  const grouped = new Map<string, any>();
  for (const s of serials) {
    const key = `${s.siteCode}:${s.partNumber}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        current_site_id: s.currentSiteId,
        qty: 0,
        sites: [{ siteName: s.siteName, siteCode: s.siteCode }],
        parts: [{ partName: s.partName, partNumber: s.partNumber }],
      });
    }
    grouped.get(key)!.qty++;
  }

  res.json(Array.from(grouped.values()));
});

// ── Discrepancy Check ─────────────────────────────────────────────
// Finds serials with conflicting states: e.g. serial is in_stock but
// also appears on an active transfer, or serial is transferred but no
// matching transfer exists.
inventoryRouter.get("/discrepancies", authMiddleware, async (req, res) => {
  const db = await getDb();

  // 1. Serials that are in_stock but appear on an in_transit/received transfer
  const [inStockOnTransferRes] = await db.execute(sql`
    SELECT
      sn.serial_number AS serialNumber,
      sn.status AS serialStatus,
      p.part_number AS partNumber,
      p.part_name AS partName,
      t.transfer_no AS transferNo,
      t.status AS transferStatus,
      s.site_name AS currentSite
    FROM serial_numbers sn
    JOIN transfer_items ti ON ti.serial_id = sn.id
    JOIN transfers t ON t.id = ti.transfer_id
    JOIN parts p ON p.id = sn.part_id
    LEFT JOIN sites s ON s.id = sn.current_site_id
    WHERE sn.status = 'in_stock'
      AND t.status IN ('in_transit', 'received')
    ORDER BY sn.serial_number
    LIMIT 500
  `);

  // 2. Serials that appear on multiple active transfers (draft/packed/in_transit)
  const [duplicateTransferRes] = await db.execute(sql`
    SELECT
      sn.serial_number AS serialNumber,
      sn.status AS serialStatus,
      p.part_number AS partNumber,
      p.part_name AS partName,
      GROUP_CONCAT(DISTINCT t.transfer_no ORDER BY t.created_at SEPARATOR ', ') AS transferNos,
      COUNT(DISTINCT t.id) AS transferCount
    FROM serial_numbers sn
    JOIN transfer_items ti ON ti.serial_id = sn.id
    JOIN transfers t ON t.id = ti.transfer_id
    JOIN parts p ON p.id = sn.part_id
    WHERE t.status IN ('draft', 'packed', 'in_transit')
    GROUP BY sn.id, sn.serial_number, sn.status, p.part_number, p.part_name
    HAVING COUNT(DISTINCT t.id) > 1
    ORDER BY sn.serial_number
    LIMIT 500
  `);

  const inStockOnTransfer = (inStockOnTransferRes as unknown as any[]) ?? [];
  const duplicateTransfers = (duplicateTransferRes as unknown as any[]) ?? [];

  const discrepancies: Array<{
    serialNumber: string;
    partNumber: string;
    partName: string;
    issue: string;
    detail: string;
  }> = [];

  for (const r of inStockOnTransfer) {
    discrepancies.push({
      serialNumber: r.serialNumber,
      partNumber: r.partNumber,
      partName: r.partName,
      issue: "in_stock_on_active_transfer",
      detail: `Serial is "${r.serialStatus}" at ${r.currentSite} but appears on transfer ${r.transferNo} (${r.transferStatus})`,
    });
  }

  for (const r of duplicateTransfers) {
    discrepancies.push({
      serialNumber: r.serialNumber,
      partNumber: r.partNumber,
      partName: r.partName,
      issue: "duplicate_across_transfers",
      detail: `Serial appears on ${r.transferCount} active transfers: ${r.transferNos}`,
    });
  }

  res.json({ discrepancies, total: discrepancies.length });
});

