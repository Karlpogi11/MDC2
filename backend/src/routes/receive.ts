import { Router } from "express";
import { getDb } from "../db/connection";
import { transfers, sites, serialNumbers } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const receiveRouter = Router();

receiveRouter.get("/transfer/:id", async (req, res) => {
  const db = await getDb();
  const { token } = req.query;

  const transfer = await db.query.transfers.findFirst({
    where: and(
      eq(transfers.id, req.params.id),
      eq(transfers.receiptToken, token as string),
    ),
    with: {
      sourceSite: { columns: { siteName: true } },
      destinationSite: { columns: { siteName: true, id: true } },
      items: {
        with: {
          part: { columns: { partNumber: true, partName: true } },
          serial: { columns: { serialNumber: true } },
        },
      },
    },
  });

  if (!transfer) { res.status(404).json({ error: "Transfer not found or invalid token" }); return; }
  res.json(transfer);
});

receiveRouter.post("/transfer/:id/confirm", async (req, res) => {
  const db = await getDb();
  const { token } = req.body;

  const transfer = await db.query.transfers.findFirst({
    where: and(eq(transfers.id, req.params.id), eq(transfers.receiptToken, token)),
    with: {
      destinationSite: { columns: { id: true } },
      items: { with: { serial: { columns: { serialNumber: true } } } },
    },
  });

  if (!transfer) { res.status(404).json({ error: "Invalid transfer or token" }); return; }

  await db.update(transfers)
    .set({ status: "received" })
    .where(eq(transfers.id, req.params.id));

  const serialNumbersList = transfer.items
    .filter((i) => i.serial?.serialNumber)
    .map((i) => i.serial!.serialNumber);

  if (serialNumbersList.length > 0 && transfer.destinationSite?.id) {
    await db.update(serialNumbers)
      .set({ currentSiteId: transfer.destinationSite.id })
      .where(inArray(serialNumbers.serialNumber, serialNumbersList));
  }

  res.json({ ok: true });
});
