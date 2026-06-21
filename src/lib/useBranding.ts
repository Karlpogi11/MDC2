import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { api } from "./api";

const BRANDING_CACHE_KEY = "mdc-branding-cache";

function getCached(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(BRANDING_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function setCached(data: Record<string, string>) {
  try {
    localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function useBranding() {
  const [_, setTick] = useState(0);
  
  useEffect(() => {
    return onBrandingUpdated(() => setTick((t) => t + 1));
  }, []);

  const cached = getCached();
  const query = useQuery({
    queryKey: ["branding"],
    queryFn: async () => {
      const data = await api.get<Record<string, string>>(`/config?_=${Date.now()}`);
      if (data) setCached(data);
      return data;
    },
    initialData: cached,
    staleTime: 60 * 1000, // 1 min — refetch in background on mount if stale
  });

  const data = query.data ?? cached;
  return {
    ...query,
    brandName: data.brand_name ?? "MDC Inventory",
    brandLogoUrl: data.brand_logo_url ?? null,
    supportEmail: data.support_email ?? null,
    loginNotice: data.login_notice ?? null,
  };
}

let brandingListeners: Array<() => void> = [];
export function notifyBrandingUpdated() {
  brandingListeners.forEach((fn) => fn());
}
export function onBrandingUpdated(fn: () => void) {
  brandingListeners.push(fn);
  return () => {
    brandingListeners = brandingListeners.filter((f) => f !== fn);
  };
}
