import { Router } from "express";
import { getDb } from "../db/connection";
import { parts, serialNumbers } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
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

  const allSerials = await db.query.serialNumbers.findMany({
    columns: { partId: true, status: true, stockInAt: true },
    orderBy: [desc(serialNumbers.stockInAt)],
    limit: 5000,
  });

  const [activeTransfersRes, transferItemsRes, reservedItemsRes] = await Promise.all([
    db.execute(sql`
      SELECT t.id, t.created_at, t.packed_at, t.status
      FROM transfers t
      WHERE t.status IN ('packed', 'in_transit', 'received')
      ORDER BY t.created_at DESC LIMIT 1500
    `),
    db.execute(sql`
      SELECT ti.transfer_id, ti.part_id
      FROM transfer_items ti
      JOIN transfers t ON t.id = ti.transfer_id
      WHERE t.status IN ('packed', 'in_transit', 'received')
      LIMIT 10000
    `),
    db.execute(sql`
      SELECT ti.transfer_id, ti.part_id, ti.serial_id
      FROM transfer_items ti
      JOIN transfers t ON t.id = ti.transfer_id
      WHERE t.status IN ('draft', 'packed')
      LIMIT 10000
    `),
  ]);

  const activeTransfersRows = (activeTransfersRes as any[])[0] ?? [];
  const transferItemsRows = (transferItemsRes as any[])[0] ?? [];
  const reservedItemsRows = (reservedItemsRes as any[])[0] ?? [];

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
    reserved: number; available: number;
    lastStockInAt: string | null; lastStockOutAt: string | null;
  }>();

  for (const p of allParts) {
    byPart.set(p.id, {
      partId: p.id,
      partName: p.partName,
      partNumber: p.partNumber,
      category: p.category ?? "Uncategorized",
      partType: p.partType === "product" || p.partType === "material" ? p.partType : "unknown",
      inStock: 0, stockedOut: 0, reserved: 0, available: 0,
      lastStockInAt: null, lastStockOutAt: null,
    });
  }

  for (const s of allSerials) {
    const entry = byPart.get(s.partId);
    if (!entry) continue;
    if (s.status === "in_stock") entry.inStock++;
    if (s.status === "transferred") entry.stockedOut++;
    const stockInAt = s.stockInAt ? new Date(s.stockInAt).toISOString() : null;
    if (stockInAt && (!entry.lastStockInAt || stockInAt > entry.lastStockInAt)) {
      entry.lastStockInAt = stockInAt;
    }
  }

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
  for (const item of reservedItemsRows) {
    if (!item.part_id || !item.serial_id) continue;
    const key = `${item.part_id}:${item.serial_id}`;
    if (reservedSerialKeys.has(key)) continue;
    reservedSerialKeys.add(key);
    const entry = byPart.get(item.part_id);
    if (entry) entry.reserved++;
  }

  for (const entry of byPart.values()) {
    entry.available = Math.max(entry.inStock - entry.reserved, 0);
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

inventoryRouter.get("/site/:siteId", authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT
      sn.id, sn.serial_number AS serialNumber, sn.part_id AS partId,
      sn.current_site_id AS currentSiteId, sn.status, sn.stock_in_at AS stockInAt,
      p.part_name AS partName, p.part_number AS partNumber,
      s.site_name AS siteName, s.site_code AS siteCode
    FROM serial_numbers sn
    LEFT JOIN parts p ON p.id = sn.part_id
    LEFT JOIN sites s ON s.id = sn.current_site_id
    WHERE sn.current_site_id = ${req.params.siteId}
      AND sn.status = 'transferred'
    ORDER BY sn.stock_in_at DESC
    LIMIT 5000
  `);
  const serials = (result as any[])[0] ?? [];

  const grouped = new Map<string, any>();
  for (const s of serials) {
    const key = `${s.siteCode}:${s.partNumber}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        siteId: req.params.siteId,
        siteName: s.siteName,
        siteCode: s.siteCode,
        partName: s.partName,
        partNumber: s.partNumber,
        qty: 0,
      });
    }
    grouped.get(key)!.qty++;
  }

  res.json(Array.from(grouped.values()));
});
