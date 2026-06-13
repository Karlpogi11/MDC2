import { Router } from "express";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { queryNumber, queryString } from "../utils/query";

export const auditLogsRouter = Router();

auditLogsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const page = Math.max(0, queryNumber(req.query.page, 0));
  const pageSize = Math.min(queryNumber(req.query.pageSize, 50), 200);
  const action = queryString(req.query.action);
  const entityType = queryString(req.query.entity_type);

  const clauses: any[] = [];
  if (action) clauses.push(sql`al.action = ${action}`);
  if (entityType) clauses.push(sql`al.entity_type = ${entityType}`);
  const whereClause = clauses.length ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``;

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT
        al.id, al.actor_id AS actorId, al.action, al.entity_type AS entityType,
        al.entity_id AS entityId, al.old_value AS oldValue, al.new_value AS newValue,
        al.note, al.previous_hash AS previousHash, al.hash, al.created_at AS createdAt,
        p.full_name AS actorFullName, p.username AS actorUsername
      FROM audit_logs al
      LEFT JOIN profiles p ON p.id = al.actor_id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ${pageSize} OFFSET ${page * pageSize}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS count FROM audit_logs al ${whereClause}
    `),
  ]);

  const dataRows = (dataResult as any[])[0] ?? [];
  const countRows = (countResult as any[])[0] ?? [];
  const total = Number(countRows[0]?.count ?? 0);

  const data = dataRows.map((r: any) => ({
    id: r.id,
    actorId: r.actorId,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    oldValue: r.oldValue,
    newValue: r.newValue,
    note: r.note,
    previousHash: r.previousHash,
    hash: r.hash,
    createdAt: r.createdAt,
    actor: { fullName: r.actorFullName, username: r.actorUsername },
  }));

  res.json({ data, total });
});
