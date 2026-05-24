import type { QueryClient } from "@tanstack/react-query";
import { demoInventoryRows } from "@/data/demoInventory";
import { friendlyError } from "@/lib/friendlyError";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchInventoryRows } from "@/services/inventory";
import type { InventoryQueryResult } from "@/types";

export const NAVIGATION_CACHE_STALE_TIME = 60_000;
export const NAVIGATION_CACHE_GC_TIME = 15 * 60_000;
export const INVENTORY_PAGE_SIZE = 50;

export type Metrics = {
  inStock: number;
  inTransit: number;
  overdue: number;
};

export type PipelineItem = { status: string; count: number; overdueCount: number };

export type ActivityItem = {
  id: string;
  type: "transfer_dispatched" | "transfer_received" | "stock_in" | "correction";
  label: string;
  time: string;
};

export type TopPart = { part_number: string; part_name: string; movement: number };

export type DashboardData = {
  metrics: Metrics;
  pipeline: PipelineItem[];
  activity: ActivityItem[];
  stockInThisWeek: number;
  pendingCorrections: number;
  topParts: TopPart[];
};

export type TransferStatus = "draft" | "packed" | "in_transit" | "received" | "cancelled";

export type Transfer = {
  id: string;
  transfer_no: string;
  status: TransferStatus;
  destination_site: { site_name: string; site_code: string } | null;
  requested_by_profile: { full_name: string | null; username: string | null } | null;
  created_at: string;
  packed_at: string | null;
  item_count: number;
};

export type InventoryRowsData = InventoryQueryResult & {
  errorMessage?: string | null;
};

export const dashboardQueryKey = ["dashboard"] as const;
export const transfersQueryKey = ["transfers"] as const;

export function inventoryRowsQueryKey(page: number, segment: string, search: string) {
  return ["inventoryRows", { page, segment, search }] as const;
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      metrics: { inStock: 0, inTransit: 0, overdue: 0 },
      pipeline: [],
      activity: [],
      stockInThisWeek: 0,
      pendingCorrections: 0,
      topParts: [],
    };
  }

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [stockRes, transfersRes, stockInRes, correctionsRes, stockInWeekRes, pendingCorrectionsRes, topPartsRes] = await Promise.all([
    client.from("serial_numbers").select("id", { count: "exact", head: true }).eq("status", "in_stock"),
    client
      .from("transfers")
      .select("id, status, packed_at, created_at, transfer_no, destination_site:sites!destination_site_id(site_name)")
      .in("status", ["draft", "packed", "in_transit"])
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("stock_in_batches")
      .select("id, created_at, total_rows")
      .order("created_at", { ascending: false })
      .limit(5),
    client
      .from("serial_corrections")
      .select("id, created_at, old_serial, new_serial")
      .order("created_at", { ascending: false })
      .limit(5),
    client
      .from("serial_numbers")
      .select("id", { count: "exact", head: true })
      .gte("stock_in_at", sevenDaysAgo),
    client
      .from("serial_corrections")
      .select("id", { count: "exact", head: true }),
    client
      .from("serial_numbers")
      .select("parts(part_number, part_name)")
      .gte("stock_in_at", sevenDaysAgo)
      .limit(500),
  ]);

  if (stockRes.error) throw new Error(friendlyError(stockRes.error));
  if (transfersRes.error) throw new Error(friendlyError(transfersRes.error));

  const transfers = (transfersRes.data ?? []) as any[];
  const inTransitList = transfers.filter((t) => t.status === "in_transit");
  const overdueList = inTransitList.filter((t) => {
    const dispatchedAt = t.packed_at ?? t.created_at;
    return dispatchedAt < threeDaysAgo;
  });

  const pipelineMap: Record<string, { count: number; overdueCount: number }> = {};
  for (const transfer of transfers) {
    if (!pipelineMap[transfer.status]) {
      pipelineMap[transfer.status] = { count: 0, overdueCount: 0 };
    }
    pipelineMap[transfer.status].count++;
    if (transfer.status === "in_transit") {
      const dispatchedAt = transfer.packed_at ?? transfer.created_at;
      if (dispatchedAt < threeDaysAgo) {
        pipelineMap[transfer.status].overdueCount++;
      }
    }
  }

  const activity: ActivityItem[] = [];
  for (const transfer of transfers.slice(0, 5)) {
    const site = Array.isArray(transfer.destination_site)
      ? transfer.destination_site[0]
      : transfer.destination_site;
    if (transfer.status === "in_transit") {
      activity.push({
        id: transfer.id,
        type: "transfer_dispatched",
        label: `${transfer.transfer_no} dispatched -> ${site?.site_name ?? "unknown"}`,
        time: transfer.packed_at ?? transfer.created_at,
      });
    }
  }

  for (const batch of (stockInRes.data ?? []) as any[]) {
    activity.push({
      id: batch.id,
      type: "stock_in",
      label: `${batch.total_rows ?? "?"} serials stocked in`,
      time: batch.created_at,
    });
  }

  for (const correction of (correctionsRes.data ?? []) as any[]) {
    activity.push({
      id: correction.id,
      type: "correction",
      label: `Correction: ${correction.old_serial} -> ${correction.new_serial}`,
      time: correction.created_at,
    });
  }

  activity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  // Stock-in this week
  const stockInThisWeek = stockInWeekRes.count ?? 0;

  // Pending corrections (total, no status column exists)
  const pendingCorrections = pendingCorrectionsRes.count ?? 0;

  // Top parts by movement (stock-ins this week)
  const partCount: Record<string, { part_number: string; part_name: string; count: number }> = {};
  for (const row of (topPartsRes.data ?? []) as any[]) {
    const p = Array.isArray(row.parts) ? row.parts[0] : row.parts;
    if (!p?.part_number) continue;
    if (!partCount[p.part_number]) partCount[p.part_number] = { part_number: p.part_number, part_name: p.part_name ?? p.part_number, count: 0 };
    partCount[p.part_number].count++;
  }
  const topParts = Object.values(partCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ part_number, part_name, count }) => ({ part_number, part_name, movement: count }));

  return {
    metrics: {
      inStock: stockRes.count ?? 0,
      inTransit: inTransitList.length,
      overdue: overdueList.length,
    },
    pipeline: ["draft", "packed", "in_transit"].map((status) => ({
      status,
      count: pipelineMap[status]?.count ?? 0,
      overdueCount: pipelineMap[status]?.overdueCount ?? 0,
    })),
    activity: activity.slice(0, 8),
    stockInThisWeek,
    pendingCorrections,
    topParts,
  };
}

