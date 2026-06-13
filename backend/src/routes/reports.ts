import { Router } from "express";
import { getDb } from "../db/connection";
import { transfers, transferItems, stockInBatches, serialNumbers, parts, sites, profiles } from "../db/schema";
import { eq, and, inArray, desc, gte, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const reportsRouter = Router();

reportsRouter.get("/transfers-by-site", authMiddleware, async (req, res) => {
  const db = await getDb();
  const range = parseInt(req.query.range as string) || 7;
  const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000);

  const rows = await db.query.transfers.findMany({
    where: and(
      inArray(transfers.status, ["received", "in_transit"]),
      gte(transfers.createdAt, since),
    ),
    limit: 5000,
    with: {
      destinationSite: { columns: { siteName: true, siteCode: true } },
      items: { columns: { id: true } },
    },
  });

  const bySite = new Map<string, { siteName: string; siteCode: string; count: number; itemCount: number }>();
  for (const t of rows) {
    const key = t.destinationSite?.siteCode ?? "unknown";
    if (!bySite.has(key)) {
      bySite.set(key, { siteName: t.destinationSite?.siteName ?? "Unknown", siteCode: key, count: 0, itemCount: 0 });
    }
    bySite.get(key)!.count++;
    bySite.get(key)!.itemCount += t.items.length;
  }

  res.json(Array.from(bySite.values()));
});

reportsRouter.get("/stock-in-this-week", authMiddleware, async (req, res) => {
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db.query.stockInBatches.findMany({
    where: gte(stockInBatches.importedAt, since),
    orderBy: [desc(stockInBatches.importedAt)],
    limit: 100,
    with: { operator: { columns: { fullName: true, username: true } } },
  });

  res.json(rows);
});

reportsRouter.get("/top-moved-parts", authMiddleware, async (req, res) => {
  const db = await getDb();
  const range = parseInt(req.query.range as string) || 7;
  const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000);

  const items = await db.query.transferItems.findMany({
    limit: 5000,
    with: {
      part: { columns: { partName: true, partNumber: true } },
      transfer: { columns: { status: true, createdAt: true } },
    },
  });

  const filtered = items.filter((i) =>
    i.transfer &&
    ["in_transit", "received"].includes(i.transfer.status) &&
    i.transfer.createdAt >= since,
  );

  const byPart = new Map<string, { partName: string; partNumber: string; transferredQty: number }>();
  for (const i of filtered) {
    const key = i.part?.partNumber ?? "unknown";
    if (!byPart.has(key)) {
      byPart.set(key, { partName: i.part?.partName ?? "Unknown", partNumber: key, transferredQty: 0 });
    }
    byPart.get(key)!.transferredQty += i.qty;
  }

  res.json(Array.from(byPart.values()).sort((a, b) => b.transferredQty - a.transferredQty).slice(0, 50));
});
