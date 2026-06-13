import { Router } from "express";
import { getDb } from "../db/connection";
import { transfers, transferItems, sites, profiles, parts, serialNumbers, appConfig } from "../db/schema";
import { eq, and, desc, inArray, like, gte, lt, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const transfersRouter = Router();

transfersRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const status = req.query.status as string;
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);

  let conditions = undefined;
  if (status) conditions = eq(transfers.status, status);

  const [data, countResult] = await Promise.all([
    db.query.transfers.findMany({
      where: conditions,
      limit,
      offset: page * limit,
      orderBy: [desc(transfers.createdAt)],
      with: {
        destinationSite: { columns: { siteName: true, siteCode: true } },
        requestedByProfile: { columns: { fullName: true, username: true } },
        items: { columns: { id: true } },
      },
    }),
    db.select({ count: sql<number>`count(*)` }).from(transfers).where(conditions ?? sql`1=1`),
  ]);

  const rows = data.map((t) => ({
    ...t,
    itemCount: t.items.length,
    items: undefined,
  }));

  res.json({
    data: rows,
    total: Number(countResult[0]?.count ?? 0),
    page,
    pageSize: limit,
  });
});

transfersRouter.get("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  const transfer = await db.query.transfers.findFirst({
    where: eq(transfers.id, req.params.id),
    with: {
      sourceSite: true,
      destinationSite: true,
      requestedByProfile: { columns: { fullName: true, username: true } },
      packedByProfile: { columns: { fullName: true, username: true } },
      items: {
        with: {
          part: { columns: { id: true, partNumber: true, partName: true, category: true } },
          serial: { columns: { serialNumber: true, status: true } },
        },
      },
    },
  });
  if (!transfer) { res.status(404).json({ error: "Transfer not found" }); return; }
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

  await db.update(transfers)
    .set({
      status,
      ...(status === "packed" ? { packedBy: actorId ?? req.user!.id, packedAt: new Date() } : {}),
    })
    .where(eq(transfers.id, req.params.id));

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
  await db.update(transfers)
    .set({ receiptToken: token, tokenExpiresAt: expiresAt ? new Date(expiresAt) : undefined })
    .where(eq(transfers.id, req.params.id));
  res.json({ ok: true });
});

transfersRouter.get("/:id/email-config", authMiddleware, async (req, res) => {
  const db = await getDb();
  const config = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, "send_email_on_dispatch"),
  });
  res.json({ sendEmail: config?.value === "true" });
});
