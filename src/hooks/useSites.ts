import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";

export type Site = { id: string; site_name: string; site_code: string; is_dc: boolean; ship_to_code?: string | null };

async function fetchSites(): Promise<Site[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data } = await client
    .from("sites")
    .select("id, site_name, site_code, is_dc, ship_to_code")
    .eq("is_active", true)
    .order("site_name");
  return (data ?? []) as Site[];
}

/** Cached sites list — fetched once, shared across all components, stale after 5 min */
export function useSites() {
  return useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
  });
}
