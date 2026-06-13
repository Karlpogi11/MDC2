import { Router } from "express";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { queryString } from "../utils/query";

export const dashboardRouter = Router();

dashboardRouter.get("/search", authMiddleware, async (req, res) => {
  const db = await getDb();
  const term = queryString(req.query.q)?.trim();
  if (!term) { res.json([]); return; }

  const rawResults = await Promise.all([
    db.execute(sql`SELECT sn.serial_number, p.part_name FROM serial_numbers sn LEFT JOIN parts p ON p.id = sn.part_id WHERE sn.serial_number LIKE ${`%${term}%`} LIMIT 4`),
    db.execute(sql`SELECT id, part_number, part_name FROM parts WHERE part_number LIKE ${`%${term}%`} OR part_name LIKE ${`%${term}%`} LIMIT 4`),
    db.execute(sql`SELECT id, transfer_no, status FROM transfers WHERE transfer_no LIKE ${`%${term}%`} LIMIT 3`),
  ]);

  const results: Array<{ type: string; label: string; sub: string; path: string }> = [];
  const sRows = (rawResults[0] as any[])[0] ?? [];
  for (const s of sRows) {
    results.push({ type: "serial", label: s.serial_number, sub: s.part_name ?? "", path: `/inventory?serial=${s.serial_number}` });
  }
  const pRows = (rawResults[1] as any[])[0] ?? [];
  for (const p of pRows) {
    results.push({ type: "part", label: p.part_number, sub: p.part_name, path: `/inventory?q=${p.part_number}` });
  }
  const tRows = (rawResults[2] as any[])[0] ?? [];
  for (const t of tRows) {
    results.push({ type: "transfer", label: t.transfer_no, sub: t.status, path: `/transfers/${t.id}` });
  }

  res.json(results);
});

dashboardRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");

  const rawResults = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'in_stock'`),
    db.execute(sql`SELECT t.id, t.transfer_no, t.status, t.packed_at, t.created_at, s.site_name as dest_site_name
      FROM transfers t LEFT JOIN sites s ON s.id = t.destination_site_id
      WHERE t.status IN ('draft', 'packed', 'in_transit')
      ORDER BY t.created_at DESC LIMIT 200`),
    db.execute(sql`SELECT * FROM stock_in_batches ORDER BY imported_at DESC LIMIT 5`),
    db.execute(sql`SELECT * FROM serial_corrections ORDER BY corrected_at DESC LIMIT 5`),
    db.execute(sql`SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'in_stock' AND stock_in_at >= ${sevenDaysAgo}`),
  ]);

  const inStockRows = (rawResults[0] as any[])[0] as any[];
  const pipelineRows = (rawResults[1] as any[])[0] as any[];
  const batchRows = (rawResults[2] as any[])[0] as any[];
  const correctionRows = (rawResults[3] as any[])[0] as any[];
  const weekStockRows = (rawResults[4] as any[])[0] as any[];

  const metrics = {
    inStock: Number(inStockRows?.[0]?.count ?? 0),
    stockInThisWeek: Number(weekStockRows?.[0]?.count ?? 0),
  };

  const pipeline = (pipelineRows ?? []).map((t: any) => ({
    id: t.id,
    transferNo: t.transfer_no,
    status: t.status,
    createdAt: t.created_at,
    destinationSite: t.dest_site_name ? { siteName: t.dest_site_name } : null,
  }));

  res.json({ metrics, pipeline, recentBatches: batchRows ?? [], recentCorrections: correctionRows ?? [], topParts: [] });
});
