import { Router } from "express";
import { getDb } from "../db/connection";
import { sites } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const sitesRouter = Router();

sitesRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const isActive = req.query.is_active !== "false";
  const isDc = req.query.is_dc;

  let conditions = eq(sites.isActive, isActive);
  if (isDc === "true") conditions = and(conditions, eq(sites.isDc, true))!;
  if (isDc === "false") conditions = and(conditions, eq(sites.isDc, false))!;

  const rows = await db.query.sites.findMany({
    where: conditions,
    orderBy: [sites.siteName],
  });
  res.json(rows);
});

sitesRouter.get("/dc", authMiddleware, async (req, res) => {
  const db = await getDb();
  const site = await db.query.sites.findFirst({
    where: and(eq(sites.isDc, true), eq(sites.isActive, true)),
  });
  res.json(site ?? null);
});

sitesRouter.get("/by-code/:code", authMiddleware, async (req, res) => {
  const db = await getDb();
  const site = await db.query.sites.findFirst({
    where: eq(sites.siteCode, req.params.code),
  });
  res.json(site ?? null);
});

sitesRouter.get("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, req.params.id),
  });
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  res.json(site);
});

sitesRouter.put("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  await db.update(sites).set(req.body).where(eq(sites.id, req.params.id));
  res.json({ ok: true });
});
