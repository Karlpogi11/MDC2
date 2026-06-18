import { Router } from "express";
import { getDb } from "../db/connection";
import { analyticsUploads, analyticsRows } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { eq, sql } from "drizzle-orm";
import { queryString } from "../utils/query";
import { randomUUID as uuid } from "node:crypto";

export const analyticsRouter = Router();

const NONE = "__none__";

function normalizeSiteCode(raw: string): string {
  const v = raw.trim();
  if (/^\d+$/.test(v)) return v.replace(/^0+/, "") || "0";
  return v.toUpperCase();
}

analyticsRouter.get("/dc-activity", authMiddleware, async (req, res) => {
  const db = await getDb();

  const [inStockRes] = await db.execute(sql`
    SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'in_stock'
  `);
  const [transferredRes] = await db.execute(sql`
    SELECT COUNT(*) as count FROM serial_numbers WHERE status = 'transferred'
  `);
  const [transferCountRes] = await db.execute(sql`
    SELECT COUNT(*) as count FROM transfers WHERE status != 'cancelled'
  `);
  const [receivedRes] = await db.execute(sql`
    SELECT COUNT(*) as received FROM transfers WHERE status = 'received'
  `);
  const [shippedRes] = await db.execute(sql`
    SELECT COUNT(*) as shipped FROM transfers WHERE status = 'in_transit'
  `);
  const topPartsRes = await db.execute(sql`
    SELECT p.part_number, p.part_name, COUNT(*) as qty
    FROM transfer_items ti
    JOIN transfers t ON t.id = ti.transfer_id
    JOIN parts p ON p.id = ti.part_id
    WHERE t.status != 'cancelled'
    GROUP BY ti.part_id
    ORDER BY qty DESC LIMIT 10
  `);
  const bySiteRes = await db.execute(sql`
    SELECT s.site_name as \`site\`, COUNT(*) as qty
    FROM transfers t
    JOIN sites s ON s.id = t.destination_site_id
    WHERE t.status != 'cancelled'
    GROUP BY t.destination_site_id
    ORDER BY qty DESC LIMIT 20
  `);
  const statusRes = await db.execute(sql`
    SELECT status, COUNT(*) as value
    FROM transfers
    WHERE status != 'cancelled'
    GROUP BY status
  `);
  const monthlyRes = await db.execute(sql`
    SELECT DATE_FORMAT(sn.stock_in_at, '%Y-%m') as month, COUNT(*) as stockIn, 0 as stockOut
    FROM serial_numbers sn
    WHERE sn.stock_in_at IS NOT NULL
    GROUP BY DATE_FORMAT(sn.stock_in_at, '%Y-%m')
    ORDER BY month
  `);

  const inStock = Number((inStockRes as any)?.count ?? 0);
  const inTransit = Number((transferredRes as any)?.count ?? 0);
  const totalTransfers = Number((transferCountRes as any)?.count ?? 0);
  const received = Number((receivedRes as any)?.received ?? 0);
  const shipped = Number((shippedRes as any)?.shipped ?? 0);

  const topPartsArr = Array.isArray(topPartsRes) ? topPartsRes as any[] : [];
  const bySiteArr = Array.isArray(bySiteRes) ? bySiteRes as any[] : [];
  const statusArr = Array.isArray(statusRes) ? statusRes as any[] : [];
  const monthlyArr = Array.isArray(monthlyRes) ? monthlyRes as any[] : [];

  res.json({
    kpi: {
      totalStockedIn: inStock,
      totalStockedOut: inTransit,
      totalTransfers,
      receivedRate: shipped > 0 ? Math.round((received / shipped) * 100) : 0,
      totalAvailable: inStock,
      totalCommitted: inTransit,
    },
    monthly: monthlyArr.map((r: any) => ({
      month: r.month,
      stockIn: Number(r.stockIn ?? 0),
      stockOut: 0,
    })),
    topParts: topPartsArr.map((r: any) => ({
      part_number: r.part_number,
      part_name: r.part_name,
      qty: Number(r.qty ?? 0),
    })),
    bySite: bySiteArr.map((r: any) => ({
      site: r.site,
      qty: Number(r.qty ?? 0),
    })),
    statusBreakdown: statusArr.map((r: any) => ({
      name: r.status,
      value: Number(r.value ?? 0),
      pct: 0,
      color: r.status === "in_transit" ? "#3b82f6" : r.status === "received" ? "#22c55e" : "#a0a0a0",
    })),
  });
});

