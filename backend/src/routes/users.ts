import { Router } from "express";
import { getDb } from "../db/connection";
import { profiles } from "../db/schema";
import { eq, or, like, desc, sql } from "drizzle-orm";
import { authMiddleware, requireRole, hashPassword } from "../middleware/auth";
import { randomUUID as uuid, randomBytes } from "node:crypto";
import { queryNumber, queryString } from "../utils/query";
import { sendEmail } from "../utils/mail";

export const usersRouter = Router();

usersRouter.get("/", authMiddleware, requireRole("system_admin", "dc_admin"), async (req, res) => {
  const db = await getDb();
  const page = Math.max(0, queryNumber(req.query.page, 0));
  const pageSize = Math.min(queryNumber(req.query.pageSize, 50), 200);
  const q = queryString(req.query.q)?.trim();

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
  const username = queryString(req.query.username);
  if (!username) { res.json({ available: false }); return; }
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.username, username) });
  res.json({ available: !existing });
});

usersRouter.post("/invite", authMiddleware, requireRole("system_admin"), async (req, res) => {
  const db = await getDb();
  const { email, username, fullName, role } = req.body;
  if (!email || !username) {
    res.status(400).json({ error: "Email and username required" });
    return;
  }
  if (/\s/.test(username)) {
    res.status(400).json({ error: "Username must not contain spaces" });
    return;
  }

  const existing = await db.query.profiles.findFirst({
    where: or(eq(profiles.username, username), eq(profiles.email, email)),
  });
  if (existing) {
    res.status(409).json({ error: "User with that email or username already exists" });
    return;
  }

  const tempPassword = randomBytes(4).toString("hex"); // 8-char hex
  const id = uuid();
  const passwordHash = await hashPassword(tempPassword);
  await db.insert(profiles).values({ id, email, username, fullName, role: role ?? "dc_viewer", passwordHash });

  const appUrl = req.headers.origin ?? "http://localhost:5173";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body{font-family:sans-serif;padding:24px;color:#333;max-width:480px}
h2{font-size:16px;margin:0 0 12px}
p{font-size:13px;line-height:1.5;margin:0 0 8px}
code{display:inline-block;background:#f4f4f4;padding:2px 8px;border-radius:3px;font-size:14px;font-weight:700}
a{color:#0071e3}
</style></head>
<body>
<h2>Your MDC Account</h2>
<p>Hi ${fullName ?? username},</p>
<p>Your account has been created. Use the credentials below to sign in:</p>
<p><strong>Username:</strong> <code>${username}</code></p>
<p><strong>Password:</strong> <code>${tempPassword}</code></p>
<p><a href="${appUrl}/login">Sign in here</a> &mdash; you will be required to change your password on first login.</p>
</body>
</html>`;

  const result = await sendEmail({
    to: email,
    subject: "Your MDC Account",
    html,
  });

  res.json({
    id,
    email_sent: result.ok,
    email_error: result.error ?? null,
  });
});

usersRouter.post("/", authMiddleware, requireRole("system_admin"), async (req, res) => {
  const db = await getDb();
  const { email, username, fullName, password, role } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  if (/\s/.test(username)) {
    res.status(400).json({ error: "Username must not contain spaces" });
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
  const id = queryString(req.params.id) ?? "";
  await db.update(profiles).set({ role: req.body.role }).where(eq(profiles.id, id));
  res.json({ ok: true });
});

usersRouter.put("/:id/status", authMiddleware, requireRole("system_admin"), async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  await db.update(profiles).set({ isActive: req.body.isActive }).where(eq(profiles.id, id));
  res.json({ ok: true });
});
