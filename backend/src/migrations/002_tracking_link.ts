import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";

export async function up(db: MySql2Database): Promise<void> {
  const [rows] = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'transfers'
      AND COLUMN_NAME = 'tracking_link'
  `);
  const exists = Number((rows as any)[0]?.cnt ?? 0) > 0;
  if (!exists) {
    await db.execute(sql`
      ALTER TABLE transfers
      ADD COLUMN tracking_link VARCHAR(500) DEFAULT NULL
      AFTER tracking_number
    `);
  }
}
