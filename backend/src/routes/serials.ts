import { Router } from "express";
import { getDb } from "../db/connection";
import { serialNumbers, parts, sites, stockInBatches } from "../db/schema";
import { eq, and, like, inArray, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const serialsRouter = Router();

serialsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const status = req.query.status as string;
  const q = (req.query.q as string)?.trim();
  const partId = req.query.part_id as string;
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const limit = Math.min(parseInt(req.query.limit as string) || 5000, 10000);

  const clauses: any[] = [];
  if (status) clauses.push(sql`sn.status = ${status}`);
  if (q) clauses.push(sql`sn.serial_number LIKE ${`%${q}%`}`);
  if (partId) clauses.push(sql`sn.part_id = ${partId}`);
  const whereClause = clauses.length ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``;

  const result = await db.execute(sql`
    SELECT
      sn.id, sn.serial_number AS serialNumber, sn.part_id AS partId,
      sn.current_site_id AS currentSiteId, sn.status, sn.stock_in_batch_id AS stockInBatchId,
      sn.stock_in_at AS stockInAt, sn.created_at AS createdAt, sn.updated_at AS updatedAt,
      p.part_number AS partNumber, p.part_name AS partName, p.category,
      s.site_name AS siteName, s.site_code AS siteCode,
      b.source_type AS sourceType, b.imported_at AS importedAt
    FROM serial_numbers sn
    LEFT JOIN parts p ON p.id = sn.part_id
    LEFT JOIN sites s ON s.id = sn.current_site_id
    LEFT JOIN stock_in_batches b ON b.id = sn.stock_in_batch_id
    ${whereClause}
    ORDER BY sn.stock_in_at DESC
    LIMIT ${limit} OFFSET ${page * limit}
  `);
  const rawRows = (result as any[])[0] ?? [];
  const rows = rawRows.map((r: any) => ({
    id: r.id,
    serialNumber: r.serialNumber,
    partId: r.partId,
    currentSiteId: r.currentSiteId,
    status: r.status,
    stockInBatchId: r.stockInBatchId,
    stockInAt: r.stockInAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    part: { partNumber: r.partNumber, partName: r.partName, category: r.category },
    site: { siteName: r.siteName, siteCode: r.siteCode },
    batch: { sourceType: r.sourceType, importedAt: r.importedAt },
  }));
  res.json(rows);
});

serialsRouter.get("/:serialNumber", authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT
      sn.id, sn.serial_number AS serialNumber, sn.part_id AS partId,
      sn.current_site_id AS currentSiteId, sn.status, sn.stock_in_batch_id AS stockInBatchId,
      sn.stock_in_at AS stockInAt, sn.created_at AS createdAt, sn.updated_at AS updatedAt,
      p.part_number AS partNumber, p.part_name AS partName, p.category,
      s.site_name AS siteName, s.site_code AS siteCode
    FROM serial_numbers sn
    LEFT JOIN parts p ON p.id = sn.part_id
    LEFT JOIN sites s ON s.id = sn.current_site_id
    WHERE sn.serial_number = ${req.params.serialNumber}
    LIMIT 1
  `);
  const rawRows = (result as any[])[0] ?? [];
  const serial = rawRows.length ? {
    id: rawRows[0].id,
    serialNumber: rawRows[0].serialNumber,
    partId: rawRows[0].partId,
    currentSiteId: rawRows[0].currentSiteId,
    status: rawRows[0].status,
    stockInBatchId: rawRows[0].stockInBatchId,
    stockInAt: rawRows[0].stockInAt,
    createdAt: rawRows[0].createdAt,
    updatedAt: rawRows[0].updatedAt,
    part: { partNumber: rawRows[0].partNumber, partName: rawRows[0].partName, category: rawRows[0].category },
    site: { siteName: rawRows[0].siteName, siteCode: rawRows[0].siteCode },
  } : null;
  res.json(serial ?? null);
});

serialsRouter.get("/:id/transfer-history", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serialResult = await db.execute(sql`
    SELECT id FROM serial_numbers WHERE id = ${req.params.id} LIMIT 1
  `);
  const serialRows = (serialResult as any[])[0] ?? [];
  if (!serialRows.length) { res.json([]); return; }

  const itemResult = await db.execute(sql`
    SELECT
      t.transfer_no AS transferNo, t.status, t.created_at AS createdAt,
      s.site_name AS destSiteName
    FROM transfer_items ti
    JOIN transfers t ON t.id = ti.transfer_id
    LEFT JOIN sites s ON s.id = t.destination_site_id
    WHERE ti.serial_id = ${req.params.id}
    ORDER BY t.created_at DESC
    LIMIT 20
  `);
  const items = (itemResult as any[])[0] ?? [];

  res.json(items.map((i: any) => ({
    transferNo: i.transferNo,
    status: i.status,
    createdAt: i.createdAt,
    destName: i.destSiteName,
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
