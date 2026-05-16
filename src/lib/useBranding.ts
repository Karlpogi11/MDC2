import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase";

type BrandingData = {
  logoUrl: string | null;
  brandName: string | null;
  primary?: string;
  accent?: string;
};

// Module-level cache — survives route changes, cleared only on branding-updated
let cache: BrandingData | null = null;
let inflight: Promise<BrandingData> | null = null;

async function fetchBranding(): Promise<BrandingData> {
  if (cache) return cache;
  if (inflight) return inflight;

  const client = getSupabaseClient();
  if (!client) return { logoUrl: null, brandName: null };

  inflight = client
    .from("app_config")
    .select("key,value")
    .in("key", ["brand_primary_color", "brand_accent_color", "brand_logo_url", "brand_name"])
    .then(({ data }) => {
      const map: Record<string, string> = {};
      for (const row of data ?? []) if (row.value) map[row.key] = row.value;
      cache = {
        logoUrl: map.brand_logo_url ?? null,
        brandName: map.brand_name ?? null,
        primary: map.brand_primary_color,
        accent: map.brand_accent_color,
      };
      inflight = null;
      return cache as BrandingData;
    }) as Promise<BrandingData>;

  return inflight;
}

function applyCSS(b: BrandingData) {
  const root = document.documentElement;
  if (b.primary) root.style.setProperty("--blue", b.primary);
  if (b.accent) root.style.setProperty("--nav-active", b.accent);
}

export function useBranding() {
  const [branding, setBranding] = useState<BrandingData>(
    // Use cache synchronously if available — no flash on route change
    () => cache ?? { logoUrl: null, brandName: null }
  );

  useEffect(() => {
    void fetchBranding().then((b) => { applyCSS(b); setBranding(b); });

    const handler = () => {
      cache = null;
      inflight = null;
      void fetchBranding().then((b) => { applyCSS(b); setBranding(b); });
    };
    window.addEventListener("branding-updated", handler);
    return () => window.removeEventListener("branding-updated", handler);
  }, []);

  return branding;
}

export function notifyBrandingUpdated() {
  window.dispatchEvent(new Event("branding-updated"));
}
