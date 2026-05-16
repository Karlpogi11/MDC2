import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase";

type OnlineState = "online" | "offline" | "restored";

export function useOnlineStatus(): OnlineState {
  const [status, setStatus] = useState<OnlineState>(navigator.onLine ? "online" : "offline");

  useEffect(() => {
    async function check(): Promise<boolean> {
      const client = getSupabaseClient();
      if (!client) return false;
      try {
        const { error } = await client.from("feature_flags").select("key").limit(1).maybeSingle();
        return !error;
      } catch {
        return false;
      }
    }

    const handleOffline = () => setStatus("offline");

    const handleOnline = () => {
      void check().then((ok) => {
        if (ok) {
          setStatus("restored");
          // Auto-clear "restored" after 3s
          setTimeout(() => setStatus("online"), 3000);
        }
      });
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    void check().then((ok) => setStatus(ok ? "online" : "offline"));
    const id = setInterval(() => {
      void check().then((ok) => {
        setStatus((prev) => {
          if (ok && prev === "offline") {
            setTimeout(() => setStatus("online"), 3000);
            return "restored";
          }
          if (!ok) return "offline";
          return prev;
        });
      });
    }, 30_000);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearInterval(id);
    };
  }, []);

  return status;
}
