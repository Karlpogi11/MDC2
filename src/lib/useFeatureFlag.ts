import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "./supabase";
import { useAuth } from "./auth";

type FeatureFlag = {
  key: string;
  enabled: boolean;
  roles: string[] | null;
};

async function fetchFlags(): Promise<FeatureFlag[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data } = await client
    .from("feature_flags")
    .select("key,enabled,roles");
  return data ?? [];
}

/** Returns true if the flag is enabled and the current user's role is allowed. */
export function useFeatureFlag(key: string): boolean {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.profile.role : null;

  const { data: flags = [] } = useQuery({
    queryKey: ["feature_flags"],
    queryFn: fetchFlags,
    staleTime: 5 * 60 * 1000, // 5 min — flags don't change often
  });

  const flag = flags.find((f) => f.key === key);
  if (!flag || !flag.enabled) return false;
  if (!flag.roles || flag.roles.length === 0) return true;
  return role !== null && flag.roles.includes(role);
}
