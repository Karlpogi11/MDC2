import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function useBranding() {
  const query = useQuery({
    queryKey: ["branding"],
    queryFn: () => api.get<Record<string, string>>("/config"),
    staleTime: 10 * 60 * 1000,
  });

  const data = query.data ?? {};
  return {
    ...query,
    brandName: data.brand_name ?? "MDC Inventory",
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
