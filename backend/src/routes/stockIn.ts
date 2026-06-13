import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { randomUUID as uuid } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { authMiddleware } from "../middleware/auth";
import { parts, serialNumbers, sites, stockInBatches, stockInItems } from "../db/schema";
import { ensurePartsByNumbers } from "../utils/parts";
import { bodyString } from "../utils/body";
import { queryString } from "../utils/query";

export const stockInRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

type StockInInputRow = { row: number; serial: string; partNumber: string; notes: string | null };

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function splitCsvLine(line: string, delimiter: string) {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === "\"") {
      if (inQuote && next === "\"") {
        current += "\"";
        i++;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === delimiter && !inQuote) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseDelimitedText(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function normalizeObjectRow(row: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value === null || value === undefined ? "" : String(value);
  }
  return normalized;
}

function parseXlsx(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map(normalizeObjectRow);
}

function parseUploadFile(file: Express.Multer.File): Record<string, string>[] {
  const name = file.originalname.toLowerCase();
  if (name.endsWith(".xlsx") || file.mimetype.includes("spreadsheet") || file.mimetype.includes("excel")) {
    return parseXlsx(file.buffer);
  }
  return parseDelimitedText(file.buffer.toString("utf8"));
}

function extractStockInRows(rows: Record<string, string>[]): StockInInputRow[] {
  return rows.map((row, index) => {
    const serial = (row.serial_number || row.serial || row.serial_no || row.serialnumber || row.sn || "").trim();
    const partNumber = (row.part_number || row.part_no || row.partno || row.part || row.partnumber || "").trim();
    const notes = (row.notes || row.note || row.remark || "").trim() || null;
    return { row: index + 2, serial, partNumber, notes };
  });
}

async function resolveDcSite(db: Awaited<ReturnType<typeof getDb>>, requestedSiteId?: string | null) {
  if (requestedSiteId) {
    const requested = await db.query.sites.findFirst({
      where: and(eq(sites.id, requestedSiteId), eq(sites.isDc, true), eq(sites.isActive, true)),
    });
    if (requested) return requested;
  }

  return db.query.sites.findFirst({
    where: and(eq(sites.isDc, true), eq(sites.isActive, true)),
  });
}

async function processStockInRows(
  db: Awaited<ReturnType<typeof getDb>>,
  inputRows: StockInInputRow[],
  actorId: string,
  sourceType = "manual",
  sourceFileName: string | null = null,
  requestedSiteId?: string | null,
) {
  if (!inputRows.length) {
    return { batchId: null, totalRows: 0, successRows: 0, failedRows: [{ row: 0, serial: "", reason: "No rows provided" }] };
  }

  const dcSite = await resolveDcSite(db, requestedSiteId);
  if (!dcSite) {
    return { batchId: null, totalRows: inputRows.length, successRows: 0, failedRows: [{ row: 0, serial: "", reason: "No DC site configured" }] };
  }

  const partLookup = await ensurePartsByNumbers(db, inputRows.map((row) => row.partNumber));
  const uniqueSerials = [...new Set(inputRows.map((row) => row.serial).filter(Boolean))];
  const existingSerialRows = uniqueSerials.length
    ? await db.query.serialNumbers.findMany({ where: inArray(serialNumbers.serialNumber, uniqueSerials) })
    : [];
  const existingSerials = new Set(existingSerialRows.map((row) => row.serialNumber));
  const seenSerials = new Set<string>();

  const failedRows: Array<{ row: number; serial: string; reason: string }> = [];
  const successRows: Array<{ id: string; serialNumber: string; partId: string }> = [];

  for (const row of inputRows) {
    if (!row.serial || !row.partNumber) {
      failedRows.push({ row: row.row, serial: row.serial, reason: "Missing serial number or part number" });
      continue;
    }
    if (seenSerials.has(row.serial)) {
      failedRows.push({ row: row.row, serial: row.serial, reason: "Duplicate serial in file" });
      continue;
    }
    if (existingSerials.has(row.serial)) {
      failedRows.push({ row: row.row, serial: row.serial, reason: "Serial already exists" });
      continue;
    }

    const part = partLookup.map.get(row.partNumber);
    if (!part) {
      failedRows.push({ row: row.row, serial: row.serial, reason: `Part ${row.partNumber} not found` });
      continue;
    }

    seenSerials.add(row.serial);
    successRows.push({ id: uuid(), serialNumber: row.serial, partId: part.id });
  }

  const batchId = uuid();
  await db.insert(stockInBatches).values({
    id: batchId,
    sourceType,
    sourceFileName,
    fileHash: null,
    importedBy: actorId,
    totalRows: inputRows.length,
    successRows: successRows.length,
    failedRows: failedRows.length,
  });

  if (successRows.length > 0) {
    await db.insert(serialNumbers).values(successRows.map((s) => ({
      id: s.id,
      serialNumber: s.serialNumber,
      partId: s.partId,
      currentSiteId: dcSite.id,
      status: "in_stock",
      stockInBatchId: batchId,
    })));

    await db.insert(stockInItems).values(successRows.map((s) => ({
      id: uuid(),
      batchId,
      partId: s.partId,
      serialId: s.id,
      quantity: 1,
    })));
  }

  return {
    batchId,
    totalRows: inputRows.length,
    successRows: successRows.length,
    failedRows,
  };
}

stockInRouter.post("/batch", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serials = Array.isArray(req.body?.serials) ? req.body.serials : [];
  const actorId = bodyString(req.body?.actorId, req.body?.actor_id) ?? req.user!.id;
  const requestedSiteId = bodyString(req.body?.dcSiteId, req.body?.dc_site_id);

  const rows: StockInInputRow[] = serials.map((item: any, index: number) => ({
    row: index + 1,
    serial: bodyString(item?.serial, item?.serial_number)?.trim() ?? "",
    partNumber: bodyString(item?.partNumber, item?.part_number)?.trim() ?? "",
    notes: bodyString(item?.notes)?.trim() || null,
  }));

  const result = await processStockInRows(db, rows, actorId, "manual", null, requestedSiteId);
  res.json(result);
});

stockInRouter.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  const db = await getDb();
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const actorId = bodyString(req.body?.actorId, req.body?.actor_id) ?? req.user!.id;
  const requestedSiteId = bodyString(req.body?.dcSiteId, req.body?.dc_site_id);
  const rows = extractStockInRows(parseUploadFile(req.file));

  const result = await processStockInRows(db, rows, actorId, "file", req.file.originalname, requestedSiteId);
  if (!result.batchId) {
    res.status(400).json({ error: "Upload failed", ...result });
    return;
  }
  res.json(result);
});

stockInRouter.get("/batches", authMiddleware, async (req, res) => {
  const db = await getDb();
  const since = queryString(req.query.since);

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
