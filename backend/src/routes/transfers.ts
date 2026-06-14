import { Router } from "express";
import { getDb } from "../db/connection";
import { transfers, transferItems, sites, profiles, parts, serialNumbers, appConfig, packingLists, transferEmails } from "../db/schema";
import { eq, and, desc, inArray, like, gte, lt, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";
import { queryNumber, queryString } from "../utils/query";
import { writeAuditLog } from "../utils/audit";
import { sendEmail } from "../utils/mail";

export const transfersRouter = Router();

transfersRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const status = queryString(req.query.status);
  const invoiceRefGte = queryString(req.query.invoice_ref_gte);
  const invoiceRefLt = queryString(req.query.invoice_ref_lt);
  const page = Math.max(0, queryNumber(req.query.page, 0));
  const limit = Math.min(queryNumber(req.query.limit, 100), 200);

  const clauses: any[] = [];
  if (status) {
    const parts = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      clauses.push(sql`t.status = ${parts[0]}`);
    } else if (parts.length > 1) {
      clauses.push(sql`t.status IN (${sql.join(parts.map((s) => sql`${s}`), sql`, `)})`);
    }
  }
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

  const dataRows = (dataResult as unknown as any[])[0] ?? [];
  const countRows = (countResult as unknown as any[])[0] ?? [];

  const transferIds = dataRows.map((r: any) => r.id);
  let itemsByTransfer = new Map<string, any[]>();
  if (transferIds.length > 0) {
    const [itemResult] = await db.execute(sql`
      SELECT
        ti.id, ti.transfer_id AS transferId, ti.part_id AS partId,
        ti.qty, ti.serial_id AS serialId,
        sn.serial_number AS serialNumber, sn.status AS serialStatus,
        sn.stock_in_at AS stockInAt
      FROM transfer_items ti
      LEFT JOIN serial_numbers sn ON sn.id = ti.serial_id
      WHERE ti.transfer_id IN (${sql.join(transferIds.map((id: string) => sql`${id}`), sql`, `)})
      ORDER BY ti.created_at ASC
    `);
    const itemRows = (itemResult as unknown as any[]) ?? [];
    for (const item of itemRows) {
      if (!itemsByTransfer.has(item.transferId)) {
        itemsByTransfer.set(item.transferId, []);
      }
      itemsByTransfer.get(item.transferId)!.push({
        id: item.id,
        partId: item.partId,
        qty: item.qty,
        serial: item.serialId ? {
          id: item.serialId,
          serialNumber: item.serialNumber,
          status: item.serialStatus,
          stockInAt: item.stockInAt,
        } : null,
      });
    }
  }

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
    items: itemsByTransfer.get(r.id) ?? [],
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
  const transferRows = (transferResult as unknown as any[])[0] ?? [];
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
  const itemRows = (itemResult as unknown as any[])[0] ?? [];

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
  const seqRows = (seqResult as unknown as any[])[0] as any[];
  const seq = Number(seqRows?.[0]?.seq ?? 1);
  const transferNo = `TFR-${String(seq).padStart(4, "0")}`;
  const id = uuid();

  let invoiceRef = null;
  if (invoiceRefSuffix && dcSite.invoicePrefix) {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(2);
    invoiceRef = `${dcSite.invoicePrefix}${m}${d}${yy}-${invoiceRefSuffix}`;
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
    const serialIds = transferItemsData.map((item: any) => item.serialId ?? item.serial_id).filter(Boolean);
    if (serialIds.length) {
      const hasDup = serialIds.some((val: string, index: number) => serialIds.indexOf(val) !== index);
      if (hasDup) {
        res.status(400).json({ error: "Duplicate serial numbers in transfer request" });
        return;
      }

      for (const sId of serialIds) {
        const [activeTfrRows] = await db.execute(sql`
          SELECT t.transfer_no AS transferNo, t.status
          FROM transfer_items ti
          JOIN transfers t ON t.id = ti.transfer_id
          WHERE ti.serial_id = ${sId}
            AND t.status IN ('draft', 'packed', 'in_transit')
        `);
        const activeTfr = (activeTfrRows as unknown as any[])?.[0];
        if (activeTfr) {
          res.status(400).json({ error: `Serial is already reserved on active Transfer ${activeTfr.transferNo} (${activeTfr.status})` });
          return;
        }

        const [serialRows] = await db.execute(sql`
          SELECT status FROM serial_numbers WHERE id = ${sId} LIMIT 1
        `);
        const s = (serialRows as unknown as any[])?.[0];
        if (!s || s.status !== "in_stock") {
          res.status(400).json({ error: "One or more serials are not available in stock" });
          return;
        }
      }
    }

    const items = transferItemsData.map((item: any) => ({
      id: uuid(),
      transferId: id,
      partId: item.partId ?? item.part_id,
      serialId: item.serialId ?? item.serial_id ?? null,
      qty: item.qty ?? 1,
    }));
    await db.insert(transferItems).values(items);
  }

  await writeAuditLog({
    actorId: req.user!.id,
    action: "insert",
    entityType: "transfer",
    entityId: id,
    newValue: { transferNo, invoiceRef, destinationSiteId },
    note: `Transfer ${transferNo} created`,
  });

  res.json({ id, transferNo });
});

