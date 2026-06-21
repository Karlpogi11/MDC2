import { Router } from "express";
import { getDb } from "../db/connection";
import { profiles } from "../db/schema";
import { eq, or, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, authMiddleware } from "../middleware/auth";
import { randomUUID as uuid, randomBytes } from "node:crypto";
import { sendEmail } from "../utils/mail";

export const authRouter = Router();

authRouter.post("/signin", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    const db = await getDb();
    const user = await db.query.profiles.findFirst({
      where: or(eq(profiles.username, username), eq(profiles.email, username)),
    });

    if (!user || !user.passwordHash || !user.isActive) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = generateToken({
      id: user.id,
      role: user.role,
      username: user.username,
      email: user.email,
    });

    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.fullName,
        email: user.email,
        username: user.username,
        role: user.role,
        force_password_change: user.forcePasswordChange,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/register", async (req, res) => {
  try {
    const { email, username, fullName, password, role } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    const db = await getDb();
    const existing = await db.query.profiles.findFirst({
      where: or(
        eq(profiles.username, username),
        ...(email ? [eq(profiles.email, email)] : []),
      ),
    });

    if (existing) {
      res.status(409).json({ error: "Username or email already exists" });
      return;
    }

    const id = uuid();
    const passwordHash = await hashPassword(password);

    await db.insert(profiles).values({
      id,
      email: email ?? null,
      username,
      fullName: fullName ?? null,
      role: role ?? "dc_viewer",
      passwordHash,
      isActive: true,
    });

    res.json({ id, message: "User created successfully" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.get("/me", authMiddleware, async (req, res) => {
  const db = await getDb();
  const user = await db.query.profiles.findFirst({
    where: eq(profiles.id, req.user!.id),
  });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    full_name: user.fullName,
    email: user.email,
    username: user.username,
    role: user.role,
    force_password_change: user.forcePasswordChange,
  });
});

authRouter.put("/update-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = await getDb();

    const user = await db.query.profiles.findFirst({
      where: eq(profiles.id, req.user!.id),
    });

    if (!user || !user.passwordHash) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db.update(profiles)
      .set({ passwordHash, forcePasswordChange: false })
      .where(eq(profiles.id, req.user!.id));

    res.json({ message: "Password updated" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email required" });
      return;
    }

    const db = await getDb();
    const user = await db.query.profiles.findFirst({
      where: eq(profiles.email, email),
    });

    if (!user) {
      res.status(404).json({ error: "No account found with that email." });
      return;
    }

    const tokenId = uuid();
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.execute(sql`
      INSERT INTO reset_tokens (id, user_id, token, expires_at)
      VALUES (${tokenId}, ${user.id}, ${token}, ${expiresAt.toISOString().slice(0, 19).replace("T", " ")})
    `);

    const appUrl = req.headers.origin ?? "http://localhost:5173";
    const resetUrl = `${appUrl}/login#type=recovery&token=${token}`;
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body{font-family:sans-serif;padding:24px;color:#333;max-width:480px}
h2{font-size:16px;margin:0 0 12px}
p{font-size:13px;line-height:1.5;margin:0 0 8px}
a{color:#0071e3}
</style></head>
<body>
<h2>Password Reset</h2>
<p>Hi ${user.fullName ?? user.username},</p>
<p>A password reset was requested for your MDC account.</p>
<p><a href="${resetUrl}">Reset your password here</a></p>
<p>This link expires in 1 hour.</p>
<p>If you did not request this, ignore this email.</p>
</body>
</html>`;

    await sendEmail({
      to: email,
      subject: "MDC Password Reset",
      html,
    });

    res.json({ message: "If that email exists, a reset link has been sent." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ error: "Token and new password required" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const db = await getDb();
    const [tokenRows] = await db.execute(sql`
      SELECT id, user_id, expires_at, used_at
      FROM reset_tokens
      WHERE token = ${token}
      LIMIT 1
    `) as any;

    const rows: any[] = tokenRows ?? [];
    if (!tokenRows.length) {
      res.status(400).json({ error: "Invalid or expired token" });
      return;
    }

    const row = tokenRows[0];
    if (row.used_at) {
      res.status(400).json({ error: "Token already used" });
      return;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(400).json({ error: "Token expired" });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db.update(profiles)
      .set({ passwordHash, forcePasswordChange: false })
      .where(eq(profiles.id, row.user_id));

    await db.execute(sql`
      UPDATE reset_tokens SET used_at = NOW() WHERE id = ${row.id}
    `);

    res.json({ message: "Password reset successfully" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
