import { Router } from "express";
import { getDb } from "../db/connection";
import { transfers, serialNumbers } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const receiveRouter = Router();

receiveRouter.get("/transfer/:id", async (req, res) => {
  const db = await getDb();
  const token = req.query.token as string;
  if (!token) { res.status(404).json({ error: "Transfer not found or invalid token" }); return; }

  const transferResult = await db.execute(sql`
    SELECT
      t.id, t.transfer_no AS transferNo, t.invoice_ref AS invoiceRef,
      t.fixably_series AS fixablySeries, t.source_site_id AS sourceSiteId,
      t.destination_site_id AS destinationSiteId, t.status,
      t.requested_by AS requestedBy, t.packed_by AS packedBy,
      t.packed_at AS packedAt, t.receipt_token AS receiptToken,
      t.token_expires_at AS tokenExpiresAt,
      t.created_at AS createdAt, t.updated_at AS updatedAt,
      ss.site_name AS srcSiteName,
      ds.site_name AS destSiteName, ds.id AS destId
    FROM transfers t
    LEFT JOIN sites ss ON ss.id = t.source_site_id
    LEFT JOIN sites ds ON ds.id = t.destination_site_id
    WHERE t.id = ${req.params.id}
      AND t.receipt_token = ${token}
    LIMIT 1
  `);
  const transferRows = (transferResult as any[])[0] ?? [];
  if (!transferRows.length) { res.status(404).json({ error: "Transfer not found or invalid token" }); return; }

  const t = transferRows[0];

  const itemResult = await db.execute(sql`
    SELECT
      ti.id, ti.transfer_id AS transferId, ti.part_id AS partId,
      ti.serial_id AS serialId, ti.qty, ti.created_at AS createdAt,
      p.part_number AS partNumber, p.part_name AS partName,
      sn.serial_number AS serialNumber
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
    sourceSite: { siteName: t.srcSiteName },
    destinationSite: { siteName: t.destSiteName, id: t.destId },
    items: itemRows.map((i: any) => ({
      id: i.id,
      transferId: i.transferId,
      partId: i.partId,
      serialId: i.serialId,
      qty: i.qty,
      createdAt: i.createdAt,
      part: { partNumber: i.partNumber, partName: i.partName },
      serial: i.serialNumber ? { serialNumber: i.serialNumber } : null,
    })),
  };

  res.json(transfer);
});

receiveRouter.post("/transfer/:id/confirm", async (req, res) => {
  const db = await getDb();
  const token = req.body.token as string;
  if (!token) { res.status(404).json({ error: "Invalid transfer or token" }); return; }

  const transferResult = await db.execute(sql`
    SELECT
      t.id, t.destination_site_id AS destinationSiteId,
      sn.serial_number AS serialNumber
    FROM transfers t
    LEFT JOIN transfer_items ti ON ti.transfer_id = t.id
    LEFT JOIN serial_numbers sn ON sn.id = ti.serial_id
    WHERE t.id = ${req.params.id}
      AND t.receipt_token = ${token}
  `);
  const transferRows = (transferResult as any[])[0] ?? [];
  if (!transferRows.length) { res.status(404).json({ error: "Invalid transfer or token" }); return; }

  const t = transferRows[0];

  await db.update(transfers)
    .set({ status: "received" })
    .where(eq(transfers.id, req.params.id));

  const serialNumbersList = transferRows
    .filter((r: any) => r.serialNumber)
    .map((r: any) => r.serialNumber);

  if (serialNumbersList.length > 0 && t.destinationSiteId) {
    await db.update(serialNumbers)
      .set({ currentSiteId: t.destinationSiteId })
      .where(inArray(serialNumbers.serialNumber, serialNumbersList));
  }

  res.json({ ok: true });
});
