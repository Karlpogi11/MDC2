import { Router } from "express";
import { getDb } from "../db/connection";
import { parts, serialNumbers, transfers, transferItems, sites } from "../db/schema";
import { eq, and, inArray, like, desc, sql } from "drizzle-orm";
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

  const activeTransfers = await db.query.transfers.findMany({
    columns: { createdAt: true, packedAt: true, status: true },
    where: inArray(transfers.status, ["packed", "in_transit", "received"]),
    limit: 1500,
    with: { items: { columns: { partId: true } } },
  });

  const reservedItems = await db.query.transferItems.findMany({
    columns: { partId: true, serialId: true, qty: true },
    where: inArray(transfers.status, ["draft", "packed"]),
    limit: 10000,
    with: { transfer: { columns: { status: true } } },
  });

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

  for (const t of activeTransfers) {
    const stkOutAt = t.packedAt ?? t.createdAt;
    for (const item of t.items) {
      const entry = byPart.get(item.partId);
      if (!entry) continue;
      const outAt = stkOutAt ? new Date(stkOutAt).toISOString() : null;
      if (outAt && (!entry.lastStockOutAt || outAt > entry.lastStockOutAt)) {
        entry.lastStockOutAt = outAt;
      }
    }
  }

  const reservedSerialKeys = new Set<string>();
  for (const item of reservedItems) {
    if (!item.partId || !item.serialId) continue;
    if (item.transfer?.status !== "draft" && item.transfer?.status !== "packed") continue;
    const key = `${item.partId}:${item.serialId}`;
    if (reservedSerialKeys.has(key)) continue;
    reservedSerialKeys.add(key);
    const entry = byPart.get(item.partId);
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
  const serials = await db.query.serialNumbers.findMany({
    where: and(
      eq(serialNumbers.currentSiteId, req.params.siteId),
      eq(serialNumbers.status, "transferred"),
    ),
    limit: 5000,
    with: {
      part: { columns: { partName: true, partNumber: true } },
      site: { columns: { siteName: true, siteCode: true } },
    },
  });

  const grouped = new Map<string, any>();
  for (const s of serials) {
    const key = `${s.site?.siteCode}:${s.part?.partNumber}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        siteId: req.params.siteId,
        siteName: s.site?.siteName,
        siteCode: s.site?.siteCode,
        partName: s.part?.partName,
        partNumber: s.part?.partNumber,
        qty: 0,
      });
    }
    grouped.get(key)!.qty++;
  }

  res.json(Array.from(grouped.values()));
});
