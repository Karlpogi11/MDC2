import { demoInventoryRows } from "../data/demoInventory";
import { getSupabaseClient, isSupabaseConfigured } from "../lib/supabase";
import type { InventoryQueryResult, InventoryRow } from "../types";

const MAX_SERIAL_ROWS = 5000;
const MAX_TRANSFER_ROWS = 1500;
const MAX_RESERVED_TRANSFER_ITEMS = 10000;
const MAX_STOCKED_OUT_SERIALS = 10000;

type PartRecord = {
  id: string;
  part_number: string;
  part_name: string;
  category: string | null;
  part_type?: string | null;
};

type SerialRecord = {
  part_id: string;
  status: "in_stock" | "transit" | "in_transit" | "transferred" | "consumed" | "void";
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
  stocked_out?: number | null;
  reserved: number;
  available: number;
  last_stock_in_at: string | null;
  last_stock_out_at?: string | null;
  last_transfer_at?: string | null;
};

type ReservedTransferItemRecord = {
  part_id: string;
  serial_id: string | null;
  qty: number | null;
};

type SupabaseClientLike = NonNullable<ReturnType<typeof getSupabaseClient>>;

function applyLocalFilters(rows: InventoryRow[], filters: { segment?: string; search?: string }): InventoryRow[] {
  const q = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    // Segment semantics:
    // in_stock: currently has stock on hand.
    // stocked_out: serials that have left DC stock and are marked transferred.
    // A part can appear here while
    // still having current stock on hand.
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

async function findPartIdsBySerialSearch(client: SupabaseClientLike, search: string): Promise<string[]> {
  const q = search.trim();
  if (!q) return [];

  const { data, error } = await client
    .from("serial_numbers")
    .select("part_id")
    .ilike("serial_number", `%${q}%`)
    .limit(100);

  if (error || !data) return [];
  const unique = new Set<string>();
  for (const row of data as Array<{ part_id: string | null }>) {
    if (row.part_id) unique.add(row.part_id);
  }
  return Array.from(unique);
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

function fromSnapshotRows(rows: InventorySnapshotRecord[]): InventoryRow[] {
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

function toPositiveInt(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return 0;
  }
  const normalized = Math.floor(value ?? 0);
  return normalized > 0 ? normalized : 0;
}

function countReservedByPart(rows: ReservedTransferItemRecord[]): Map<string, number> {
  const reservedByPart = new Map<string, number>();
  const seenSerialKeys = new Set<string>();

  for (const row of rows) {
    if (!row.part_id) {
      continue;
    }

    if (row.serial_id) {
      const serialKey = `${row.part_id}:${row.serial_id}`;
      if (seenSerialKeys.has(serialKey)) {
        continue;
      }
      seenSerialKeys.add(serialKey);
      reservedByPart.set(row.part_id, (reservedByPart.get(row.part_id) ?? 0) + 1);
      continue;
    }

    const qty = toPositiveInt(row.qty ?? 1) || 1;
    reservedByPart.set(row.part_id, (reservedByPart.get(row.part_id) ?? 0) + qty);
  }

  return reservedByPart;
}

function applyReservedToRows(rows: InventoryRow[], reservedByPart: Map<string, number>): InventoryRow[] {
  return rows.map((row) => {
    const reserved = reservedByPart.get(row.partId) ?? 0;
    return {
      ...row,
      reserved,
      available: Math.max(row.inStock - reserved, 0),
    };
  });
}

function applyStockedOutToRows(rows: InventoryRow[], stockedOutByPart: Map<string, number>): InventoryRow[] {
  return rows.map((row) => ({
    ...row,
    stockedOut: stockedOutByPart.get(row.partId) ?? 0,
  }));
}

async function fetchReservedByPart(
  client: SupabaseClientLike,
  partIds?: string[],
): Promise<Map<string, number>> {
  let query = client
    .from("transfer_items")
    .select("part_id,serial_id,qty,transfers!inner(status)")
    .in("transfers.status", ["draft", "packed"])
    .limit(MAX_RESERVED_TRANSFER_ITEMS);

  if (partIds && partIds.length > 0) {
    query = query.in("part_id", partIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return countReservedByPart((data ?? []) as ReservedTransferItemRecord[]);
}

async function fetchStockedOutByPart(
  client: SupabaseClientLike,
  partIds?: string[],
): Promise<Map<string, number>> {
  let query = client
    .from("serial_numbers")
    .select("part_id")
    .eq("status", "transferred")
    .limit(MAX_STOCKED_OUT_SERIALS);

  if (partIds && partIds.length > 0) {
    query = query.in("part_id", partIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const stockedOutByPart = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ part_id: string | null }>) {
    if (row.part_id) {
      stockedOutByPart.set(row.part_id, (stockedOutByPart.get(row.part_id) ?? 0) + 1);
    }
  }
  return stockedOutByPart;
}

function toInventoryRows(
  parts: PartRecord[],
  serialRows: SerialRecord[],
  transferRows: TransferRecord[],
  reservedByPart: Map<string, number>,
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
      stockedOut: 0,
      reserved: 0,
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
      part.stockedOut += 1;
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
    const reserved = reservedByPart.get(part.partId) ?? 0;
    part.reserved = reserved;
    part.available = Math.max(part.inStock - reserved, 0);
  }

  return Array.from(byPart.values()).sort((a, b) => a.partName.localeCompare(b.partName));
}

async function fetchInventoryRowsFromBaseTables(
  client: SupabaseClientLike,
  page: number,
  pageSize: number,
  filters: { segment?: string; search?: string },
  snapshotError?: { message?: string } | null,
): Promise<InventoryQueryResult> {
  const [partsResponse, serialsResponse, transfersResponse, reservedResponse] = await Promise.all([
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
      .limit(MAX_TRANSFER_ROWS),
    client
      .from("transfer_items")
      .select("part_id,serial_id,qty,transfers!inner(status)")
      .in("transfers.status", ["draft", "packed"])
      .limit(MAX_RESERVED_TRANSFER_ITEMS),
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

  const reservedByPart = reservedResponse.error
    ? new Map<string, number>()
    : countReservedByPart((reservedResponse.data ?? []) as ReservedTransferItemRecord[]);

  const allRows = toInventoryRows(
    (partsResponse.data ?? []) as PartRecord[],
    (serialsResponse.data ?? []) as SerialRecord[],
    (transfersResponse.data ?? []) as TransferRecord[],
    reservedByPart,
  );

  const filteredRows = applyLocalFilters(keepStockedOnly(allRows), filters);
  const paged = paginateRows(filteredRows, page, pageSize);
  return {
    rows: paged.rows,
    source: "supabase",
    total: paged.total,
  };
}

export async function fetchInventoryRows(page = 0, pageSize = 50, filters: { segment?: string; search?: string } = {}): Promise<InventoryQueryResult> {
  if (!isSupabaseConfigured) {
    return { rows: demoInventoryRows, source: "demo" };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { rows: demoInventoryRows, source: "demo" };
  }

  let snapshotQuery = client
    .from("inventory_snapshot")
    .select("*", { count: "exact" })
    .order("part_name", { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (filters.search?.trim()) {
    const q = filters.search.trim();
    snapshotQuery = snapshotQuery.or(`part_name.ilike.%${q}%,part_number.ilike.%${q}%,category.ilike.%${q}%`);
  }
  if (filters.segment === "in_stock") snapshotQuery = snapshotQuery.gt("in_stock", 0);
  if (filters.segment === "stocked_out") snapshotQuery = snapshotQuery.gt("stocked_out", 0);

  const { data: snapshotRows, error: snapshotError, count } = await snapshotQuery;

  if (!snapshotError && snapshotRows) {
    let mappedRows = keepStockedOnly(fromSnapshotRows(snapshotRows as InventorySnapshotRecord[]));

    // If user searched by serial number, snapshot search on part fields returns empty.
    // Recover by resolving matching part_ids from serial_numbers.
    if (mappedRows.length === 0 && filters.search?.trim()) {
      const partIdsBySerial = await findPartIdsBySerialSearch(client, filters.search);
      if (partIdsBySerial.length > 0) {
        let bySerialQuery = client
          .from("inventory_snapshot")
          .select("*")
          .in("part_id", partIdsBySerial)
          .order("part_name", { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (filters.segment === "in_stock") bySerialQuery = bySerialQuery.gt("in_stock", 0);
        if (filters.segment === "stocked_out") bySerialQuery = bySerialQuery.gt("stocked_out", 0);

        const { data: serialMatchRows, error: serialMatchError } = await bySerialQuery;
        if (!serialMatchError && serialMatchRows) {
          mappedRows = keepStockedOnly(fromSnapshotRows(serialMatchRows as InventorySnapshotRecord[]));
        }
      }
    }

    // Snapshot can be stale (materialized view refresh lag), especially for stocked-out status.
    // If a status-tab query returns empty, recover from live tables.
    if (mappedRows.length === 0 && (filters.segment === "stocked_out" || filters.segment === "in_stock")) {
      return fetchInventoryRowsFromBaseTables(client, page, pageSize, filters, snapshotError);
    }

    const visiblePartIds = mappedRows.map((row) => row.partId);

    try {
      const stockedOutByPart = await fetchStockedOutByPart(client, visiblePartIds);
      mappedRows = applyStockedOutToRows(mappedRows, stockedOutByPart);
      if (filters.segment === "stocked_out") {
        mappedRows = applyLocalFilters(mappedRows, { segment: filters.segment });
      }
    } catch {
      // Keep snapshot values as a safe fallback if live stock-out lookup fails.
    }

    const reservablePartIds = mappedRows
      .filter((row) => row.inStock > 0 || row.reserved > 0)
      .map((row) => row.partId);

    if (reservablePartIds.length === 0) {
      return {
        rows: mappedRows,
        source: "supabase",
        total: count ?? undefined,
      };
    }

    try {
      const reservedByPart = await fetchReservedByPart(client, reservablePartIds);
      return {
        rows: applyReservedToRows(mappedRows, reservedByPart),
        source: "supabase",
        total: count ?? undefined,
      };
    } catch {
      // Keep snapshot values as a safe fallback if live reservation lookup fails.
    }

    return {
      rows: mappedRows,
      source: "supabase",
      total: count ?? undefined,
    };
  }
  return fetchInventoryRowsFromBaseTables(client, page, pageSize, filters, snapshotError);
}
