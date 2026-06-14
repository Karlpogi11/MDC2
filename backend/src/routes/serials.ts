import { Router } from "express";
import { getDb } from "../db/connection";
import { serialNumbers, parts, sites, stockInBatches } from "../db/schema";
import { eq, and, like, inArray, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { queryNumber, queryString } from "../utils/query";
import { writeAuditLog } from "../utils/audit";

export const serialsRouter = Router();

serialsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const status = queryString(req.query.status);
  const q = queryString(req.query.q)?.trim();
  const partId = queryString(req.query.part_id);
  const page = Math.max(0, queryNumber(req.query.page, 0));
  const limit = Math.min(queryNumber(req.query.limit, 5000), 10000);

  const clauses: any[] = [];
  if (status === "in_stock") {
    clauses.push(sql`(sn.status = 'in_stock' OR sn.id IN (SELECT ti.serial_id FROM transfer_items ti JOIN transfers t ON t.id = ti.transfer_id WHERE t.status = 'in_transit' AND ti.serial_id IS NOT NULL))`);
  } else if (status === "transferred" || status === "stocked_out") {
    clauses.push(sql`sn.id IN (SELECT ti.serial_id FROM transfer_items ti JOIN transfers t ON t.id = ti.transfer_id WHERE t.status IN ('in_transit', 'received') AND ti.serial_id IS NOT NULL)`);
  } else if (status) {
    clauses.push(sql`sn.status = ${status}`);
  }
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
      b.source_type AS sourceType, b.imported_at AS importedAt,
      EXISTS(SELECT 1 FROM transfer_items ti JOIN transfers t ON t.id = ti.transfer_id WHERE ti.serial_id = sn.id AND t.status = 'in_transit') AS inTransit,
      EXISTS(SELECT 1 FROM transfer_items ti JOIN transfers t ON t.id = ti.transfer_id WHERE ti.serial_id = sn.id AND t.status IN ('in_transit', 'received')) AS dispatched
    FROM serial_numbers sn
    LEFT JOIN parts p ON p.id = sn.part_id
    LEFT JOIN sites s ON s.id = sn.current_site_id
    LEFT JOIN stock_in_batches b ON b.id = sn.stock_in_batch_id
    ${whereClause}
    ORDER BY sn.stock_in_at DESC
    LIMIT ${limit} OFFSET ${page * limit}
  `);
  const rawRows = (result as unknown as any[])[0] ?? [];
  const rows = rawRows.map((r: any) => ({
    id: r.id,
    serialNumber: r.serialNumber,
    partId: r.partId,
    currentSiteId: r.currentSiteId,
    status: r.inTransit ? "transferred" : r.status,
    dispatched: !!r.dispatched,
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
      s.site_name AS siteName, s.site_code AS siteCode,
      EXISTS(
        SELECT 1 FROM transfer_items ti
        JOIN transfers t ON t.id = ti.transfer_id
        WHERE ti.serial_id = sn.id
          AND t.status IN ('draft', 'packed', 'in_transit')
      ) AS reservedInActiveTransfer,
      (
        SELECT t.transfer_no FROM transfer_items ti
        JOIN transfers t ON t.id = ti.transfer_id
        WHERE ti.serial_id = sn.id
          AND t.status IN ('draft', 'packed', 'in_transit')
        ORDER BY t.created_at DESC
        LIMIT 1
      ) AS activeTransferNo,
      (
        SELECT t.status FROM transfer_items ti
        JOIN transfers t ON t.id = ti.transfer_id
        WHERE ti.serial_id = sn.id
          AND t.status IN ('draft', 'packed', 'in_transit')
        ORDER BY t.created_at DESC
        LIMIT 1
      ) AS activeTransferStatus
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
    reservedInActiveTransfer: !!rawRows[0].reservedInActiveTransfer,
    activeTransferNo: rawRows[0].activeTransferNo ?? null,
    activeTransferStatus: rawRows[0].activeTransferStatus ?? null,
  } : null;
  res.json(serial ?? null);
});

serialsRouter.get("/:id/transfer-history", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serialId = queryString(req.params.id) ?? "";
  const serialResult = await db.execute(sql`
    SELECT id FROM serial_numbers WHERE id = ${serialId} LIMIT 1
  `);
  const serialRows = (serialResult as unknown as any[])[0] ?? [];
  if (!serialRows.length) { res.json([]); return; }

  const itemResult = await db.execute(sql`
    SELECT
      t.id, t.transfer_no AS transferNo, t.status, t.created_at AS createdAt,
      t.packed_at AS packedAt,
      ss.site_name AS srcSiteName, ss.id AS srcSiteId,
      ds.site_name AS destSiteName, ds.id AS destSiteId
    FROM transfer_items ti
    JOIN transfers t ON t.id = ti.transfer_id
    LEFT JOIN sites ss ON ss.id = t.source_site_id
    LEFT JOIN sites ds ON ds.id = t.destination_site_id
    WHERE ti.serial_id = ${serialId}
    ORDER BY t.created_at DESC
    LIMIT 20
  `);
  const items = (itemResult as unknown as any[])[0] ?? [];

  res.json(items.map((i: any) => ({
    transfer: {
      id: i.id,
      transferNo: i.transferNo,
      status: i.status,
      createdAt: i.createdAt,
      packedAt: i.packedAt,
      sourceSite: i.srcSiteName ? { siteName: i.srcSiteName } : null,
      destinationSite: i.destSiteName ? { siteName: i.destSiteName } : null,
    },
  })));
});

serialsRouter.post("/:id/return-to-dc", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serialId = queryString(req.params.id) ?? "";
  if (!serialId) { res.status(400).json({ error: "Serial ID required" }); return; }
  const reason = (req.body?.reason as string)?.trim() || null;

  const dcSite = await db.query.sites.findFirst({
    where: and(eq(sites.isDc, true), eq(sites.isActive, true)),
  });
  if (!dcSite) { res.status(400).json({ error: "No DC site configured" }); return; }

  const [serialRows] = await db.execute(sql`
    SELECT id, serial_number AS serialNumber, current_site_id AS currentSiteId, status
    FROM serial_numbers WHERE id = ${serialId} LIMIT 1
  `);
  const serial = ((serialRows as unknown as any[]) ?? [])[0] as any;
  if (!serial) { res.status(404).json({ error: "Serial not found" }); return; }
  if (serial.currentSiteId === dcSite.id && serial.status === "in_stock") {
    res.status(400).json({ error: "Serial is already at DC" }); return;
  }

  await db.update(serialNumbers)
    .set({ status: "in_stock", currentSiteId: dcSite.id })
    .where(eq(serialNumbers.id, serialId));

  await writeAuditLog({
    actorId: req.user!.id,
    action: "update",
    entityType: "serial_number",
    entityId: serialId,
    newValue: { status: "in_stock", currentSiteId: dcSite.id },
    note: reason ? `Returned to DC: ${reason}` : "Returned to DC",
  });

  res.json({ ok: true });
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
  await writeAuditLog({
    actorId: req.user!.id,
    action: "update",
    entityType: "serial_number",
    entityId: null,
    newValue: { serialsCount: serials.length, currentSiteId },
    note: `Batch site update: ${serials.length} serials moved to site ${currentSiteId}`,
  });
  res.json({ ok: true });
});

serialsRouter.put("/:id/status", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const [prevRows] = await db.execute(sql`SELECT status FROM serial_numbers WHERE id = ${id} LIMIT 1`);
  const prev = (prevRows as unknown as any[])[0] as any;
  await db.update(serialNumbers)
    .set({ status: req.body.status })
    .where(eq(serialNumbers.id, id));
  await writeAuditLog({
    actorId: req.user!.id,
    action: "update",
    entityType: "serial_number",
    entityId: id,
    oldValue: prev ? { status: prev.status } : null,
    newValue: { status: req.body.status },
  });
  res.json({ ok: true });
});

serialsRouter.get("/:id/audit-logs", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serialId = queryString(req.params.id) ?? "";
  const [result] = await db.execute(sql`
    SELECT
      al.id, al.actor_id AS actorId, al.action, al.entity_type AS entityType,
      al.entity_id AS entityId, al.old_value AS oldValue, al.new_value AS newValue,
      al.note, al.created_at AS createdAt,
      p.full_name AS actorFullName, p.username AS actorUsername
    FROM audit_logs al
    LEFT JOIN profiles p ON p.id = al.actor_id
    WHERE al.entity_id = ${serialId}
    ORDER BY al.created_at DESC
    LIMIT 100
  `);
  const rows = (result as unknown as any[]) ?? [];
  res.json(rows.map((r: any) => ({
    id: r.id, actorId: r.actorId, action: r.action,
    entityType: r.entityType, entityId: r.entityId,
    oldValue: r.oldValue, newValue: r.newValue,
    note: r.note, createdAt: r.createdAt,
    actor: r.actorFullName ? { fullName: r.actorFullName, username: r.actorUsername } : null,
  })));
});

serialsRouter.get("/:id/corrections", authMiddleware, async (req, res) => {
  const db = await getDb();
  const serialId = queryString(req.params.id) ?? "";
  const [result] = await db.execute(sql`
    SELECT id, transfer_id AS transferId, serial_id AS serialId,
      old_serial_number AS oldSerialNumber, new_serial_number AS newSerialNumber,
      reason, corrected_by AS correctedBy, corrected_at AS correctedAt
    FROM serial_corrections
    WHERE serial_id = ${serialId}
    ORDER BY corrected_at DESC
    LIMIT 50
  `);
  res.json((result as unknown as any[]) ?? []);
});