export async function fetchTransfers(): Promise<Transfer[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("transfers")
    .select(`
      id, transfer_no, status, created_at, packed_at,
      destination_site:sites!destination_site_id(site_name, site_code),
      requested_by_profile:profiles!requested_by(full_name, username),
      transfer_items(id)
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(friendlyError(error));
  if (!data) return [];

  return data.map((transfer: any) => ({
    id: transfer.id,
    transfer_no: transfer.transfer_no,
    status: transfer.status,
    destination_site: Array.isArray(transfer.destination_site)
      ? transfer.destination_site[0] ?? null
      : transfer.destination_site,
    requested_by_profile: Array.isArray(transfer.requested_by_profile)
      ? transfer.requested_by_profile[0] ?? null
      : transfer.requested_by_profile,
    created_at: transfer.created_at,
    packed_at: transfer.packed_at,
    item_count: Array.isArray(transfer.transfer_items) ? transfer.transfer_items.length : 0,
  }));
}

export async function fetchInventoryRowsCached(
  page = 0,
  pageSize = INVENTORY_PAGE_SIZE,
  filters: { segment?: string; search?: string } = {},
): Promise<InventoryRowsData> {
  try {
    return {
      ...(await fetchInventoryRows(page, pageSize, filters)),
      errorMessage: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? friendlyError(error) : "Failed to load inventory";
    return {
      rows: demoInventoryRows,
      source: "demo",
      errorMessage: `Unable to load project inventory (${reason}).`,
    };
  }
}

export function prefetchRouteData(queryClient: QueryClient, path: string): Promise<void> {
  const pathname = path.split("?")[0];

  if (pathname === "/" || pathname === "/dashboard") {
    return queryClient.prefetchQuery({
      queryKey: dashboardQueryKey,
      queryFn: fetchDashboardData,
      staleTime: NAVIGATION_CACHE_STALE_TIME,
      gcTime: NAVIGATION_CACHE_GC_TIME,
    });
  }

  if (pathname === "/inventory") {
    return queryClient.prefetchQuery({
      queryKey: inventoryRowsQueryKey(0, "all", ""),
      queryFn: () => fetchInventoryRowsCached(0, INVENTORY_PAGE_SIZE, { segment: "all", search: "" }),
      staleTime: NAVIGATION_CACHE_STALE_TIME,
      gcTime: NAVIGATION_CACHE_GC_TIME,
    });
  }

  if (pathname === "/transfers") {
    return queryClient.prefetchQuery({
      queryKey: transfersQueryKey,
      queryFn: fetchTransfers,
      staleTime: NAVIGATION_CACHE_STALE_TIME,
      gcTime: NAVIGATION_CACHE_GC_TIME,
    });
  }

  return Promise.resolve();
}
