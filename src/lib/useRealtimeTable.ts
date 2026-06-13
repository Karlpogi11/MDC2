import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

type Tables = string | string[];

export function useRealtimeTable(
  tables: Tables,
  onUpdate?: () => void,
  enabled = true,
): string {
  const queryClient = useQueryClient();
  const tableList = Array.isArray(tables) ? tables : [tables];

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      for (const table of tableList) {
        queryClient.invalidateQueries({ queryKey: [table] });
      }
      onUpdate?.();
    }, 10000);

    return () => clearInterval(interval);
  }, [tableList.join(","), enabled, onUpdate, queryClient]);

  return enabled ? "live" : "connecting";
}
