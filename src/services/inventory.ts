import { demoInventoryRows } from "../data/demoInventory";
import { getSupabaseClient, isSupabaseConfigured } from "../lib/supabase";
import type { InventoryQueryResult, InventoryRow } from "../types";

const MAX_SERIAL_ROWS = 5000;

type PartRecord = {
  id: string;
  part_number: string;
  part_name: string;
  category: string | null;
  part_type?: string | null;
};

type SerialRecord = {
  part_id: string;
  status: "in_stock" | "transit" | "transferred" | "consumed" | "void";
  stock_in_at: string;
};

type TransferRecord = {
  created_at: string;
  packed_at: string | null;
  status: "draft" | "packed" | "in_transit" | "received" | "cancelled";
  transfer_items: { part_id: string }[] | null;
};

type InventorySnapshotRecord = {
  part_id: string;
  part_name: string;
  part_number: string;
  category: string | null;
  part_type?: string | null;
  in_stock: number;
  committed: number;
  available: number;
  last_stock_in_at: string | null;
  last_stock_out_at?: string | null;
  last_transfer_at?: string | null;
};

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

function fromSnapshotRows(rows: InventorySnapshotRecord[]): InventoryRow[] {
  return rows
    .map((row) => ({
      partId: row.part_id,
      partName: row.part_name,
      partNumber: row.part_number,
      category: row.category ?? "Uncategorized",
      partType: resolvePartType(row.part_type, row.category ?? "Uncategorized"),
      inStock: row.in_stock,
      committed: row.committed,
      available: row.available,
      lastStockInAt: row.last_stock_in_at,
      lastStockOutAt: row.last_stock_out_at ?? row.last_transfer_at ?? null,
    }))
    .sort((a, b) => a.partName.localeCompare(b.partName));
}

function toInventoryRows(
  parts: PartRecord[],
  serialRows: SerialRecord[],
  transferRows: TransferRecord[],
): InventoryRow[] {
  const byPart = new Map<string, InventoryRow>();

  for (const part of parts) {
    byPart.set(part.id, {
      partId: part.id,
      partName: part.part_name,
      partNumber: part.part_number,
      category: part.category ?? "Uncategorized",
      partType: resolvePartType(part.part_type, part.category ?? "Uncategorized"),
      inStock: 0,
      committed: 0,
      available: 0,
      lastStockInAt: null,
      lastStockOutAt: null,
    });
  }

  for (const serial of serialRows) {
    const part = byPart.get(serial.part_id);
    if (!part) {
      continue;
    }

    if (serial.status === "in_stock") {
      part.inStock += 1;
    }

    if (serial.status === "transferred") {
      part.committed += 1;
    }

    if (!part.lastStockInAt || serial.stock_in_at > part.lastStockInAt) {
      part.lastStockInAt = serial.stock_in_at;
    }
  }

  for (const transfer of transferRows) {
    if (!transfer.transfer_items || transfer.transfer_items.length === 0) {
      continue;
    }

    for (const item of transfer.transfer_items) {
      const part = byPart.get(item.part_id);
      if (!part) {
        continue;
      }

      const stockOutAt = transfer.packed_at ?? transfer.created_at;
      if (!part.lastStockOutAt || stockOutAt > part.lastStockOutAt) {
        part.lastStockOutAt = stockOutAt;
      }
    }
  }

  for (const part of byPart.values()) {
    part.available = Math.max(part.inStock - part.committed, 0);
  }

  return Array.from(byPart.values()).sort((a, b) => a.partName.localeCompare(b.partName));
}

export async function fetchInventoryRows(): Promise<InventoryQueryResult> {
  if (!isSupabaseConfigured) {
    return { rows: demoInventoryRows, source: "demo" };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { rows: demoInventoryRows, source: "demo" };
  }

  const { data: snapshotRows, error: snapshotError } = await client
    .from("inventory_snapshot")
    .select("*")
    .order("part_name", { ascending: true });

  if (!snapshotError && snapshotRows) {
    return {
      rows: fromSnapshotRows(snapshotRows as InventorySnapshotRecord[]),
      source: "supabase",
    };
  }

  const [partsResponse, serialsResponse, transfersResponse] = await Promise.all([
    client
      .from("parts")
      .select("*")
      .eq("is_active", true)
      .order("part_name", { ascending: true }),
    client
      .from("serial_numbers")
      .select("part_id,status,stock_in_at")
      .order("stock_in_at", { ascending: false })
      .limit(MAX_SERIAL_ROWS),
    client
      .from("transfers")
      .select("created_at,packed_at,status,transfer_items(part_id)")
      .in("status", ["packed", "in_transit", "received"])
      .order("created_at", { ascending: false })
      .limit(1500),
  ]);

  if (partsResponse.error || serialsResponse.error || transfersResponse.error) {
    const reason =
      partsResponse.error?.message ??
      serialsResponse.error?.message ??
      transfersResponse.error?.message ??
      snapshotError?.message ??
      "Unknown Supabase error";
    throw new Error(reason);
  }

  return {
    rows: toInventoryRows(
      (partsResponse.data ?? []) as PartRecord[],
      (serialsResponse.data ?? []) as SerialRecord[],
      (transfersResponse.data ?? []) as TransferRecord[],
    ),
    source: "supabase",
  };
}
