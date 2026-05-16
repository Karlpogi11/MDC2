import { useEffect, useState, useCallback } from "react";
import { getSupabaseClient } from "./supabase";
import { useAuth } from "./auth";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export function useNotifications() {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const fetchNotifications = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client || !userId) return;
    const { data } = await client
      .from("notifications")
      .select("id,type,title,body,entity_type,entity_id,read_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications((data ?? []) as Notification[]);
    setLoading(false);
  }, [userId]);

  // Initial fetch
  useEffect(() => {
    if (!userId) return;
    void fetchNotifications();
  }, [fetchNotifications, userId]);

  // Realtime subscription
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || !userId) return;

    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev]);
        }
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [userId]);

  const markAllRead = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client || !userId) return;
    const now = new Date().toISOString();
    await client
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    const client = getSupabaseClient();
    if (!client) return;
    const now = new Date().toISOString();
    await client.from("notifications").update({ read_at: now }).eq("id", id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: now } : n));
  }, []);

  return { notifications, unreadCount, loading, markAllRead, markRead };
}
