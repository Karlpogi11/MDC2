import { Router } from "express";
import { getDb } from "../db/connection";
import { parts } from "../db/schema";
import { eq, and, like, or, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const partsRouter = Router();

partsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const q = (req.query.q as string)?.trim();
  const isActive = req.query.is_active !== "false";
  const limit = Math.min(parseInt(req.query.limit as string) || 10000, 10000);

  let conditions = eq(parts.isActive, isActive);
  if (q) {
    conditions = and(
      conditions,
      or(
        like(parts.partNumber, `%${q}%`),
        like(parts.partName, `%${q}%`),
      ),
    )!;
  }

  const rows = await db.query.parts.findMany({
    where: conditions,
    orderBy: [parts.partName],
    limit,
  });
  res.json(rows);
});

partsRouter.get("/search", authMiddleware, async (req, res) => {
  const db = await getDb();
  const q = (req.query.q as string)?.trim();
  if (!q) { res.json([]); return; }

  const rows = await db.query.parts.findMany({
    where: and(
      eq(parts.isActive, true),
      or(
        like(parts.partNumber, `%${q}%`),
        like(parts.partName, `%${q}%`),
      ),
    ),
    limit: 8,
  });
  res.json(rows);
});

partsRouter.get("/:partNumber", authMiddleware, async (req, res) => {
  const db = await getDb();
  const part = await db.query.parts.findFirst({
    where: eq(parts.partNumber, req.params.partNumber),
  });
  res.json(part ?? null);
});

partsRouter.put("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  await db.update(parts).set(req.body).where(eq(parts.id, req.params.id));
  res.json({ ok: true });
});
