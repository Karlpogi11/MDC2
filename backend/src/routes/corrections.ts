import { Router } from "express";
import { getDb } from "../db/connection";
import { workflowRequests, serialCorrections, serialNumbers, parts } from "../db/schema";
import { eq, and, inArray, desc, like } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const correctionsRouter = Router();

correctionsRouter.post("/workflow-requests", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = uuid();
  await db.insert(workflowRequests).values({
    ...req.body,
    id,
    requestedBy: req.user!.id,
    payload: req.body.payload ?? {},
  });
  res.json({ id });
});

correctionsRouter.get("/workflow-requests/pending", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.workflowRequests.findMany({
    where: and(
      eq(workflowRequests.status, "pending"),
      inArray(workflowRequests.type, ["serial_correction", "part_reassignment"]),
    ),
    orderBy: [desc(workflowRequests.requestedAt)],
    with: { requester: { columns: { fullName: true, username: true } } },
  });
  res.json(rows);
});

correctionsRouter.put("/workflow-requests/:id/approve", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  await db.update(workflowRequests)
    .set({ status: "approved", reviewedBy: req.user!.id, reviewedAt: new Date() })
    .where(eq(workflowRequests.id, req.params.id));
  res.json({ ok: true });
});

correctionsRouter.put("/workflow-requests/:id/reject", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  await db.update(workflowRequests)
    .set({ status: "rejected", reviewedBy: req.user!.id, reviewedAt: new Date() })
    .where(eq(workflowRequests.id, req.params.id));
  res.json({ ok: true });
});

correctionsRouter.get("/serial-corrections", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.query.serialCorrections.findMany({
    orderBy: [desc(serialCorrections.correctedAt)],
    limit: 50,
  });
  res.json(rows);
});
