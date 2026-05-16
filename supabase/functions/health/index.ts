import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const checks: Record<string, "ok" | "error"> = {};
  let healthy = true;

  // 1. DB connectivity — lightweight query
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await client.from("feature_flags").select("key").limit(1);
    checks.db = error ? "error" : "ok";
    if (error) healthy = false;
  } catch {
    checks.db = "error";
    healthy = false;
  }

  // 2. Storage — list buckets (confirms storage service is reachable)
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await client.storage.listBuckets();
    checks.storage = error ? "error" : "ok";
    if (error) healthy = false;
  } catch {
    checks.storage = "error";
    healthy = false;
  }

  // 3. Auth service — get service role user (confirms auth is reachable)
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
    checks.auth = error ? "error" : "ok";
    if (error) healthy = false;
  } catch {
    checks.auth = "error";
    healthy = false;
  }

  return new Response(
    JSON.stringify({
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    }),
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    },
  );
});
