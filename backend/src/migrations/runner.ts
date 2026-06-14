import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

const MIGRATIONS_TABLE = "_migrations";

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_TABLE)} (
      id VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const fs = await import("fs");
  const path = await import("path");
  const dir = __dirname;
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d+_.+\.ts$/.test(f))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    const [existing] = await db.execute(sql`
      SELECT id FROM ${sql.identifier(MIGRATIONS_TABLE)} WHERE id = ${id} LIMIT 1
    `);
    if ((existing as unknown as any[])?.length) continue;

    console.log(`Running migration: ${id}`);
    try {
      const mod = await import(path.join(dir, file));
      if (typeof mod.up === "function") {
        await mod.up(db);
      }
      await db.execute(sql`
        INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} (id) VALUES (${id})
      `);
      console.log(`  ✔ ${id}`);
    } catch (err) {
      console.error(`  ✘ ${id}:`, err);
    }
  }
}
