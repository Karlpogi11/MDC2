import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";

export async function up(db: MySql2Database): Promise<void> {
  await db.execute(sql`
    CREATE TABLE reset_tokens (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      token VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reset_tokens_token (token),
      INDEX idx_reset_tokens_user (user_id)
    )
  `);
}
