import { Router } from "express";
import { getDb } from "../db/connection";
import { transferTemplates, transferTemplateItems, sites, parts } from "../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const transferTemplatesRouter = Router();

transferTemplatesRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();

  const result = await db.execute(sql`
    SELECT
      tt.id, tt.name, tt.destination_site_id AS destinationSiteId,
      tt.schedule, tt.is_active AS isActive,
      tt.created_by AS createdBy, tt.created_at AS createdAt, tt.updated_at AS updatedAt,
      s.site_name AS destSiteName
    FROM transfer_templates tt
    LEFT JOIN sites s ON s.id = tt.destination_site_id
    ORDER BY tt.created_at DESC
  `);
  const templateRows = (result as any[])[0] ?? [];

  const templateIds = templateRows.map((r: any) => r.id);
  let itemsByTemplate = new Map<string, any[]>();
  if (templateIds.length) {
    const itemResult = await db.execute(sql`
      SELECT
        tti.id, tti.template_id AS templateId, tti.part_id AS partId,
        tti.qty, tti.created_at AS createdAt,
        p.part_number AS partNumber, p.part_name AS partName
      FROM transfer_template_items tti
      LEFT JOIN parts p ON p.id = tti.part_id
      WHERE tti.template_id IN (${sql.join(templateIds.map((id: string) => sql`${id}`), sql`, `)})
      ORDER BY tti.created_at ASC
    `);
    const itemRows = (itemResult as any[])[0] ?? [];
    for (const item of itemRows) {
      if (!itemsByTemplate.has(item.templateId)) itemsByTemplate.set(item.templateId, []);
      itemsByTemplate.get(item.templateId)!.push({
        id: item.id,
        templateId: item.templateId,
        partId: item.partId,
        qty: item.qty,
        createdAt: item.createdAt,
        part: { partNumber: item.partNumber, partName: item.partName },
      });
    }
  }

  const rows = templateRows.map((r: any) => ({
    id: r.id,
    name: r.name,
    destinationSiteId: r.destinationSiteId,
    schedule: r.schedule,
    isActive: r.isActive,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    destinationSite: { siteName: r.destSiteName },
    items: itemsByTemplate.get(r.id) ?? [],
  }));

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
