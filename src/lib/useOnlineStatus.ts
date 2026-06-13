import { useState, useEffect, useRef } from "react";
import { api } from "./api";

export function useOnlineStatus(): "online" | "offline" | "restored" {
  const [status, setStatus] = useState<"online" | "offline" | "restored">(
    navigator.onLine ? "online" : "offline",
  );
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => {
      if (wasOfflineRef.current) {
        setStatus("restored");
        wasOfflineRef.current = false;
        setTimeout(() => setStatus("online"), 2000);
      } else {
        setStatus("online");
      }
    };
    const handleOffline = () => {
      wasOfflineRef.current = true;
      setStatus("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(async () => {
      try {
        await api.get("/health");
        if (status !== "online" && status !== "restored") {
          if (wasOfflineRef.current) {
            setStatus("restored");
            wasOfflineRef.current = false;
            setTimeout(() => setStatus("online"), 2000);
          } else {
            setStatus("online");
          }
        }
      } catch {
        if (status === "online" || status === "restored") {
          wasOfflineRef.current = true;
          setStatus("offline");
        }
      }
    }, 15000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [status]);

  return status;
}
