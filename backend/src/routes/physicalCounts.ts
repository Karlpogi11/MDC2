import { Router } from "express";
import { getDb } from "../db/connection";
import { physicalCounts, physicalCountItems, serialNumbers } from "../db/schema";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";
import { queryString } from "../utils/query";
import { writeAuditLog } from "../utils/audit";

export const physicalCountsRouter = Router();

physicalCountsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const countResult = await db.execute(sql`
    SELECT id, status, notes, created_by AS createdBy,
      reviewed_by AS reviewedBy, created_at AS createdAt,
      submitted_at AS submittedAt, reviewed_at AS reviewedAt,
      updated_at AS updatedAt
    FROM physical_counts
    ORDER BY created_at DESC
    LIMIT 20
  `);
  const countRows = (countResult as any[])[0] ?? [];
  const countIds = countRows.map((r: any) => r.id);
  let itemsByCount = new Map<string, { id: string; variance: string }[]>();
  if (countIds.length) {
    const itemResult = await db.execute(sql`
      SELECT id, count_id AS countId, variance
      FROM physical_count_items
      WHERE count_id IN (${sql.join(countIds.map((id: string) => sql`${id}`), sql`, `)})
    `);
    const itemRows = (itemResult as any[])[0] ?? [];
    for (const item of itemRows) {
      if (!itemsByCount.has(item.countId)) itemsByCount.set(item.countId, []);
      itemsByCount.get(item.countId)!.push({ id: item.id, variance: item.variance });
    }
  }
  const rows = countRows.map((r: any) => {
    const countItems = itemsByCount.get(r.id) ?? [];
    return {
      id: r.id,
      status: r.status,
      notes: r.notes,
      createdBy: r.createdBy,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      updatedAt: r.updatedAt,
      itemCount: countItems.length,
      discrepancyCount: countItems.filter((i: any) => i.variance !== "match").length,
    };
  });
  res.json(rows);
});

physicalCountsRouter.post("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { createdBy, notes, items } = req.body;
  const id = uuid();

  await db.insert(physicalCounts).values({
    id, status: "submitted", notes, createdBy: createdBy ?? req.user!.id, submittedAt: new Date(),
  });

  if (items?.length) {
    await db.insert(physicalCountItems).values(
      items.map((i: any) => ({ id: uuid(), countId: id, ...i })),
    );
  }

  await writeAuditLog({
    actorId: createdBy ?? req.user!.id,
    action: "insert",
    entityType: "physical_count",
    entityId: id,
    newValue: { status: "submitted", itemsCount: items?.length ?? 0 },
  });

  res.json({ id });
});

physicalCountsRouter.get("/:id/items", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const rows = await db.query.physicalCountItems.findMany({
    where: eq(physicalCountItems.countId, id),
    orderBy: [physicalCountItems.variance],
    limit: 500,
  });
  res.json(rows);
});

physicalCountsRouter.put("/:id/approve", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  const { actorId } = req.body;
  const id = queryString(req.params.id) ?? "";

  const items = await db.query.physicalCountItems.findMany({
    where: and(
      eq(physicalCountItems.countId, id),
      ne(physicalCountItems.variance, "match"),
    ),
  });

  for (const item of items) {
    if (item.serialNumber && item.actualStatus) {
      await db.update(serialNumbers)
        .set({ status: item.actualStatus })
        .where(eq(serialNumbers.serialNumber, item.serialNumber));
    }
  }

  await db.update(physicalCounts)
    .set({ status: "approved", reviewedBy: actorId ?? req.user!.id, reviewedAt: new Date() })
    .where(eq(physicalCounts.id, id));

  await writeAuditLog({
    actorId: actorId ?? req.user!.id,
    action: "update",
    entityType: "physical_count",
    entityId: id,
    oldValue: { status: "submitted" },
    newValue: { status: "approved" },
    note: `${items.length} discrepancy items resolved`,
  });

  res.json({ ok: true });
});
