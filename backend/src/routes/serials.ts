import { Router } from "express";
import { getDb } from "../db/connection";
import { serialNumbers, parts, sites, stockInBatches } from "../db/schema";
import { eq, and, like, inArray, desc } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const serialsRouter = Router();

serialsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const status = req.query.status as string;
  const q = (req.query.q as string)?.trim();
  const partId = req.query.part_id as string;
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const limit = Math.min(parseInt(req.query.limit as string) || 5000, 10000);

  let conditions = undefined;

  if (status) conditions = eq(serialNumbers.status, status);
  if (q) conditions = and(conditions, like(serialNumbers.serialNumber, `%${q}%`));
  if (partId) conditions = and(conditions, eq(serialNumbers.partId, partId));

  const rows = await db.query.serialNumbers.findMany({
    where: conditions,
    limit,
    offset: page * limit,
    orderBy: [desc(serialNumbers.stockInAt)],
    with: {
      part: { columns: { partNumber: true, partName: true, category: true } },
      site: { columns: { siteName: true, siteCode: true } },
      batch: { columns: { sourceType: true, importedAt: true } },
    },
  });
  res.json(rows);
});

serialsRouter.get("/:serialNumber", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serial = await db.query.serialNumbers.findFirst({
    where: eq(serialNumbers.serialNumber, req.params.serialNumber),
    with: {
      part: { columns: { partNumber: true, partName: true, category: true } },
      site: { columns: { siteName: true, siteCode: true } },
    },
  });
  res.json(serial ?? null);
});

serialsRouter.get("/:id/transfer-history", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serial = await db.query.serialNumbers.findFirst({
    where: eq(serialNumbers.id, req.params.id),
  });
  if (!serial) { res.json([]); return; }

  const items = await db.query.transferItems.findMany({
    where: eq(serialNumbers.id, serial.id),
    with: {
      transfer: {
        columns: { transferNo: true, status: true, createdAt: true },
        with: {
          destinationSite: { columns: { siteName: true } },
        },
      },
    },
    limit: 20,
  });

  res.json(items.map((i) => ({
    transferNo: i.transfer.transferNo,
    status: i.transfer.status,
    createdAt: i.transfer.createdAt,
    destName: i.transfer.destinationSite?.siteName,
  })));
});

serialsRouter.put("/batch-site-update", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { serialNumbers: serials, currentSiteId } = req.body;
  if (!serials?.length || !currentSiteId) {
    res.status(400).json({ error: "serials and currentSiteId required" });
    return;
  }
  await db.update(serialNumbers)
    .set({ currentSiteId })
    .where(inArray(serialNumbers.serialNumber, serials));
  res.json({ ok: true });
});

serialsRouter.put("/:id/status", authMiddleware, async (req, res) => {
  const db = await getDb();
  await db.update(serialNumbers)
    .set({ status: req.body.status })
    .where(eq(serialNumbers.id, req.params.id));
  res.json({ ok: true });
});
