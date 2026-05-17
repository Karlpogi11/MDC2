import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const checks: Record<string, "ok" | "error"> = {};

  // DB check
  try {
    const { error } = await client.from("parts").select("id").limit(1);
    checks.db = error ? "error" : "ok";
  } catch {
    checks.db = "error";
  }

  // Storage check
  try {
    const { error } = await client.storage.getBucket("imports-stockin");
    checks.storage = error ? "error" : "ok";
  } catch {
    checks.storage = "error";
  }

  // Auth check
  try {
    const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
    checks.auth = error ? "error" : "ok";
  } catch {
    checks.auth = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  const status = allOk ? 200 : 503;

  return new Response(
    JSON.stringify({ status: allOk ? "ok" : "degraded", ...checks, ts: new Date().toISOString() }),
    { status, headers: { "Content-Type": "application/json", ...CORS } }
  );
});
