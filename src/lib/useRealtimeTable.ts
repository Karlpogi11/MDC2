import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "./supabase";

type RealtimeStatus = "connecting" | "live" | "disconnected";

/**
 * Subscribes to postgres_changes on a table and calls onUpdate when any
 * INSERT/UPDATE/DELETE fires. Returns the current connection status.
 */
export function useRealtimeTable(
  table: string,
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

    const channel = client
      .channel(`realtime:${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => onUpdateRef.current()
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("live");
        else if (s === "CLOSED" || s === "CHANNEL_ERROR") setStatus("disconnected");
      });

    return () => { void client.removeChannel(channel); };
  }, [table, enabled]);

  return status;
}
