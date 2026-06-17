import type { QueryClient } from "@tanstack/react-query";
import { demoInventoryRows } from "@/data/demoInventory";
import { friendlyError } from "@/lib/friendlyError";
import { api } from "@/lib/api";
import type { InventoryQueryResult } from "@/types";

export const NAVIGATION_CACHE_STALE_TIME = 300_000;
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
  try {
    const data = await api.get<DashboardData>("/dashboard");
    return data;
  } catch {
    return {
      metrics: { inStock: 0, inTransit: 0, overdue: 0 },
      pipeline: [],
      activity: [],
      stockInThisWeek: 0,
      pendingCorrections: 0,
      topParts: [],
    };
  }
}

export async function fetchTransfers(): Promise<Transfer[]> {
  try {
    return await api.get<Transfer[]>("/transfers?limit=100");
  } catch {
    return [];
  }
}

export async function fetchInventoryRowsCached(
  page = 0,
  pageSize = INVENTORY_PAGE_SIZE,
  filters: { segment?: string; search?: string } = {},
): Promise<InventoryRowsData> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (filters.segment) params.set("segment", filters.segment);
    if (filters.search) params.set("q", filters.search);

    const result = await api.get<InventoryQueryResult>(`/inventory?${params.toString()}`);
    return { ...result, source: "mysql", errorMessage: null };
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
