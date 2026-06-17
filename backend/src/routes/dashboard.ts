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
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");

  const rawResults = await Promise.all([
    // in_stock count
    db.execute(sql`
      SELECT COUNT(*) as count FROM serial_numbers sn
      WHERE sn.status = 'in_stock'
        AND sn.id NOT IN (
          SELECT ti.serial_id FROM transfer_items ti
          JOIN transfers t ON t.id = ti.transfer_id
          WHERE t.status = 'in_transit' AND ti.serial_id IS NOT NULL
        )
    `),
    // in_transit count (serials on in_transit transfers)
    db.execute(sql`
      SELECT COUNT(*) as count FROM serial_numbers sn
      WHERE sn.status = 'transferred'
    `),
    // overdue count (transfers in draft/booked/packed for >3 days)
    db.execute(sql`
      SELECT COUNT(*) as count FROM transfers
      WHERE status IN ('draft', 'booked', 'packed')
        AND created_at < ${threeDaysAgo}
    `),
    // pipeline aggregation
    db.execute(sql`
      SELECT status, COUNT(*) as count,
        SUM(CASE WHEN created_at < ${threeDaysAgo} THEN 1 ELSE 0 END) as overdueCount
      FROM transfers
      WHERE status IN ('draft', 'booked', 'packed', 'in_transit')
      GROUP BY status
    `),
    // recent activity
    db.execute(sql`
      SELECT al.id, al.action, al.note, al.created_at AS createdAt
      FROM audit_logs al
      ORDER BY al.created_at DESC LIMIT 20
    `),
    // stock_in this week
    db.execute(sql`
      SELECT COUNT(*) as count FROM serial_numbers sn
      WHERE sn.status = 'in_stock' AND sn.stock_in_at >= ${sevenDaysAgo}
        AND sn.id NOT IN (
          SELECT ti.serial_id FROM transfer_items ti
          JOIN transfers t ON t.id = ti.transfer_id
          WHERE t.status = 'in_transit' AND ti.serial_id IS NOT NULL
        )
    `),
    // pending corrections
    db.execute(sql`
      SELECT COUNT(*) as count FROM serial_corrections sc
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_logs al WHERE al.entity_type = 'serial_number'
        AND al.entity_id = sc.serial_id AND al.note LIKE '%correction%'
      )
    `),
    // top parts this week (from audit logs for stock transfers)
    db.execute(sql`
      SELECT p.part_number, p.part_name, COUNT(*) as movement
      FROM audit_logs al
      JOIN transfer_items ti ON ti.id = al.entity_id
      JOIN parts p ON p.id = ti.part_id
      WHERE al.action = 'update' AND al.created_at >= ${sevenDaysAgo}
      GROUP BY p.id ORDER BY movement DESC LIMIT 5
    `),
  ]);

  const inStockRows = (rawResults[0] as any[])[0] as any[];
  const inTransitRows = (rawResults[1] as any[])[0] as any[];
  const overdueRows = (rawResults[2] as any[])[0] as any[];
  const pipelineRows = (rawResults[3] as any[])[0] as any[];
  const activityRows = (rawResults[4] as any[])[0] as any[];
  const weekStockRows = (rawResults[5] as any[])[0] as any[];
  const correctionRows = (rawResults[6] as any[])[0] as any[];
  const topPartsRows = (rawResults[7] as any[])[0] as any[];

  const metrics = {
    inStock: Number(inStockRows?.[0]?.count ?? 0),
    inTransit: Number(inTransitRows?.[0]?.count ?? 0),
    overdue: Number(overdueRows?.[0]?.count ?? 0),
  };

  const pipeline = (pipelineRows ?? []).map((r: any) => ({
    status: r.status,
    count: Number(r.count ?? 0),
    overdueCount: Number(r.overdueCount ?? 0),
  }));

  const activity: any[] = [];
  for (const a of (activityRows ?? [])) {
    const label = a.note ?? a.action;
    let type = "transfer_dispatched";
    if (a.action === "stock_in" || (a.note ?? "").includes("stock")) type = "stock_in";
    else if ((a.note ?? "").includes("correction")) type = "correction";
    else if ((a.note ?? "").includes("received")) type = "transfer_received";
    else if ((a.note ?? "").includes("Dispatched")) type = "transfer_dispatched";
    activity.push({ id: a.id, type, label, time: a.createdAt });
  }

  const stockInThisWeek = Number(weekStockRows?.[0]?.count ?? 0);
  const pendingCorrections = Number(correctionRows?.[0]?.count ?? 0);

  const topParts = (topPartsRows ?? []).map((p: any) => ({
    part_number: p.part_number,
    part_name: p.part_name,
    movement: Number(p.movement ?? 0),
  }));

  res.json({ metrics, pipeline, activity, stockInThisWeek, pendingCorrections, topParts });
});
