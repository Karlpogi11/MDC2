import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function useFeatureFlag(flagKey: string): boolean {
  const { data } = useQuery({
    queryKey: ["feature-flags", flagKey],
    queryFn: async () => {
      const flags = await api.get<Array<{ key: string; enabled: boolean }>>("/config/flags");
      return flags.find((f) => f.key === flagKey)?.enabled ?? false;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? false;
}
