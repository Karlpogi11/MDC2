import { demoInventoryRows } from "../data/demoInventory";
import { api } from "../lib/api";
import type { InventoryQueryResult, InventoryRow } from "../types";

function applyLocalFilters(rows: InventoryRow[], filters: { segment?: string; search?: string }): InventoryRow[] {
  const q = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.segment === "in_stock" && row.inStock <= 0) return false;
    if (filters.segment === "stocked_out" && row.stockedOut <= 0) return false;
    if (!q) return true;
    return (
      row.partName.toLowerCase().includes(q) ||
      row.partNumber.toLowerCase().includes(q) ||
      row.category.toLowerCase().includes(q)
    );
  });
}

function paginateRows(rows: InventoryRow[], page: number, pageSize: number): { rows: InventoryRow[]; total: number } {
  const start = page * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length };
}

function resolvePartType(
  explicitType: string | null | undefined,
  category: string,
): "product" | "material" | "unknown" {
  if (explicitType === "product" || explicitType === "material") {
    return explicitType;
  }

  const normalized = category.toLowerCase();
  if (normalized.includes("material")) {
    return "material";
  }

  return "unknown";
}

function fromSnapshotRows(rows: Array<{
  part_id: string;
  part_name: string;
  part_number: string;
  category: string | null;
  part_type?: string | null;
  in_stock: number;
  stocked_out?: number | null;
  reserved: number;
  available: number;
  last_stock_in_at: string | null;
  last_stock_out_at?: string | null;
  last_transfer_at?: string | null;
}>): InventoryRow[] {
  return rows
    .map((row) => ({
      partId: row.part_id,
      partName: row.part_name,
      partNumber: row.part_number,
      category: row.category ?? "Uncategorized",
      partType: resolvePartType(row.part_type, row.category ?? "Uncategorized"),
      inStock: row.in_stock,
      stockedOut: row.stocked_out ?? 0,
      reserved: row.reserved ?? (row as any).committed ?? 0,
      available: row.available,
      lastStockInAt: row.last_stock_in_at,
      lastStockOutAt: row.last_stock_out_at ?? row.last_transfer_at ?? null,
    }))
    .sort((a, b) => a.partName.localeCompare(b.partName));
}

function keepStockedOnly(rows: InventoryRow[]): InventoryRow[] {
  return rows.filter((row) => row.lastStockInAt !== null);
}

export async function fetchInventoryRows(page = 0, pageSize = 50, filters: { segment?: string; search?: string } = {}): Promise<InventoryQueryResult> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (filters.segment) params.set("segment", filters.segment);
    if (filters.search) params.set("q", filters.search);

    const result = await api.get<InventoryQueryResult>(`/inventory?${params.toString()}`);
    return { ...result, source: "mysql" };
  } catch {
    return { rows: demoInventoryRows, source: "demo" };
  }
}
