import { Router } from "express";
import { getDb } from "../db/connection";
import { stockInBatches, stockInItems, serialNumbers, parts, sites } from "../db/schema";
import { eq, and, desc, inArray, gte, sql } from "drizzle-orm";
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

  const clauses: any[] = [];
  if (since) clauses.push(sql`sb.imported_at >= ${new Date(since)}`);
  const whereClause = clauses.length ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``;

  const result = await db.execute(sql`
    SELECT
      sb.id, sb.source_type AS sourceType, sb.source_file_name AS sourceFileName,
      sb.file_hash AS fileHash, sb.imported_by AS importedBy,
      sb.imported_at AS importedAt, sb.total_rows AS totalRows,
      sb.success_rows AS successRows, sb.failed_rows AS failedRows,
      p.full_name AS operatorFullName, p.username AS operatorUsername
    FROM stock_in_batches sb
    LEFT JOIN profiles p ON p.id = sb.imported_by
    ${whereClause}
    ORDER BY sb.imported_at DESC
    LIMIT 100
  `);
  const rawRows = (result as any[])[0] ?? [];
  const rows = rawRows.map((r: any) => ({
    id: r.id,
    sourceType: r.sourceType,
    sourceFileName: r.sourceFileName,
    fileHash: r.fileHash,
    importedBy: r.importedBy,
    importedAt: r.importedAt,
    totalRows: r.totalRows,
    successRows: r.successRows,
    failedRows: r.failedRows,
    operator: { fullName: r.operatorFullName, username: r.operatorUsername },
  }));
  res.json(rows);
});

stockInRouter.get("/batches/:id/serials", authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT sn.serial_number AS serialNumber, p.part_number AS partNumber
    FROM serial_numbers sn
    LEFT JOIN parts p ON p.id = sn.part_id
    WHERE sn.stock_in_batch_id = ${req.params.id}
    LIMIT 500
  `);
  const rawRows = (result as any[])[0] ?? [];
  const rows = rawRows.map((s: any) => ({ serialNumber: s.serialNumber, partNumber: s.partNumber }));
  res.json(rows);
});
