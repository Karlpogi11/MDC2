import { Router } from "express";
import { getDb } from "../db/connection";
import { analyticsUploads, analyticsRows } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { eq, sql } from "drizzle-orm";
import { queryString } from "../utils/query";

export const analyticsRouter = Router();

analyticsRouter.get("/dc-activity", authMiddleware, async (req, res) => {
  const db = await getDb();

  const rawResults = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'in_stock'`),
    db.execute(sql`SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'transferred'`),
  ]);

  const stockedInRows = (rawResults[0] as any[])[0] as any[];
  const transferredRows = (rawResults[1] as any[])[0] as any[];

  const totalAvailable = Number(stockedInRows?.[0]?.count ?? 0);
  const totalCommitted = Number(transferredRows?.[0]?.count ?? 0);

  res.json({
    kpi: {
      totalStockedIn: totalAvailable,
      totalStockedOut: totalCommitted,
      totalTransfers: 0,
      receivedRate: 0,
      totalAvailable,
      totalCommitted,
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
  res.json({ kpi: { totalRepairs: 0, uniqueParts: 0, topSite: null }, monthly: [], topParts: [], bySite: [], isFiltered: false });
});

analyticsRouter.get("/series-list", authMiddleware, async (req, res) => {
  res.json([]);
});

analyticsRouter.get("/abc", authMiddleware, async (req, res) => {
  res.json({ donut: [], rows: [] });
});

analyticsRouter.get("/velocity", authMiddleware, async (req, res) => {
  res.json({ donut: [], rows: [] });
});

analyticsRouter.delete("/uploads/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  await db.delete(analyticsRows).where(eq(analyticsRows.uploadId, id));
  await db.delete(analyticsUploads).where(eq(analyticsUploads.id, id));
  res.json({ ok: true });
});
