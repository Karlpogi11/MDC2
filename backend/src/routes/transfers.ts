import { Router } from "express";
import { getDb } from "../db/connection";
import { transfers, transferItems, sites, profiles, parts, serialNumbers, appConfig } from "../db/schema";
import { eq, and, desc, inArray, like, gte, lt, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";
import { queryNumber, queryString } from "../utils/query";

export const transfersRouter = Router();

transfersRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const status = queryString(req.query.status);
  const invoiceRefGte = queryString(req.query.invoice_ref_gte);
  const invoiceRefLt = queryString(req.query.invoice_ref_lt);
  const page = Math.max(0, queryNumber(req.query.page, 0));
  const limit = Math.min(queryNumber(req.query.limit, 100), 200);

  const clauses: any[] = [];
  if (status) clauses.push(sql`t.status = ${status}`);
  if (invoiceRefGte) clauses.push(sql`t.invoice_ref >= ${invoiceRefGte}`);
  if (invoiceRefLt) clauses.push(sql`t.invoice_ref < ${invoiceRefLt}`);
  const whereClause = clauses.length ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``;

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT
        t.id, t.transfer_no AS transferNo, t.invoice_ref AS invoiceRef,
        t.fixably_series AS fixablySeries, t.source_site_id AS sourceSiteId,
        t.destination_site_id AS destinationSiteId, t.status,
        t.requested_by AS requestedBy, t.packed_by AS packedBy,
        t.packed_at AS packedAt, t.created_at AS createdAt, t.updated_at AS updatedAt,
        s.site_name AS destSiteName, s.site_code AS destSiteCode,
        p.full_name AS reqFullName, p.username AS reqUsername,
        (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS itemCount
      FROM transfers t
      LEFT JOIN sites s ON s.id = t.destination_site_id
      LEFT JOIN profiles p ON p.id = t.requested_by
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${page * limit}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS count FROM transfers t ${whereClause}
    `),
  ]);

  const dataRows = (dataResult as any[])[0] ?? [];
  const countRows = (countResult as any[])[0] ?? [];

  const rows = dataRows.map((r: any) => ({
    id: r.id,
    transferNo: r.transferNo,
    invoiceRef: r.invoiceRef,
    fixablySeries: r.fixablySeries,
    sourceSiteId: r.sourceSiteId,
    destinationSiteId: r.destinationSiteId,
    status: r.status,
    requestedBy: r.requestedBy,
    packedBy: r.packedBy,
    packedAt: r.packedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    destinationSite: { siteName: r.destSiteName, siteCode: r.destSiteCode },
    requestedByProfile: { fullName: r.reqFullName, username: r.reqUsername },
    itemCount: Number(r.itemCount),
  }));

  res.json({
    data: rows,
    total: Number(countRows[0]?.count ?? 0),
    page,
    pageSize: limit,
  });
});

transfersRouter.get("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();

  const transferResult = await db.execute(sql`
    SELECT
      t.id, t.transfer_no AS transferNo, t.invoice_ref AS invoiceRef,
      t.fixably_series AS fixablySeries, t.source_site_id AS sourceSiteId,
      t.destination_site_id AS destinationSiteId, t.status,
      t.requested_by AS requestedBy, t.packed_by AS packedBy,
      t.packed_at AS packedAt, t.receipt_token AS receiptToken,
      t.token_expires_at AS tokenExpiresAt,
      t.created_at AS createdAt, t.updated_at AS updatedAt,
      ss.site_name AS srcSiteName, ss.site_code AS srcSiteCode,
      ds.site_name AS destSiteName, ds.site_code AS destSiteCode,
      rp.full_name AS reqFullName, rp.username AS reqUsername,
      pp.full_name AS packFullName, pp.username AS packUsername
    FROM transfers t
    LEFT JOIN sites ss ON ss.id = t.source_site_id
    LEFT JOIN sites ds ON ds.id = t.destination_site_id
    LEFT JOIN profiles rp ON rp.id = t.requested_by
    LEFT JOIN profiles pp ON pp.id = t.packed_by
    WHERE t.id = ${req.params.id}
    LIMIT 1
  `);
  const transferRows = (transferResult as any[])[0] ?? [];
  if (!transferRows.length) { res.status(404).json({ error: "Transfer not found" }); return; }

  const t = transferRows[0];

  const itemResult = await db.execute(sql`
    SELECT
      ti.id, ti.transfer_id AS transferId, ti.part_id AS partId,
      ti.serial_id AS serialId, ti.qty, ti.created_at AS createdAt,
      p.id AS partIdFromParts, p.part_number AS partNumber, p.part_name AS partName, p.category,
      sn.serial_number AS serialNumber, sn.status AS serialStatus
    FROM transfer_items ti
    LEFT JOIN parts p ON p.id = ti.part_id
    LEFT JOIN serial_numbers sn ON sn.id = ti.serial_id
    WHERE ti.transfer_id = ${req.params.id}
    ORDER BY ti.created_at ASC
  `);
  const itemRows = (itemResult as any[])[0] ?? [];

  const transfer = {
    id: t.id,
    transferNo: t.transferNo,
    invoiceRef: t.invoiceRef,
    fixablySeries: t.fixablySeries,
    sourceSiteId: t.sourceSiteId,
    destinationSiteId: t.destinationSiteId,
    status: t.status,
    requestedBy: t.requestedBy,
    packedBy: t.packedBy,
    packedAt: t.packedAt,
    receiptToken: t.receiptToken,
    tokenExpiresAt: t.tokenExpiresAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    sourceSite: { id: t.sourceSiteId, siteName: t.srcSiteName, siteCode: t.srcSiteCode, isDc: true, isActive: true, address: null, shipToCode: null, invoicePrefix: null, contactEmails: null, createdAt: t.createdAt, updatedAt: t.updatedAt },
    destinationSite: { id: t.destinationSiteId, siteName: t.destSiteName, siteCode: t.destSiteCode, isDc: false, isActive: true, address: null, shipToCode: null, invoicePrefix: null, contactEmails: null, createdAt: t.createdAt, updatedAt: t.updatedAt },
    requestedByProfile: { fullName: t.reqFullName, username: t.reqUsername },
    packedByProfile: t.packFullName ? { fullName: t.packFullName, username: t.packUsername } : null,
    items: itemRows.map((i: any) => ({
      id: i.id,
      transferId: i.transferId,
      partId: i.partId,
      serialId: i.serialId,
      qty: i.qty,
      createdAt: i.createdAt,
      part: { id: i.partIdFromParts, partNumber: i.partNumber, partName: i.partName, category: i.category },
      serial: i.serialNumber ? { serialNumber: i.serialNumber, status: i.serialStatus } : null,
    })),
  };

  res.json(transfer);
});

transfersRouter.post("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { destinationSiteId, items: transferItemsData, invoiceRefSuffix } = req.body;

  const dcSite = await db.query.sites.findFirst({
    where: and(eq(sites.isDc, true), eq(sites.isActive, true)),
  });
  if (!dcSite) { res.status(400).json({ error: "No DC site configured" }); return; }

  const seqResult = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_no, 5) AS UNSIGNED)), 0) + 1 as seq FROM transfers WHERE transfer_no LIKE 'TFR-%'`,
  );
  const seqRows = (seqResult as any[])[0] as any[];
  const seq = Number(seqRows?.[0]?.seq ?? 1);
  const transferNo = `TFR-${String(seq).padStart(4, "0")}`;
  const id = uuid();

  let invoiceRef = null;
  if (invoiceRefSuffix && dcSite.invoicePrefix) {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    invoiceRef = `${dcSite.invoicePrefix}-${monthStart}-${invoiceRefSuffix}`;
  }

  await db.insert(transfers).values({
    id,
    transferNo,
    invoiceRef,
    sourceSiteId: dcSite.id,
    destinationSiteId,
    status: "draft",
    requestedBy: req.user!.id,
  });

  if (transferItemsData?.length) {
    const items = transferItemsData.map((item: any) => ({
      id: uuid(),
      transferId: id,
      partId: item.partId ?? item.part_id,
      serialId: item.serialId ?? item.serial_id ?? null,
      qty: item.qty ?? 1,
    }));
    await db.insert(transferItems).values(items);
  }

  res.json({ id, transferNo });
});

transfersRouter.put("/:id/status", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { status, actorId } = req.body;
  const id = queryString(req.params.id) ?? "";

  await db.update(transfers)
    .set({
      status,
      ...(status === "packed" ? { packedBy: actorId ?? req.user!.id, packedAt: new Date() } : {}),
    })
    .where(eq(transfers.id, id));

  res.json({ ok: true });
});

transfersRouter.put("/:id/assign-serial", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { itemId, serialId } = req.body;
  await db.update(transferItems)
    .set({ serialId })
    .where(eq(transferItems.id, itemId));
  res.json({ ok: true });
});

transfersRouter.put("/:id/receipt-token", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { token, expiresAt } = req.body;
  const id = queryString(req.params.id) ?? "";
  await db.update(transfers)
    .set({ receiptToken: token, tokenExpiresAt: expiresAt ? new Date(expiresAt) : undefined })
    .where(eq(transfers.id, id));
  res.json({ ok: true });
});

transfersRouter.get("/:id/email-config", authMiddleware, async (req, res) => {
  const db = await getDb();
  const config = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, "send_email_on_dispatch"),
  });
  res.json({ sendEmail: config?.value === "true" });
});
