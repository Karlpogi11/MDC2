import { getDb } from "./db/connection";
import { profiles } from "./db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./middleware/auth";
import { randomUUID as uuid } from "node:crypto";

const SEED_USERS = [
  { username: "system_admin", password: "test1234", role: "system_admin", fullName: "System Admin", email: "sysadmin@mdc.local" },
  { username: "dc_admin", password: "test1234", role: "dc_admin", fullName: "DC Admin", email: "dcadmin@mdc.local" },
  { username: "dc_operator", password: "test1234", role: "dc_operator", fullName: "DC Operator", email: "dcoperator@mdc.local" },
  { username: "dc_viewer", password: "test1234", role: "dc_viewer", fullName: "DC Viewer", email: "dcviewer@mdc.local" },
  { username: "shipping_coord", password: "test1234", role: "shipping_coordinator", fullName: "Shipping Coordinator", email: "shipping@mdc.local" },
];

async function seedUsers() {
  const db = await getDb();

  for (const u of SEED_USERS) {
    const existing = await db.query.profiles.findFirst({
      where: eq(profiles.username, u.username),
    });
    if (existing) {
      console.log(`User "${u.username}" already exists, skipping.`);
      continue;
    }

    const passwordHash = await hashPassword(u.password);
    await db.insert(profiles).values({
      id: uuid(),
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      passwordHash,
      isActive: true,
      forcePasswordChange: false,
    });

    console.log(`Created user "${u.username}" (${u.role}) / ${u.password}`);
  }

  console.log("\nDone. All users have password: test1234");
  process.exit(0);
}

seedUsers().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