analyticsRouter.get("/uploads", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.analyticsUploads.findMany({
    orderBy: [sql`uploaded_at DESC`],
    limit: 20,
  });
  res.json(rows);
});

analyticsRouter.post("/uploads", authMiddleware, async (req, res) => {
  const db = await getDb();
  const { source_type, file_name, uploaded_by, mapping, rows: rawRows } = req.body;

  if (!source_type || !file_name || !uploaded_by || !mapping || !rawRows?.length) {
    res.status(400).json({ error: "Missing required fields: source_type, file_name, uploaded_by, mapping, rows" });
    return;
  }

  const uploadId = uuid();
  const descLookup = new Map<string, string>();

  // Build description-to-part-number lookup from parts table
  const allPartsRes = await db.execute(sql`
    SELECT part_number, part_name FROM parts WHERE is_active = 1
  `);
  const allPartsArr = Array.isArray(allPartsRes) ? allPartsRes as any[] : [];
  for (const p of allPartsArr) {
    if (p.part_name) descLookup.set(p.part_name.trim().toLowerCase(), p.part_number);
  }

  const added: any[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const row of rawRows) {
    try {
      let part_number = (mapping.part_number !== NONE ? row[mapping.part_number] : "").trim();
      if (!part_number && mapping.description !== NONE) {
        const desc = (row[mapping.description] ?? "").trim().toLowerCase();
        if (desc) part_number = descLookup.get(desc) ?? desc;
      }
      if (!part_number) { skipped++; continue; }

      const rawQty = mapping.qty !== NONE ? row[mapping.qty] : "1";
      const qty = Math.max(1, parseInt(rawQty) || 1);
      const rawSite = mapping.site_code !== NONE ? row[mapping.site_code] : "";
      const site_code = rawSite ? normalizeSiteCode(rawSite) : null;
      const rawDate = mapping.used_at !== NONE ? row[mapping.used_at] : "";
      let used_at: string | null = rawDate ? rawDate.slice(0, 10) : null;
      if (used_at) {
        const yr = parseInt(used_at.slice(0, 4));
        const currentYr = new Date().getFullYear();
        if (yr > currentYr || yr < 2010) used_at = null;
      }

      added.push({
        id: uuid(),
        upload_id: uploadId,
        source_type,
        part_number,
        serial_number: null,
        site_code,
        used_at,
        qty,
      });
    } catch {
      skipped++;
    }
  }

  if (!added.length) {
    res.json({ added: 0, skipped, errors: ["No valid rows found after mapping."] });
    return;
  }

  // Delete previous upload data for this source type
  await db.execute(sql`DELETE FROM analytics_rows WHERE upload_id IN (SELECT id FROM analytics_uploads WHERE source_type = ${source_type})`);
  await db.execute(sql`DELETE FROM analytics_uploads WHERE source_type = ${source_type}`);

  // Insert new upload record
  await db.execute(sql`
    INSERT INTO analytics_uploads (id, source_type, file_name, file_path, uploaded_by, row_count, status, uploaded_at)
    VALUES (${uploadId}, ${source_type}, ${file_name}, ${file_name}, ${uploaded_by}, ${added.length}, 'completed', NOW())
  `);

  // Batch insert rows
  const chunkSize = 500;
  for (let i = 0; i < added.length; i += chunkSize) {
    const chunk = added.slice(i, i + chunkSize);
    const values = chunk.map((r: any) => sql`(${r.id}, ${r.upload_id}, ${r.source_type}, ${r.part_number}, ${r.serial_number}, ${r.site_code}, ${r.used_at}, ${r.qty}, NOW())`);
    await db.execute(sql`
      INSERT INTO analytics_rows (id, upload_id, source_type, part_number, serial_number, site_code, used_at, qty, created_at)
      VALUES ${sql.join(values, sql`, `)}
    `);
  }

  res.json({ added: added.length, skipped, errors });
});

