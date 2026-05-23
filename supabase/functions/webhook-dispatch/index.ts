import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmacSign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // ── Auth: only dc_admin / system_admin ────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401, headers: CORS });

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return new Response("Unauthorized", { status: 401, headers: CORS });

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await adminClient.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !["system_admin", "dc_admin"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403, headers: CORS });
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  let event: string, data: Record<string, unknown>;
  try {
    const parsed = await req.json();
    event = parsed?.event;
    data = parsed?.data ?? {};
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS });
  }
  if (!event || typeof event !== "string" || event.length > 100) {
    return new Response("Missing or invalid event", { status: 400, headers: CORS });
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const { data: webhooks } = await adminClient
    .from("webhooks")
    .select("id, url, secret")
    .eq("is_active", true)
    .contains("events", [event]);

  if (!webhooks?.length) {
    return new Response(JSON.stringify({ dispatched: 0 }), { headers: { "Content-Type": "application/json", ...CORS } });
  }

  const body = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  const results = await Promise.allSettled(
    webhooks.map(async (wh: any) => {
      const sig = await hmacSign(wh.secret, body);
      const res = await fetch(wh.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-MDC-Signature": `sha256=${sig}`, "X-MDC-Event": event },
        body,
        signal: AbortSignal.timeout(10000),
      });
      return { id: wh.id, status: res.status, ok: res.ok };
    })
  );

  const dispatched = results.filter((r) => r.status === "fulfilled" && (r.value as any).ok).length;
  return new Response(JSON.stringify({ dispatched, total: webhooks.length }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
