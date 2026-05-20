/**
 * analyze-parts-trend
 * Queries analytics_summary materialized view and returns trend data
 * filtered by date range, site, source type, and optional part numbers.
 *
 * POST body:
 *   date_from?    string  "YYYY-MM-DD"
 *   date_to?      string  "YYYY-MM-DD"
 *   site_codes?   string[]
 *   source_types? string[]  ["fixably","gsx"]
 *   part_numbers? string[]  (optional filter)
 *   top_n?        number    top N parts by qty (default 20)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const {
    date_from,
    date_to,
    site_codes,
    source_types,
    part_numbers,
    top_n = 20,
  } = body as {
    date_from?: string;
    date_to?: string;
    site_codes?: string[];
    source_types?: string[];
    part_numbers?: string[];
    top_n?: number;
  };

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Query analytics_summary ───────────────────────────────────────────────
  let q = admin
    .from("analytics_summary")
    .select("part_number,part_name,site_code,source_type,month,total_qty,repair_count,last_used");

  if (date_from) q = q.gte("month", date_from);
  if (date_to)   q = q.lte("month", date_to);
  if (site_codes?.length)   q = q.in("site_code", site_codes);
  if (source_types?.length) q = q.in("source_type", source_types);
  if (part_numbers?.length) q = q.in("part_number", part_numbers);

  const { data: rows, error: qErr } = await q.order("month").order("total_qty", { ascending: false });
  if (qErr) return json({ error: qErr.message }, 500);

  const summary = rows ?? [];

  // ── Aggregate: top parts by total qty ────────────────────────────────────
  const partTotals = new Map<string, { part_number: string; part_name: string | null; total_qty: number; repair_count: number }>();
  for (const r of summary) {
    const existing = partTotals.get(r.part_number);
    if (existing) {
      existing.total_qty += r.total_qty;
      existing.repair_count += r.repair_count;
    } else {
      partTotals.set(r.part_number, { part_number: r.part_number, part_name: r.part_name, total_qty: r.total_qty, repair_count: r.repair_count });
    }
  }
  const topParts = [...partTotals.values()]
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, Math.min(top_n, 100));

  // ── Aggregate: monthly trend (all parts combined) ─────────────────────────
  const monthMap = new Map<string, { month: string; total_qty: number; repair_count: number }>();
  for (const r of summary) {
    const m = String(r.month).slice(0, 7); // "YYYY-MM"
    const existing = monthMap.get(m);
    if (existing) {
      existing.total_qty += r.total_qty;
      existing.repair_count += r.repair_count;
    } else {
      monthMap.set(m, { month: m, total_qty: r.total_qty, repair_count: r.repair_count });
    }
  }
  const monthlyTrend = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  // ── Aggregate: by site ────────────────────────────────────────────────────
  const siteMap = new Map<string, number>();
  for (const r of summary) {
    const site = r.site_code ?? "Unknown";
    siteMap.set(site, (siteMap.get(site) ?? 0) + r.total_qty);
  }
  const bySite = [...siteMap.entries()]
    .map(([site_code, total_qty]) => ({ site_code, total_qty }))
    .sort((a, b) => b.total_qty - a.total_qty);

  return json({ topParts, monthlyTrend, bySite, totalRows: summary.length });
});
