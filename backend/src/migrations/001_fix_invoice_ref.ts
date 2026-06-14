import { eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { transfers } from "../db/schema";

export async function up(db: MySql2Database): Promise<void> {
  const [rows] = await db.execute(sql`
    SELECT id, invoice_ref, created_at, packed_at
    FROM transfers
    WHERE invoice_ref IS NOT NULL
  `);
  const list = (rows as unknown as any[]) ?? [];
  let fixed = 0;
  for (const r of list) {
    const match = /^(.*?#)-(\d{4})-(\d{2})-(.+)$/.exec(String(r.invoice_ref ?? ""));
    if (!match) continue;
    const prefix = match[1];
    const year = match[2];
    const month = match[3];
    const suffix = match[4];
    const date = r.packed_at || r.created_at;
    const day = date ? String(new Date(date).getDate()).padStart(2, "0") : "01";
    const newRef = `${prefix}${year}${month}${day}-${suffix}`;
    await db.update(transfers)
      .set({ invoiceRef: newRef })
      .where(eq(transfers.id, r.id));
    fixed++;
  }
  if (fixed > 0) console.log(`Fixed ${fixed} invoice ref(s)`);
}
