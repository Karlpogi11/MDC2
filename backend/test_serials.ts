import { getDb } from "./src/db/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT
      sn.id, sn.serial_number AS serialNumber, sn.part_id AS partId,
      p.part_number AS partNumber, p.part_name AS partName,
      s.site_name AS siteName
    FROM serial_numbers sn
    LEFT JOIN parts p ON p.id = sn.part_id
    LEFT JOIN sites s ON s.id = sn.current_site_id
    LIMIT 2
  `);
  console.log(JSON.stringify((result as any[])[0], null, 2));
  process.exit(0);
}
main();
