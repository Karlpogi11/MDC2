import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function getDb() {
  if (_db) return _db;

  const url = process.env.DATABASE_URL ?? "mysql://root@localhost:3307/mdc";
  const pool = mysql.createPool(url);
  _db = drizzle(pool, { schema, mode: "default" }) as any;
  return _db!;
}
