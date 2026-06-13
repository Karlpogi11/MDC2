import { Router } from "express";
import { randomUUID as uuid } from "node:crypto";
import { and, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { authMiddleware } from "../middleware/auth";
import { parts } from "../db/schema";
import { bodyBoolean, bodyNumber, bodyString } from "../utils/body";
import { queryActiveFilter, queryNumber, queryString } from "../utils/query";

export const partsRouter = Router();

function normalizePartInput(body: unknown) {
  const source = (body ?? {}) as Record<string, unknown>;
  const partNumber = bodyString(source.partNumber, source.part_number)?.trim();
  const partName = bodyString(source.partName, source.part_name)?.trim();
  const category = bodyString(source.category)?.trim() || null;
  const partType = bodyString(source.partType, source.part_type)?.trim() || "product";
  const averageCost = bodyNumber(source.averageCost, source.average_cost);
  const isActive = bodyBoolean(source.isActive, source.is_active);

  return { partNumber, partName, category, partType, averageCost, isActive };
}

function buildPartRecord(
  input: ReturnType<typeof normalizePartInput>,
  existing?: {
    partNumber: string;
    partName: string;
    category: string | null;
    partType: string | null;
    averageCost: string | number | null;
    isActive: boolean;
  },
  overrides: { isActive?: boolean } = {},
) {
  const existingCost = Number.parseFloat(String(existing?.averageCost ?? "0"));
  return {
    partNumber: input.partNumber ?? existing?.partNumber ?? "",
    partName: input.partName ?? existing?.partName ?? "",
    category: input.category !== undefined ? input.category : existing?.category ?? null,
    partType: input.partType ?? existing?.partType ?? "product",
    averageCost: (input.averageCost ?? (Number.isFinite(existingCost) ? existingCost : 0)).toFixed(2),
    isActive: overrides.isActive ?? input.isActive ?? existing?.isActive ?? true,
  };
}

async function savePart(db: Awaited<ReturnType<typeof getDb>>, input: ReturnType<typeof normalizePartInput>) {
  if (!input.partNumber || !input.partName) {
    return { ok: false as const, error: "Part number and description are required." };
  }

  const existing = await db.query.parts.findFirst({
    where: eq(parts.partNumber, input.partNumber),
    columns: {
      id: true,
      partNumber: true,
      partName: true,
      category: true,
      partType: true,
      averageCost: true,
      isActive: true,
    },
  });

  const values = {
    ...buildPartRecord(input, existing, { isActive: true }),
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(parts).set(values).where(eq(parts.id, existing.id));
    return { ok: true as const, id: existing.id, created: false };
  }

  const id = uuid();
  await db.insert(parts).values({
    id,
    ...buildPartRecord(input, undefined, { isActive: true }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { ok: true as const, id, created: true };
}

partsRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const q = queryString(req.query.q)?.trim();
  const isActive = queryActiveFilter(req.query.is_active, true);
  const limit = Math.min(queryNumber(req.query.limit, 10000), 10000);

  let conditions = isActive === null ? undefined : eq(parts.isActive, isActive);
  if (q) {
    const search = or(
      like(parts.partNumber, `%${q}%`),
      like(parts.partName, `%${q}%`),
    );
    conditions = conditions ? and(conditions, search)! : search;
  }

  const rows = await db.query.parts.findMany({
    where: conditions,
    orderBy: [parts.partName],
    limit,
  });
  res.json(rows);
});

partsRouter.get("/search", authMiddleware, async (req, res) => {
  const db = await getDb();
  const q = queryString(req.query.q)?.trim();
  if (!q) { res.json([]); return; }

  const rows = await db.query.parts.findMany({
    where: and(
      eq(parts.isActive, true),
      or(
        like(parts.partNumber, `%${q}%`),
        like(parts.partName, `%${q}%`),
      ),
    ),
    limit: 8,
  });
  res.json(rows);
});

partsRouter.post("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const input = normalizePartInput(req.body);
  const result = await savePart(db, input);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ id: result.id, created: result.created });
});

partsRouter.post("/import", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const mode = bodyString(req.body?.mode)?.trim() ?? "merge";
  const importedPartNumbers = new Set<string>();
  const errors: string[] = [];
  let added = 0;
  let updated = 0;

  for (const [index, rawRow] of rows.entries()) {
    const input = normalizePartInput(rawRow);
    if (!input.partNumber || !input.partName) {
      errors.push(`Row ${index + 1}: part number and description are required.`);
      continue;
    }

    importedPartNumbers.add(input.partNumber);
    const result = await savePart(db, input);
    if (!result.ok) {
      errors.push(`Row ${index + 1}: ${result.error}`);
      continue;
    }

    if (result.created) added += 1;
    else updated += 1;
  }

  if (importedPartNumbers.size > 0 && (mode === "deactivate_unlisted" || mode === "replace_all")) {
    const keepList = [...importedPartNumbers].map((partNumber) => sql`${partNumber}`);
    await db.update(parts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(sql`${parts.partNumber} NOT IN (${sql.join(keepList, sql`, `)})`);
  }

  res.json({
    added,
    updated,
    errors,
  });
});

partsRouter.get("/:partNumber", authMiddleware, async (req, res) => {
  const db = await getDb();
  const partNumber = queryString(req.params.partNumber) ?? "";
  const part = await db.query.parts.findFirst({
    where: eq(parts.partNumber, partNumber),
  });
  res.json(part ?? null);
});

partsRouter.put("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const input = normalizePartInput(req.body);
  const changes: Record<string, unknown> = { updatedAt: new Date() };

  if (input.partName !== undefined) changes.partName = input.partName;
  if (input.category !== undefined) changes.category = input.category;
  if (input.partType !== undefined) changes.partType = input.partType;
  if (input.averageCost !== undefined) changes.averageCost = input.averageCost.toFixed(2);
  if (input.isActive !== undefined) changes.isActive = input.isActive;

  await db.update(parts).set(changes).where(eq(parts.id, id));
  res.json({ ok: true });
});
