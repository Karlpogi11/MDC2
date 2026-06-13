import { Router } from "express";
import { getDb } from "../db/connection";
import { appConfig, featureFlags } from "../db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const configRouter = Router();

configRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.appConfig.findMany();
  const config: Record<string, string> = {};
  for (const row of rows) {
    if (row.value) config[row.key] = row.value;
  }
  res.json(config);
});

configRouter.get("/flags", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.featureFlags.findMany();
  res.json(rows);
});

configRouter.put("/:key", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { value } = req.body;
  await db.insert(appConfig)
    .values({ key: req.params.key, value, updatedBy: req.user!.id, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: req.user!.id, updatedAt: new Date() } });
  res.json({ ok: true });
});
