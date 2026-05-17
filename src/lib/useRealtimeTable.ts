import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "./supabase";

type RealtimeStatus = "connecting" | "live" | "disconnected";

/**
 * Subscribes to postgres_changes on one or more tables and calls onUpdate
 * when any INSERT/UPDATE/DELETE fires. Returns the current connection status.
 */
export function useRealtimeTable(
  tables: string | string[],
  onUpdate: () => void,
  enabled = true
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!enabled) return;
    const client = getSupabaseClient();
    if (!client) { setStatus("disconnected"); return; }

    const tableList = Array.isArray(tables) ? tables : [tables];
    const key = tableList.join(",");

    let channel = client.channel(`realtime:${key}`);
    for (const table of tableList) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => onUpdateRef.current()
      );
    }
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") setStatus("live");
      else if (s === "CLOSED" || s === "CHANNEL_ERROR") setStatus("disconnected");
    });

    return () => { void client.removeChannel(channel); };
  }, [Array.isArray(tables) ? tables.join(",") : tables, enabled]);

  return status;
}
