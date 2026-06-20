import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function getDb() {
  if (_db) return _db;

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    if (process.env.VERCEL) {
      // Fail loudly instead of silently trying localhost, which can never
      // work inside a Vercel serverless function.
      throw new Error(
        "DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables."
      );
    }
    console.warn("DATABASE_URL not set, falling back to local dev MySQL.");
  }

  const pool = mysql.createPool({
    uri: raw ?? "mysql://root@localhost:3307/mdc",
    // Shared-hosting MySQL (e.g. Hostinger) typically caps total connections
    // very low (~20-25). Keep each serverless instance's pool small so
    // concurrent invocations don't exhaust the server-side limit.
    connectionLimit: process.env.VERCEL ? 2 : 10,
    connectTimeout: 10_000,
  });

  try {
    const c = await pool.getConnection();
    c.release();
  } catch (err) {
    console.error("MySQL connection failed on warm-up:", err);
  }

  _db = drizzle(pool, { schema, mode: "default" }) as any;
  return _db!;
}