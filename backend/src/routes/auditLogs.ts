import { Router } from "express";
import { getDb } from "../db/connection";
import { auditLogs, profiles } from "../db/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const auditLogsRouter = Router();

auditLogsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 200);
  const action = req.query.action as string;
  const entityType = req.query.entity_type as string;

  let conditions = undefined;
  if (action) conditions = eq(auditLogs.action, action);
  if (entityType) conditions = and(conditions, eq(auditLogs.entityType, entityType));

  const [data, countResult] = await Promise.all([
    db.query.auditLogs.findMany({
      where: conditions,
      limit: pageSize,
      offset: page * pageSize,
      orderBy: [desc(auditLogs.createdAt)],
      with: {
        actor: { columns: { fullName: true, username: true } },
      },
    }),
    db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(conditions ?? sql`1=1`),
  ]);

  res.json({ data, total: Number(countResult[0]?.count ?? 0) });
});
