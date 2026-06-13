import { Router } from "express";
import { getDb } from "../db/connection";
import { notifications } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const notificationsRouter = Router();

notificationsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const unreadOnly = req.query.unread !== "false";

  let conditions = eq(notifications.userId, req.user!.id);
  if (unreadOnly) conditions = and(conditions, sql`read_at IS NULL`);

  const rows = await db.query.notifications.findMany({
    where: conditions,
    orderBy: [desc(notifications.createdAt)],
    limit: 50,
  });
  res.json(rows);
});

notificationsRouter.put("/:id/read", authMiddleware, async (req, res) => {
  const db = await getDb();
  await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user!.id)));
  res.json({ ok: true });
});