transfersRouter.put("/:id/status", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { status, actorId, fixablySeries } = req.body;
  const id = queryString(req.params.id) ?? "";

  const [prevRows] = await db.execute(sql`SELECT status, fixably_series AS fixablySeries FROM transfers WHERE id = ${id} LIMIT 1`);
  const prev = (prevRows as unknown as any[])[0] as any;

  const updates: Record<string, any> = { status };
  if (status === "packed") {
    updates.packedBy = actorId ?? req.user!.id;
    updates.packedAt = new Date();
  }
  if (status === "in_transit") {
    if (fixablySeries) updates.fixablySeries = fixablySeries;
    updates.receiptToken = uuid();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    updates.tokenExpiresAt = expiresAt;
  }

  await db.update(transfers)
    .set(updates)
    .where(eq(transfers.id, id));

  const [serialRows] = await db.execute(sql`
    SELECT sn.id, sn.serial_number AS serialNumber FROM transfer_items ti
    JOIN serial_numbers sn ON sn.id = ti.serial_id
    WHERE ti.transfer_id = ${id}
  `);
  const serials = (serialRows as unknown as any[]) ?? [];

  if (status === "in_transit") {
    const serialIds = serials.map((r: any) => r.id);
    if (serialIds.length) {
      await db.update(serialNumbers)
        .set({ status: "transferred" })
        .where(inArray(serialNumbers.id, serialIds));
      for (const s of serials) {
        await writeAuditLog({
          actorId: actorId ?? req.user!.id,
          action: "update",
          entityType: "serial_number",
          entityId: s.id,
          newValue: { status: "transferred" },
          note: `Dispatched in transfer`,
        });
      }
    }
  }

  if (prev?.status === "in_transit" && status === "cancelled") {
    const serialIds = serials.map((r: any) => r.id);
    if (serialIds.length) {
      await db.update(serialNumbers)
        .set({ status: "in_stock" })
        .where(inArray(serialNumbers.id, serialIds));
      for (const s of serials) {
        await writeAuditLog({
          actorId: actorId ?? req.user!.id,
          action: "update",
          entityType: "serial_number",
          entityId: s.id,
          newValue: { status: "in_stock" },
          note: `Cancelled transfer — returned to stock`,
        });
      }
    }
  }

  if (prev?.status === "in_transit" && status === "received") {
    const [destRows] = await db.execute(sql`
      SELECT destination_site_id AS destId FROM transfers WHERE id = ${id} LIMIT 1
    `);
    const dest = ((destRows as unknown as any[]) ?? [])[0] as any;
    const destId = dest?.destId ?? null;
    const serialIds = serials.map((r: any) => r.id);
    if (serialIds.length && destId) {
      await db.update(serialNumbers)
        .set({ status: "in_stock", currentSiteId: destId })
        .where(inArray(serialNumbers.id, serialIds));
      for (const s of serials) {
        await writeAuditLog({
          actorId: actorId ?? req.user!.id,
          action: "update",
          entityType: "serial_number",
          entityId: s.id,
          newValue: { status: "in_stock", currentSiteId: destId },
          note: `Received at destination site`,
        });
      }
    }
  }

  await writeAuditLog({
    actorId: actorId ?? req.user!.id,
    action: "update",
    entityType: "transfer",
    entityId: id,
    oldValue: prev ? { status: prev.status, fixablySeries: prev.fixablySeries } : null,
    newValue: { status, fixablySeries: fixablySeries ?? null },
    note: `Status changed to ${status}`,
  });

  res.json({ ok: true });
});

