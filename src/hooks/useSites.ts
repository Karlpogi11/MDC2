import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Site = { id: string; siteName: string; siteCode: string; isDc: boolean; shipToCode: string | null };

export function useSites() {
  return useQuery<Site[]>({
    queryKey: ["sites"],
    queryFn: () => api.get("/sites"),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
