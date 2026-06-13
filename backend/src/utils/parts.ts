import { randomUUID as uuid } from "node:crypto";
import { inArray } from "drizzle-orm";
import { parts } from "../db/schema";

type DbLike = {
  query: {
    parts: {
      findMany(args: { where?: any }): Promise<Array<{
        id: string;
        partNumber: string;
        partName: string;
        category: string | null;
        partType: string | null;
        averageCost: string | number | null;
        isActive: boolean;
      }>>;
    };
  };
  insert(table: typeof parts): {
    values(values: Array<Record<string, unknown>>): {
      onDuplicateKeyUpdate(args: { set: Record<string, unknown> }): Promise<unknown>;
    };
  };
};

function uniquePartNumbers(partNumbers: Array<string | null | undefined>) {
  return [...new Set(partNumbers.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function extractSeriesLabel(partName?: string | null, partNumber?: string | null): string {
  const name = partName?.trim();
  if (name) {
    const suffix = name.split(" - ").pop()?.trim();
    if (suffix) return suffix;
  }
  return partNumber?.trim() || "Unknown";
}

export async function ensurePartsByNumbers(
  db: DbLike,
  partNumbers: Array<string | null | undefined>,
  options: { autoCreate?: boolean } = {},
) {
  const unique = uniquePartNumbers(partNumbers);
  const map = new Map<string, { id: string; partNumber: string; partName: string; category: string | null; partType: string | null; averageCost: string | number | null; isActive: boolean }>();

  if (!unique.length) return { map, missing: [] as string[] };

  const existing = await db.query.parts.findMany({ where: inArray(parts.partNumber, unique) });
  for (const part of existing) map.set(part.partNumber, part);

  const missing = unique.filter((partNumber) => !map.has(partNumber));
  if (!missing.length) return { map, missing: [] as string[] };

  if (options.autoCreate !== false) {
    const now = new Date();
    const values = missing.map((partNumber) => ({
      id: uuid(),
      partNumber,
      partName: partNumber,
      category: null,
      partType: "product",
      averageCost: "0.00",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }));

    await db.insert(parts).values(values).onDuplicateKeyUpdate({ set: { updatedAt: now } });
    const created = await db.query.parts.findMany({ where: inArray(parts.partNumber, missing) });
    for (const part of created) map.set(part.partNumber, part);
    return { map, missing: [] as string[] };
  }

  return { map, missing };
}