analyticsRouter.get("/demand", authMiddleware, async (req, res) => {
  const db = await getDb();
  const from = queryString(req.query.from);
  const to = queryString(req.query.to);
  const siteCode = queryString(req.query.site_code);
  const series = queryString(req.query.series);

  const conditions: any[] = [sql`ar.used_at IS NOT NULL`];
  if (from) conditions.push(sql`ar.used_at >= ${from + "-01"}`);
  if (to) conditions.push(sql`ar.used_at < ${to + "-01"} + INTERVAL 1 MONTH`);
  if (siteCode) conditions.push(sql`ar.site_code = ${siteCode}`);
  if (series) {
    const seriesList = series.split(",").filter(Boolean);
    if (seriesList.length === 1) {
      conditions.push(sql`ar.part_number LIKE ${seriesList[0] + "%"}`);
    } else {
      const likeClauses = seriesList.map((s) => sql`ar.part_number LIKE ${s + "%"}`);
      conditions.push(sql`(${sql.join(likeClauses, sql` OR `)})`);
    }
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const kpiRes: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(ar.qty), 0) as totalRepairs,
      COUNT(DISTINCT ar.part_number) as uniqueParts
    FROM analytics_rows ar WHERE ${whereClause}
  `);

  const monthlyRes: any = await db.execute(sql`
    SELECT DATE_FORMAT(ar.used_at, '%Y-%m') as month, SUM(ar.qty) as qty
    FROM analytics_rows ar WHERE ${whereClause}
    GROUP BY DATE_FORMAT(ar.used_at, '%Y-%m')
    ORDER BY month
  `);

  const topPartsRes: any = await db.execute(sql`
    SELECT ar.part_number, p.part_name, SUM(ar.qty) as value
    FROM analytics_rows ar
    LEFT JOIN parts p ON p.part_number = ar.part_number
    WHERE ${whereClause}
    GROUP BY ar.part_number
    ORDER BY value DESC LIMIT 10
  `);

  const bySiteRes: any = await db.execute(sql`
    SELECT COALESCE(ar.site_code, 'Unknown') as \`name\`, SUM(ar.qty) as \`value\`
    FROM analytics_rows ar WHERE ${whereClause}
    GROUP BY ar.site_code
    ORDER BY value DESC LIMIT 20
  `);

  const topSiteRes: any = await db.execute(sql`
    SELECT ar.site_code as site
    FROM analytics_rows ar WHERE ${whereClause} AND ar.site_code IS NOT NULL
    GROUP BY ar.site_code
    ORDER BY SUM(ar.qty) DESC LIMIT 1
  `);

  const kpiRows = Array.isArray(kpiRes) ? kpiRes as any[] : [];
  const monthlyRows = Array.isArray(monthlyRes) ? monthlyRes as any[] : [];
  const topPartsRows = Array.isArray(topPartsRes) ? topPartsRes as any[] : [];
  const bySiteRows = Array.isArray(bySiteRes) ? bySiteRes as any[] : [];
  const topSiteRows = Array.isArray(topSiteRes) ? topSiteRes as any[] : [];

  const kpi = kpiRows[0] ?? { totalRepairs: 0, uniqueParts: 0 };
  const isFiltered = !!(from || to || siteCode || series);

  res.json({
    kpi: {
      totalRepairs: Number(kpi.totalRepairs ?? 0),
      uniqueParts: Number(kpi.uniqueParts ?? 0),
      topSite: topSiteRows[0]?.site ?? null,
    },
    monthly: monthlyRows.map((r: any) => ({
      month: r.month,
      qty: Number(r.qty ?? 0),
    })),
    topParts: topPartsRows.map((r: any) => ({
      name: r.part_number,
      value: Number(r.value ?? 0),
      label: r.part_name ?? r.part_number,
    })),
    bySite: bySiteRows.map((r: any) => ({
      name: r.name,
      value: Number(r.value ?? 0),
    })),
    isFiltered,
  });
});

analyticsRouter.get("/series-list", authMiddleware, async (req, res) => {
  const db = await getDb();
  const result: any = await db.execute(sql`
    SELECT DISTINCT SUBSTRING_INDEX(ar.part_number, '-', 1) as series
    FROM analytics_rows ar
    WHERE ar.part_number LIKE '%-%'
    ORDER BY series
  `);
  const rows = Array.isArray(result) ? result as any[] : [];
  res.json(rows.map((r: any) => r.series).filter(Boolean));
});

