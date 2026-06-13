import { Router } from "express";
import { getDb } from "../db/connection";
import { profiles } from "../db/schema";
import { eq, or, like, desc, sql } from "drizzle-orm";
import { authMiddleware, requireRole, hashPassword } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

export const usersRouter = Router();

usersRouter.get("/", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 200);
  const q = (req.query.q as string)?.trim();

  let conditions = undefined;
  if (q) {
    conditions = or(
      like(profiles.fullName, `%${q}%`),
      like(profiles.email, `%${q}%`),
      like(profiles.username, `%${q}%`),
    );
  }

  const [data, countResult] = await Promise.all([
    db.query.profiles.findMany({
      where: conditions,
      limit: pageSize,
      offset: page * pageSize,
      orderBy: [desc(profiles.createdAt)],
    }),
    db.select({ count: sql<number>`count(*)` }).from(profiles).where(conditions ?? sql`1=1`),
  ]);

  res.json({ data, total: Number(countResult[0]?.count ?? 0) });
});

usersRouter.get("/count", authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = await db.select({ count: sql<number>`count(*)` }).from(profiles);
  res.json({ count: Number(result[0]?.count ?? 0) });
});

usersRouter.get("/check-username", authMiddleware, async (req, res) => {
  const db = await getDb();
  const username = req.query.username as string;
  if (!username) { res.json({ available: false }); return; }
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.username, username) });
  res.json({ available: !existing });
});

usersRouter.post("/", authMiddleware, requireRole("system_admin"), async (req, res) => {
  const db = await getDb();
  const { email, username, fullName, password, role } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  let existing = null;
  if (email) {
    existing = await db.query.profiles.findFirst({
      where: or(eq(profiles.username, username), eq(profiles.email, email)),
    });
  } else {
    existing = await db.query.profiles.findFirst({
      where: eq(profiles.username, username),
    });
  }
  if (existing) { res.status(409).json({ error: "User exists" }); return; }

  const id = uuid();
  const passwordHash = await hashPassword(password);
  await db.insert(profiles).values({ id, email, username, fullName, role: role ?? "dc_viewer", passwordHash });
  res.json({ id });
});

usersRouter.put("/:id/role", authMiddleware, requireRole("system_admin"), async (req, res) => {
  const db = await getDb();
  await db.update(profiles).set({ role: req.body.role }).where(eq(profiles.id, req.params.id));
  res.json({ ok: true });
});

usersRouter.put("/:id/status", authMiddleware, requireRole("system_admin"), async (req, res) => {
  const db = await getDb();
  await db.update(profiles).set({ isActive: req.body.isActive }).where(eq(profiles.id, req.params.id));
  res.json({ ok: true });
});
