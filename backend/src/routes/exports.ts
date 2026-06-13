import { Router } from "express";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const exportsRouter = Router();

exportsRouter.get("/stocked-in", authMiddleware, async (req, res) => {
  const db = await getDb();
  const from = req.query.from as string;
  const to = req.query.to as string;

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
    WHERE 1=1
    ${from ? sql`AND sn.stock_in_at >= ${new Date(from)}` : sql``}
    ${to ? sql`AND sn.stock_in_at <= ${new Date(to)}` : sql``}
    ORDER BY sn.stock_in_at DESC
    LIMIT 10000
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

exportsRouter.get("/stocked-out", authMiddleware, async (req, res) => {
  const db = await getDb();

  const result = await db.execute(sql`
    SELECT
      ti.id, ti.transfer_id AS transferId, ti.part_id AS partId, ti.serial_id AS serialId,
      ti.qty, ti.created_at AS createdAt,
      p.part_number AS partNumber, p.part_name AS partName,
      sn.serial_number AS serialNumber,
      t.transfer_no AS transferNo, t.status AS transferStatus,
      t.created_at AS transferCreatedAt, t.packed_at AS transferPackedAt,
      s.site_name AS destSiteName, s.site_code AS destSiteCode,
      pr.full_name AS reqFullName, pr.username AS reqUsername
    FROM transfer_items ti
    LEFT JOIN parts p ON p.id = ti.part_id
    LEFT JOIN serial_numbers sn ON sn.id = ti.serial_id
    LEFT JOIN transfers t ON t.id = ti.transfer_id
    LEFT JOIN sites s ON s.id = t.destination_site_id
    LEFT JOIN profiles pr ON pr.id = t.requested_by
    LIMIT 10000
  `);
  const rawRows = (result as any[])[0] ?? [];
  const rows = rawRows.map((r: any) => ({
    id: r.id,
    transferId: r.transferId,
    partId: r.partId,
    serialId: r.serialId,
    qty: r.qty,
    createdAt: r.createdAt,
    part: { partNumber: r.partNumber, partName: r.partName },
    serial: r.serialNumber ? { serialNumber: r.serialNumber } : null,
    transfer: {
      transferNo: r.transferNo,
      status: r.transferStatus,
      createdAt: r.transferCreatedAt,
      packedAt: r.transferPackedAt,
      destinationSite: { siteName: r.destSiteName, siteCode: r.destSiteCode },
      requestedByProfile: { fullName: r.reqFullName, username: r.reqUsername },
    },
  }));
  res.json(rows);
});