analyticsRouter.get("/abc", authMiddleware, async (req, res) => {
  const db = await getDb();
  const series = queryString(req.query.series);

  let whereClause = sql`1=1`;
  if (series) {
    const seriesList = series.split(",").filter(Boolean);
    if (seriesList.length === 1) {
      whereClause = sql`ar.part_number LIKE ${seriesList[0] + "%"}`;
    } else {
      const likeClauses = seriesList.map((s) => sql`ar.part_number LIKE ${s + "%"}`);
      whereClause = sql`(${sql.join(likeClauses, sql` OR `)})`;
    }
  }

  const abcRes: any = await db.execute(sql`
    SELECT ar.part_number, p.part_name, SUM(ar.qty) as total_qty
    FROM analytics_rows ar
    LEFT JOIN parts p ON p.part_number = ar.part_number
    WHERE ${whereClause}
    GROUP BY ar.part_number
    HAVING total_qty > 0
    ORDER BY total_qty DESC
  `);

  const partsList = Array.isArray(abcRes) ? abcRes as any[] : [];
  const totalQty = partsList.reduce((s: number, r: any) => s + Number(r.total_qty ?? 0), 0);

  let cumulative = 0;
  const classified = partsList.map((r: any) => {
    cumulative += Number(r.total_qty ?? 0);
    const pct = totalQty > 0 ? cumulative / totalQty : 0;
    const tier = pct <= 0.80 ? "A" as const : pct <= 0.95 ? "B" as const : "C" as const;
    return {
      part_number: r.part_number,
      part_name: r.part_name,
      total_qty: Number(r.total_qty ?? 0),
      tier,
    };
  });

  const aCount = classified.filter((r) => r.tier === "A").reduce((s, r) => s + r.total_qty, 0);
  const bCount = classified.filter((r) => r.tier === "B").reduce((s, r) => s + r.total_qty, 0);
  const cCount = classified.filter((r) => r.tier === "C").reduce((s, r) => s + r.total_qty, 0);

  res.json({
    donut: [
      { name: "A (top 80%)", value: aCount, color: "#22c55e" },
      { name: "B (next 15%)", value: bCount, color: "#3b82f6" },
      { name: "C (bottom 5%)", value: cCount, color: "#a0a0a0" },
    ],
    rows: classified,
  });
});

analyticsRouter.get("/velocity", authMiddleware, async (req, res) => {
  const db = await getDb();
  const series = queryString(req.query.series);

  let whereClause = sql`1=1`;
  if (series) {
    const seriesList = series.split(",").filter(Boolean);
    if (seriesList.length === 1) {
      whereClause = sql`ar.part_number LIKE ${seriesList[0] + "%"}`;
    } else {
      const likeClauses = seriesList.map((s) => sql`ar.part_number LIKE ${s + "%"}`);
      whereClause = sql`(${sql.join(likeClauses, sql` OR `)})`;
    }
  }

  const velRes: any = await db.execute(sql`
    SELECT
      ar.part_number,
      p.part_name,
      SUM(ar.qty) as total_qty,
      DATEDIFF(CURRENT_DATE, MAX(ar.used_at)) as days_since_last
    FROM analytics_rows ar
    LEFT JOIN parts p ON p.part_number = ar.part_number
    WHERE ${whereClause}
    GROUP BY ar.part_number
    HAVING total_qty > 0
    ORDER BY days_since_last ASC
  `);

  const partsList = Array.isArray(velRes) ? velRes as any[] : [];

  const classified = partsList.map((r: any) => {
    const days = r.days_since_last !== null ? Number(r.days_since_last) : 999;
    const category = days <= 30 ? "fast" as const : days <= 90 ? "slow" as const : "dead" as const;
    return {
      part_number: r.part_number,
      part_name: r.part_name,
      total_qty: Number(r.total_qty ?? 0),
      days_since_last: r.days_since_last !== null ? Number(r.days_since_last) : null,
      category,
    };
  });

  const fastCount = classified.filter((r) => r.category === "fast").reduce((s, r) => s + r.total_qty, 0);
  const slowCount = classified.filter((r) => r.category === "slow").reduce((s, r) => s + r.total_qty, 0);
  const deadCount = classified.filter((r) => r.category === "dead").reduce((s, r) => s + r.total_qty, 0);

  res.json({
    donut: [
      { name: "Fast ≤30d", value: fastCount, color: "#22c55e" },
      { name: "Slow 31–90d", value: slowCount, color: "#f59e0b" },
      { name: "Dead 90d+", value: deadCount, color: "#a0a0a0" },
    ],
    rows: classified,
  });
});

analyticsRouter.delete("/uploads/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  await db.delete(analyticsRows).where(eq(analyticsRows.uploadId, id));
  await db.delete(analyticsUploads).where(eq(analyticsUploads.id, id));
  res.json({ ok: true });
});
