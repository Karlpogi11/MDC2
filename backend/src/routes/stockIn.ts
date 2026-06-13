import { Router } from "express";
import { getDb } from "../db/connection";
import { stockInBatches, stockInItems, serialNumbers, parts, sites } from "../db/schema";
import { eq, and, desc, inArray, gte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const stockInRouter = Router();

stockInRouter.post("/batch", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { serials: serialData, actorId } = req.body;

  if (!serialData?.length) {
    res.status(400).json({ error: "No serials provided" });
    return;
  }

  const dcSite = await db.query.sites.findFirst({
    where: and(eq(sites.isDc, true), eq(sites.isActive, true)),
  });
  if (!dcSite) { res.status(400).json({ error: "No DC site" }); return; }

  const uniquePartNumbers = [...new Set(serialData.map((s: any) => s.partNumber))];
  const existingParts = await db.query.parts.findMany({
    where: inArray(parts.partNumber, uniquePartNumbers),
  });
  const partsByNumber = new Map(existingParts.map((p) => [p.partNumber, p]));

  const failed: Array<{ serial: string; reason: string }> = [];
  const successSerials: Array<{ id: string; serialNumber: string; partId: string }> = [];

  for (const item of serialData) {
    const part = partsByNumber.get(item.partNumber);
    if (!part) {
      failed.push({ serial: item.serial, reason: `Part ${item.partNumber} not found` });
      continue;
    }
    successSerials.push({
      id: uuid(),
      serialNumber: item.serial,
      partId: part.id,
    });
  }

  if (!successSerials.length) {
    res.json({ ok: 0, failed });
    return;
  }

  const batchId = uuid();
  await db.insert(stockInBatches).values({
    id: batchId,
    sourceType: "manual",
    importedBy: actorId ?? req.user!.id,
    totalRows: serialData.length,
    successRows: successSerials.length,
    failedRows: failed.length,
  });

  const serialInserts = successSerials.map((s) => ({
    id: s.id,
    serialNumber: s.serialNumber,
    partId: s.partId,
    currentSiteId: dcSite.id,
    status: "in_stock",
    stockInBatchId: batchId,
  }));

  await db.insert(serialNumbers).values(serialInserts);

  const stockInItemsData = serialInserts.map((s) => ({
    id: uuid(),
    batchId,
    partId: s.partId,
    serialId: s.id,
    quantity: 1,
  }));

  await db.insert(stockInItems).values(stockInItemsData);

  res.json({ ok: successSerials.length, failed });
});

stockInRouter.get("/batches", authMiddleware, async (req, res) => {
  const db = await getDb();
  const since = req.query.since as string;

  let conditions = undefined;
  if (since) conditions = gte(stockInBatches.importedAt, new Date(since));

  const rows = await db.query.stockInBatches.findMany({
    where: conditions,
    orderBy: [desc(stockInBatches.importedAt)],
    limit: 100,
    with: {
      operator: { columns: { fullName: true, username: true } },
    },
  });

  res.json(rows);
});

stockInRouter.get("/batches/:id/serials", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.serialNumbers.findMany({
    where: eq(serialNumbers.stockInBatchId, req.params.id),
    limit: 500,
    with: { part: { columns: { partNumber: true } } },
  });
  res.json(rows.map((s) => ({ serialNumber: s.serialNumber, partNumber: s.part?.partNumber })));
});