transfersRouter.put("/:id/assign-serial", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { itemId, serialId } = req.body;

  const [itemRows] = await db.execute(sql`SELECT part_id AS partId, transfer_id AS transferId FROM transfer_items WHERE id = ${itemId} LIMIT 1`);
  const item = (itemRows as unknown as any[])?.[0];
  if (!item) {
    res.status(400).json({ error: "Transfer item not found" });
    return;
  }

  const [serialRows] = await db.execute(sql`SELECT status, part_id AS partId FROM serial_numbers WHERE id = ${serialId} LIMIT 1`);
  const serial = (serialRows as unknown as any[])?.[0];
  if (!serial) {
    res.status(400).json({ error: "Serial not found" });
    return;
  }
  if (serial.status !== "in_stock") {
    res.status(400).json({ error: `Serial is not available (status: ${serial.status})` });
    return;
  }
  if (serial.partId !== item.partId) {
    res.status(400).json({ error: "Serial belongs to a different part" });
    return;
  }

  const [activeTfrRows] = await db.execute(sql`
    SELECT t.transfer_no AS transferNo, t.status
    FROM transfer_items ti
    JOIN transfers t ON t.id = ti.transfer_id
    WHERE ti.serial_id = ${serialId}
      AND ti.id != ${itemId}
      AND t.status IN ('draft', 'packed', 'in_transit')
  `);
  const activeTfr = (activeTfrRows as unknown as any[])?.[0];
  if (activeTfr) {
    res.status(400).json({ error: `Serial is already reserved on active Transfer ${activeTfr.transferNo} (${activeTfr.status})` });
    return;
  }

  const [prevRows] = await db.execute(sql`SELECT serial_id AS serialId FROM transfer_items WHERE id = ${itemId} LIMIT 1`);
  const prev = (prevRows as unknown as any[])[0] as any;
  await db.update(transferItems)
    .set({ serialId })
    .where(eq(transferItems.id, itemId));
  await writeAuditLog({
    actorId: req.user!.id,
    action: "update",
    entityType: "transfer_item",
    entityId: itemId,
    oldValue: prev ? { serialId: prev.serialId } : null,
    newValue: { serialId },
  });
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

transfersRouter.post("/:id/send-email", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const { include_attachment, pdf_base64, force_send } = req.body;

  const [transferRows] = await db.execute(sql`
    SELECT t.id, t.transfer_no AS transferNo, t.invoice_ref AS invoiceRef,
      t.status, t.fixably_series AS fixablySeries,
      t.receipt_token AS receiptToken,
      ds.contact_emails AS destContactEmails, ds.site_name AS destSiteName,
      ds.site_code AS destSiteCode
    FROM transfers t
    LEFT JOIN sites ds ON ds.id = t.destination_site_id
    WHERE t.id = ${id} LIMIT 1
  `);
  const t = (transferRows as unknown as any[])[0] as any;
  if (!t) { res.status(404).json({ ok: false, reason: "Transfer not found" }); return; }

  let receiptToken = t.receiptToken;
  if (!receiptToken) {
    receiptToken = uuid();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await db.update(transfers)
      .set({ receiptToken, tokenExpiresAt: expiresAt })
      .where(eq(transfers.id, id));
  }

  const emails: string[] = [];
  if (t.destContactEmails) {
    const parsed = typeof t.destContactEmails === "string" ? JSON.parse(t.destContactEmails) : t.destContactEmails;
    if (Array.isArray(parsed)) emails.push(...parsed.filter(Boolean).map(String));
  }
  if (!emails.length && !force_send) {
    res.json({ ok: false, packing_list_attached: false, reason: "No valid contact_emails for destination site" });
    return;
  }

  const emailId = uuid();
  await db.insert(transferEmails).values({
    id: emailId,
    transferId: id,
    recipientEmail: emails.join(", ") || "no-recipient",
    status: "pending",
    attemptCount: 0,
  });

  if (!emails.length) {
    await db.update(transferEmails).set({ status: "skipped", errorDetail: "No recipients" }).where(eq(transferEmails.id, emailId));
    res.json({ ok: false, packing_list_attached: false, reason: "No recipient emails configured" });
    return;
  }

  const attachments: Array<{ filename: string; content: string; contentType: string; encoding: string }> = [];
  if (include_attachment && pdf_base64) {
    attachments.push({
      filename: `${t.transferNo}-packing-list.pdf`,
      content: pdf_base64,
      encoding: "base64",
      contentType: "application/pdf",
    });
  }

  const frontendUrl = (process.env.CORS_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "");
  const confirmUrl = `${frontendUrl}/transfers/${id}/receive?token=${receiptToken}`;
  const transferLabel = t.invoiceRef || t.transferNo;

  const result = await sendEmail({
    to: emails,
    subject: `MDC Transfer ${transferLabel} — Dispatch Notification`,
    text: `Transfer ${transferLabel} has been dispatched to ${t.destSiteName} (${t.destSiteCode}).\n\nConfirm receipt here: ${confirmUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="background: #1a1a2e; padding: 20px; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 18px;">MDC Inventory</h1>
        </div>
        <div style="padding: 24px; background: #fff; border: 1px solid #e5e5e5;">
          <p style="margin: 0 0 16px; font-size: 14px; color: #333;">
            A transfer has been dispatched to <strong>${t.destSiteName}</strong> (${t.destSiteCode}).
          </p>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 8px 10px; background: #f9fafb; font-size: 12px; color: #666; border: 1px solid #e5e5e5;">Reference</td>
              <td style="padding: 8px 10px; font-size: 13px; font-weight: 700; font-family: monospace; border: 1px solid #e5e5e5;">${transferLabel}</td>
            </tr>
            <tr>
              <td style="padding: 8px 10px; background: #f9fafb; font-size: 12px; color: #666; border: 1px solid #e5e5e5;">Destination</td>
              <td style="padding: 8px 10px; font-size: 13px; border: 1px solid #e5e5e5;">${t.destSiteName} (${t.destSiteCode})</td>
            </tr>
          </table>
          <a href="${confirmUrl}"
            style="display: inline-block; background: #15803d; color: #fff; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 700; border-radius: 4px;">
            Confirm Receipt
          </a>
          <p style="margin: 16px 0 0; font-size: 12px; color: #888;">
            Or copy this link into your browser:<br>
            <a href="${confirmUrl}" style="color: #15803d; word-break: break-all;">${confirmUrl}</a>
          </p>
        </div>
      </div>`,
    attachments,
  });

  await db.update(transferEmails).set({
    status: result.ok ? "sent" : "failed",
    errorDetail: result.error ?? null,
    attemptCount: 1,
    lastAttemptedAt: new Date(),
    sentAt: result.ok ? new Date() : null,
  }).where(eq(transferEmails.id, emailId));

  res.json({
    ok: result.ok,
    packing_list_attached: result.ok && !!attachments.length,
    detail: result.error ?? null,
  });
});

transfersRouter.post("/:id/generate-pdf", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const { fileName } = req.body;

  await db.insert(packingLists).values({
    id: uuid(),
    transferId: id,
    filePath: fileName ?? `${id}.pdf`,
    generatedBy: req.user!.id,
  }).onDuplicateKeyUpdate({
    set: { filePath: fileName ?? `${id}.pdf`, generatedBy: req.user!.id, generatedAt: new Date() },
  });

  res.json({ ok: true });
});
