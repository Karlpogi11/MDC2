import { Router } from "express";
import { getDb } from "../db/connection";
import { webhooks } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import { queryString } from "../utils/query";

export const webhooksRouter = Router();

webhooksRouter.get("/", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  const rows = await db.query.webhooks.findMany({ orderBy: [desc(webhooks.createdAt)] });
  res.json(rows);
});

webhooksRouter.post("/", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(webhooks).values({ ...req.body, id, createdBy: req.user!.id });
  res.json({ id });
});

webhooksRouter.put("/:id/toggle", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  await db.update(webhooks).set({ isActive: req.body.isActive }).where(eq(webhooks.id, id));
  res.json({ ok: true });
});
