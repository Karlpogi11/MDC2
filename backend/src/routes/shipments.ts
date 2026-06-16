import { Router } from "express";
import { getDb } from "../db/connection";
import { authMiddleware, requireRole } from "../middleware/auth";
import { transfers, serialNumbers, transferEmails } from "../db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID as uuid } from "node:crypto";
import { writeAuditLog } from "../utils/audit";
import { sendEmail } from "../utils/mail";
import { queryString } from "../utils/query";

export const shipmentsRouter = Router();

const SHIP = ["system_admin", "dc_admin", "shipping_coordinator"];

// GET /api/shipments/pending
// Returns transfers that need shipping attention: draft (needs booking) and packed (ready to dispatch)
shipmentsRouter.get("/pending", authMiddleware, requireRole(...SHIP), async (req, res) => {
  const db = await getDb();
  const [rows] = await db.execute(sql`
    SELECT
      t.id, t.transfer_no AS transferNo, t.invoice_ref AS invoiceRef,
      t.fixably_series AS fixablySeries,
      t.courier_name AS courierName, t.tracking_number AS trackingNumber,
      t.status, t.packed_at AS packedAt, t.booked_at AS bookedAt,
      t.created_at AS createdAt,
      ds.site_name AS destSiteName, ds.site_code AS destSiteCode,
      rp.full_name AS reqFullName,
      bp.full_name AS bookedByName,
      (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS itemCount,
      (SELECT COALESCE(SUM(ti.qty), 0) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS totalUnits
    FROM transfers t
    LEFT JOIN sites ds ON ds.id = t.destination_site_id
    LEFT JOIN profiles rp ON rp.id = t.requested_by
    LEFT JOIN profiles bp ON bp.id = t.booked_by
    WHERE t.status IN ('draft', 'booked', 'packed')
    ORDER BY t.created_at ASC
  `);
  const data = (rows as unknown as any[]) ?? [];
  res.json({ data });
});

// POST /api/shipments/:id/book
// Shipping coordinator books a courier for a draft transfer → status becomes "booked"
shipmentsRouter.post("/:id/book", authMiddleware, requireRole(...SHIP), async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const { courierName, trackingNumber, fixablySeries } = req.body;

  if (!id) { res.status(400).json({ error: "Invalid transfer ID" }); return; }
  if (!courierName?.trim()) {
    res.status(400).json({ error: "Courier name is required" });
    return;
  }

  const [prevRows] = await db.execute(sql`
    SELECT status FROM transfers WHERE id = ${id} LIMIT 1
  `);
  const prev = (prevRows as unknown as any[])?.[0];
  if (!prev) { res.status(404).json({ error: "Transfer not found" }); return; }
  if (prev.status !== "draft") {
    res.status(400).json({ error: `Cannot book transfer in ${prev.status} status` });
    return;
  }

  await db.update(transfers)
    .set({
      status: "booked",
      courierName: courierName.trim(),
      trackingNumber: trackingNumber?.trim() ?? null,
      fixablySeries: fixablySeries?.trim() ?? null,
      bookedBy: req.user!.id,
      bookedAt: new Date(),
    })
    .where(eq(transfers.id, id));

  await writeAuditLog({
    actorId: req.user!.id,
    action: "update",
    entityType: "transfer",
    entityId: id,
    newValue: { status: "booked", courierName, trackingNumber, fixablySeries },
    note: `Courier booked: ${courierName}`,
  });

  res.json({ ok: true });
});

