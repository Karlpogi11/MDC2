import { Router } from "express";
import { getDb } from "../db/connection";
import { physicalCounts, physicalCountItems, serialNumbers } from "../db/schema";
import { eq, and, desc, inArray, ne } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const physicalCountsRouter = Router();

physicalCountsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.physicalCounts.findMany({
    orderBy: [desc(physicalCounts.createdAt)],
    limit: 20,
    with: { items: { columns: { id: true, variance: true } } },
  });
  res.json(rows.map((r) => ({ ...r, itemCount: r.items.length, discrepancyCount: r.items.filter((i) => i.variance !== "match").length, items: undefined })));
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

  res.json({ id });
});

physicalCountsRouter.get("/:id/items", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.physicalCountItems.findMany({
    where: eq(physicalCountItems.countId, req.params.id),
    orderBy: [physicalCountItems.variance],
    limit: 500,
  });
  res.json(rows);
});

physicalCountsRouter.put("/:id/approve", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  const { actorId } = req.body;

  const items = await db.query.physicalCountItems.findMany({
    where: and(
      eq(physicalCountItems.countId, req.params.id),
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
    .where(eq(physicalCounts.id, req.params.id));

  res.json({ ok: true });
});
