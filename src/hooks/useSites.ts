import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Site = { id: string; site_name: string; site_code: string; is_dc: boolean; ship_to_code: string | null };

export function useSites() {
  return useQuery<Site[]>({
    queryKey: ["sites"],
    queryFn: () => api.get("/sites"),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