// POST /api/shipments/:id/dispatch
// Shipping coordinator confirms packed transfer handed to courier → status becomes "in_transit"
shipmentsRouter.post("/:id/dispatch", authMiddleware, requireRole(...SHIP), async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  if (!id) { res.status(400).json({ error: "Invalid transfer ID" }); return; }

  const [prevRows] = await db.execute(sql`
    SELECT t.status, t.transfer_no AS transferNo, t.invoice_ref AS invoiceRef,
      t.courier_name AS courierName, t.fixably_series AS fixablySeries,
      t.receipt_token AS receiptToken,
      ds.contact_emails AS destContactEmails, ds.site_name AS destSiteName,
      ds.site_code AS destSiteCode, ds.id AS destId
    FROM transfers t
    LEFT JOIN sites ds ON ds.id = t.destination_site_id
    WHERE t.id = ${id} LIMIT 1
  `);
  const prev = (prevRows as unknown as any[])?.[0];
  if (!prev) { res.status(404).json({ error: "Transfer not found" }); return; }
  if (prev.status !== "packed") {
    res.status(400).json({ error: `Cannot dispatch transfer in ${prev.status} status` });
    return;
  }

  const receiptToken = prev.receiptToken ?? uuid();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.update(transfers)
    .set({
      status: "in_transit",
      shippedBy: req.user!.id,
      shippedAt: new Date(),
      receiptToken,
      tokenExpiresAt: expiresAt,
    })
    .where(eq(transfers.id, id));

  // Update serial numbers to "transferred"
  const [serialRows] = await db.execute(sql`
    SELECT sn.id, sn.serial_number AS serialNumber FROM transfer_items ti
    JOIN serial_numbers sn ON sn.id = ti.serial_id
    WHERE ti.transfer_id = ${id}
  `);
  const serials = (serialRows as unknown as any[]) ?? [];
  const serialIds = serials.map((r: any) => r.id);
  if (serialIds.length) {
    await db.update(serialNumbers)
      .set({ status: "transferred" })
      .where(inArray(serialNumbers.id, serialIds));
    for (const s of serials) {
      await writeAuditLog({
        actorId: req.user!.id,
        action: "update",
        entityType: "serial_number",
        entityId: s.id,
        newValue: { status: "transferred" },
        note: `Dispatched in transfer`,
      });
    }
  }

  await writeAuditLog({
    actorId: req.user!.id,
    action: "update",
    entityType: "transfer",
    entityId: id,
    oldValue: { status: "packed" },
    newValue: { status: "in_transit" },
    note: `Transfer dispatched`,
  });

  // Send dispatch email
  const emails: string[] = [];
  if (prev.destContactEmails) {
    const parsed = typeof prev.destContactEmails === "string" ? JSON.parse(prev.destContactEmails) : prev.destContactEmails;
    if (Array.isArray(parsed)) emails.push(...parsed.filter(Boolean).map(String));
  }

  let emailSent = false;
  if (emails.length > 0) {
    const frontendUrl = (process.env.CORS_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "");
    const confirmUrl = `${frontendUrl}/transfers/${id}/receive?token=${receiptToken}`;
    const transferLabel = prev.invoiceRef || prev.transferNo;

    const result = await sendEmail({
      to: emails,
      subject: `MDC Transfer ${transferLabel} — Dispatch Notification`,
      text: `Transfer ${transferLabel} has been dispatched to ${prev.destSiteName} (${prev.destSiteCode}).\n\nConfirm receipt here: ${confirmUrl}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background: #1a1a2e; padding: 20px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 18px;">MDC Inventory</h1>
          </div>
          <div style="padding: 24px; background: #fff; border: 1px solid #e5e5e5;">
            <p style="margin: 0 0 16px; font-size: 14px; color: #333;">
              A transfer has been dispatched to <strong>${prev.destSiteName}</strong> (${prev.destSiteCode}).
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 8px 10px; background: #f9fafb; font-size: 12px; color: #666; border: 1px solid #e5e5e5;">Reference</td>
                <td style="padding: 8px 10px; font-size: 13px; font-weight: 700; font-family: monospace; border: 1px solid #e5e5e5;">${transferLabel}</td>
              </tr>
              <tr>
                <td style="padding: 8px 10px; background: #f9fafb; font-size: 12px; color: #666; border: 1px solid #e5e5e5;">Courier</td>
                <td style="padding: 8px 10px; font-size: 13px; border: 1px solid #e5e5e5;">${prev.courierName ?? "—"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 10px; background: #f9fafb; font-size: 12px; color: #666; border: 1px solid #e5e5e5;">Destination</td>
                <td style="padding: 8px 10px; font-size: 13px; border: 1px solid #e5e5e5;">${prev.destSiteName} (${prev.destSiteCode})</td>
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
    });

    emailSent = result.ok;

    const emailId = uuid();
    await db.insert(transferEmails).values({
      id: emailId,
      transferId: id,
      recipientEmail: emails.join(", "),
      status: result.ok ? "sent" : "failed",
      attemptCount: 1,
      lastAttemptedAt: new Date(),
      sentAt: result.ok ? new Date() : null,
      errorDetail: result.error ?? null,
    });
  }

  res.json({ ok: true, emailSent });
});