import { Router } from "express";
import { getDb } from "../db/connection";
import { authMiddleware } from "../middleware/auth";
import { sql } from "drizzle-orm";

export const analyticsRouter = Router();

analyticsRouter.get("/dc-activity", authMiddleware, async (req, res) => {
  const db = await getDb();

  const rawResults = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'in_stock'`),
    db.execute(sql`SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'transferred'`),
    db.execute(sql`SELECT COALESCE(SUM(available), 0) as available FROM inventory_snapshot`),
  ]);

  const stockedInRows = (rawResults[0] as any[])[0] as any[];
  const transferredRows = (rawResults[1] as any[])[0] as any[];

  res.json({
    kpi: {
      totalStockedIn: Number(stockedInRows?.[0]?.count ?? 0),
      totalStockedOut: Number(transferredRows?.[0]?.count ?? 0),
    },
    monthly: [],
    topParts: [],
    bySite: [],
    statusBreakdown: [],
  });
});

analyticsRouter.get("/uploads", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.analyticsUploads.findMany({
    orderBy: [sql`uploaded_at DESC`],
    limit: 20,
  });
  res.json(rows);
});

analyticsRouter.get("/demand", authMiddleware, async (req, res) => {
  res.json({ kpi: {}, monthly: [], topParts: [], bySite: [], isFiltered: false });
});
