import { Router } from "express";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const reportsRouter = Router();

reportsRouter.get("/transfers-by-site", authMiddleware, async (req, res) => {
  const db = await getDb();
  const range = parseInt(req.query.range as string) || 7;
  const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT
      t.id, t.transfer_no AS transferNo, t.status, t.created_at AS createdAt,
      s.site_name AS destSiteName, s.site_code AS destSiteCode,
      ti.id AS itemId
    FROM transfers t
    LEFT JOIN sites s ON s.id = t.destination_site_id
    LEFT JOIN transfer_items ti ON ti.transfer_id = t.id
    WHERE t.status IN ('received', 'in_transit')
      AND t.created_at >= ${since}
    ORDER BY t.created_at DESC
    LIMIT 5000
  `);
  const rawRows = (result as any[])[0] ?? [];

  const byTransfer = new Map<string, { transferNo: string; status: string; createdAt: string; destSiteName: string; destSiteCode: string; itemCount: number }>();
  for (const r of rawRows) {
    if (!byTransfer.has(r.id)) {
      byTransfer.set(r.id, {
        transferNo: r.transferNo,
        status: r.status,
        createdAt: r.createdAt,
        destSiteName: r.destSiteName,
        destSiteCode: r.destSiteCode,
        itemCount: 0,
      });
    }
    if (r.itemId) byTransfer.get(r.id)!.itemCount++;
  }

  const bySite = new Map<string, { siteName: string; siteCode: string; count: number; itemCount: number }>();
  for (const t of byTransfer.values()) {
    const key = t.destSiteCode ?? "unknown";
    if (!bySite.has(key)) {
      bySite.set(key, { siteName: t.destSiteName ?? "Unknown", siteCode: key, count: 0, itemCount: 0 });
    }
    bySite.get(key)!.count++;
    bySite.get(key)!.itemCount += t.itemCount;
  }

  res.json(Array.from(bySite.values()));
});

reportsRouter.get("/stock-in-this-week", authMiddleware, async (req, res) => {
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT
      sb.id, sb.source_type AS sourceType, sb.source_file_name AS sourceFileName,
      sb.file_hash AS fileHash, sb.imported_by AS importedBy,
      sb.imported_at AS importedAt, sb.total_rows AS totalRows,
      sb.success_rows AS successRows, sb.failed_rows AS failedRows,
      p.full_name AS operatorFullName, p.username AS operatorUsername
    FROM stock_in_batches sb
    LEFT JOIN profiles p ON p.id = sb.imported_by
    WHERE sb.imported_at >= ${since}
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

reportsRouter.get("/top-moved-parts", authMiddleware, async (req, res) => {
  const db = await getDb();
  const range = parseInt(req.query.range as string) || 7;
  const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT
      ti.qty, ti.created_at AS createdAt,
      p.part_name AS partName, p.part_number AS partNumber,
      t.status AS transferStatus, t.created_at AS transferCreatedAt
    FROM transfer_items ti
    LEFT JOIN parts p ON p.id = ti.part_id
    LEFT JOIN transfers t ON t.id = ti.transfer_id
    WHERE t.status IN ('in_transit', 'received')
      AND t.created_at >= ${since}
    LIMIT 5000
  `);
  const rawRows = (result as any[])[0] ?? [];

  const byPart = new Map<string, { partName: string; partNumber: string; transferredQty: number }>();
  for (const r of rawRows) {
    const key = r.partNumber ?? "unknown";
    if (!byPart.has(key)) {
      byPart.set(key, { partName: r.partName ?? "Unknown", partNumber: key, transferredQty: 0 });
    }
    byPart.get(key)!.transferredQty += r.qty;
  }

  res.json(Array.from(byPart.values()).sort((a, b) => b.transferredQty - a.transferredQty).slice(0, 50));
});
