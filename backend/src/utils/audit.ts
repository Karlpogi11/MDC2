import { randomUUID as uuid } from "node:crypto";
import { createHash } from "node:crypto";
import { getDb } from "../db/connection";
import { auditLogs } from "../db/schema";
import { sql } from "drizzle-orm";

export async function writeAuditLog(params: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string | null;
}) {
  const db = await getDb();
  const payload = JSON.stringify({ o: params.oldValue, n: params.newValue });
  const hash = createHash("sha256").update(payload).digest("hex");

  const [rows] = await db.execute(sql`SELECT hash FROM audit_logs ORDER BY created_at DESC LIMIT 1`);
  const result = rows as unknown as any[];
  const previousHash = result.length ? (result[0] as any).hash : null;

  await db.insert(auditLogs).values({
    id: uuid(),
    actorId: params.actorId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    oldValue: params.oldValue as any,
    newValue: params.newValue as any,
    note: params.note ?? null,
    previousHash,
    hash,
  });
}
