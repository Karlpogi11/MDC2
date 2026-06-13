import { Router } from "express";
import { getDb } from "../db/connection";
import { serialNumbers, transferItems, parts, sites, stockInBatches, transfers, profiles } from "../db/schema";
import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const exportsRouter = Router();

exportsRouter.get("/stocked-in", authMiddleware, async (req, res) => {
  const db = await getDb();
  const from = req.query.from as string;
  const to = req.query.to as string;

  let conditions = undefined;
  if (from) conditions = gte(serialNumbers.stockInAt, new Date(from));
  if (to) conditions = and(conditions, lte(serialNumbers.stockInAt, new Date(to)));

  const rows = await db.query.serialNumbers.findMany({
    where: conditions,
    limit: 10000,
    orderBy: [desc(serialNumbers.stockInAt)],
    with: {
      part: { columns: { partNumber: true, partName: true, category: true } },
      site: { columns: { siteName: true, siteCode: true } },
      batch: { columns: { sourceType: true, importedAt: true } },
    },
  });

  res.json(rows);
});

exportsRouter.get("/stocked-out", authMiddleware, async (req, res) => {
  const db = await getDb();

  const items = await db.query.transferItems.findMany({
    limit: 10000,
    with: {
      part: { columns: { partNumber: true, partName: true } },
      serial: { columns: { serialNumber: true } },
      transfer: {
        columns: { transferNo: true, status: true, createdAt: true, packedAt: true },
        with: {
          destinationSite: { columns: { siteName: true, siteCode: true } },
          requestedByProfile: { columns: { fullName: true, username: true } },
        },
      },
    },
  });

  res.json(items);
});
