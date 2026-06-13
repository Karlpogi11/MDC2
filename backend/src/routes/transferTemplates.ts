import { Router } from "express";
import { getDb } from "../db/connection";
import { transferTemplates, transferTemplateItems, sites, parts } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const transferTemplatesRouter = Router();

transferTemplatesRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.transferTemplates.findMany({
    orderBy: [desc(transferTemplates.createdAt)],
    with: {
      destinationSite: { columns: { siteName: true } },
      items: {
        with: { part: { columns: { partNumber: true, partName: true } } },
      },
    },
  });
  res.json(rows);
});

transferTemplatesRouter.post("/", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  const { name, destinationSiteId, schedule, items } = req.body;
  const id = uuid();
  await db.insert(transferTemplates).values({ id, name, destinationSiteId, schedule, createdBy: req.user!.id });

  if (items?.length) {
    await db.insert(transferTemplateItems).values(
      items.map((i: any) => ({ id: uuid(), templateId: id, partId: i.partId, qty: i.qty })),
    );
  }
  res.json({ id });
});

transferTemplatesRouter.put("/:id/toggle", authMiddleware, async (req, res) => {
  const db = await getDb();
  await db.update(transferTemplates).set({ isActive: req.body.isActive }).where(eq(transferTemplates.id, req.params.id));
  res.json({ ok: true });
});

transferTemplatesRouter.delete("/:id", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  await db.delete(transferTemplateItems).where(eq(transferTemplateItems.templateId, req.params.id));
  await db.delete(transferTemplates).where(eq(transferTemplates.id, req.params.id));
  res.json({ ok: true });
});
