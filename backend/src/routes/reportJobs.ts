import { Router } from "express";
import { getDb } from "../db/connection";
import { reportJobs } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";

export const reportJobsRouter = Router();

reportJobsRouter.get("/", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  const rows = await db.query.reportJobs.findMany({ orderBy: [desc(reportJobs.createdAt)] });
  res.json(rows);
});

reportJobsRouter.post("/", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(reportJobs).values({ ...req.body, id, createdBy: req.user!.id });
  res.json({ id });
});

reportJobsRouter.put("/:id/toggle", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  await db.update(reportJobs).set({ isActive: req.body.isActive }).where(eq(reportJobs.id, req.params.id));
  res.json({ ok: true });
});
