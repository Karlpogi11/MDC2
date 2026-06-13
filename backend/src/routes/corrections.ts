import { Router } from "express";
import { getDb } from "../db/connection";
import { workflowRequests, serialCorrections } from "../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";
import { queryString } from "../utils/query";

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
  const result = await db.execute(sql`
    SELECT
      wr.id, wr.type, wr.status,
      wr.entity_type AS entityType, wr.entity_id AS entityId,
      wr.payload, wr.requested_by AS requestedBy, wr.reviewed_by AS reviewedBy,
      wr.review_note AS reviewNote, wr.requested_at AS requestedAt,
      wr.reviewed_at AS reviewedAt, wr.updated_at AS updatedAt,
      p.full_name AS reqFullName, p.username AS reqUsername
    FROM workflow_requests wr
    LEFT JOIN profiles p ON p.id = wr.requested_by
    WHERE wr.status = 'pending'
      AND wr.type IN ('serial_correction', 'part_reassignment')
    ORDER BY wr.requested_at DESC
  `);
  const rawRows = (result as any[])[0] ?? [];
  const rows = rawRows.map((r: any) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    entityType: r.entityType,
    entityId: r.entityId,
    payload: r.payload,
    requestedBy: r.requestedBy,
    reviewedBy: r.reviewedBy,
    reviewNote: r.reviewNote,
    requestedAt: r.requestedAt,
    reviewedAt: r.reviewedAt,
    updatedAt: r.updatedAt,
    requester: { fullName: r.reqFullName, username: r.reqUsername },
  }));
  res.json(rows);
});

correctionsRouter.put("/workflow-requests/:id/approve", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  await db.update(workflowRequests)
    .set({ status: "approved", reviewedBy: req.user!.id, reviewedAt: new Date() })
    .where(eq(workflowRequests.id, id));
  res.json({ ok: true });
});

correctionsRouter.put("/workflow-requests/:id/reject", authMiddleware, requireRole("dc_admin"), async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  await db.update(workflowRequests)
    .set({ status: "rejected", reviewedBy: req.user!.id, reviewedAt: new Date() })
    .where(eq(workflowRequests.id, id));
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
