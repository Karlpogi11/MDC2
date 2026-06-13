import { Router } from "express";
import { getDb } from "../db/connection";
import { profiles } from "../db/schema";
import { eq, or } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, authMiddleware } from "../middleware/auth";
import { randomUUID as uuid } from "node:crypto";

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
