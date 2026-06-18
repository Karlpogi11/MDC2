import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";

export async function up(db: MySql2Database): Promise<void> {
  await db.execute(sql`
    ALTER TABLE transfers
    ADD COLUMN tracking_link VARCHAR(500) DEFAULT NULL
    AFTER tracking_number
  `);
}
