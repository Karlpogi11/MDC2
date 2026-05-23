import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-internal-key, content-type",
};

function isServiceRequest(req: Request): boolean {
  const sharedSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
  const suppliedSecret = req.headers.get("x-internal-key") ?? "";
  if (sharedSecret && suppliedSecret === sharedSecret) return true;

  const apiKey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return apiKey === SUPABASE_SERVICE_ROLE_KEY || bearer === SUPABASE_SERVICE_ROLE_KEY;
}

async function sendGmailSmtp(opts: { to: string; from: string; subject: string; html: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const credentials = btoa(`\0${GMAIL_USER}\0${GMAIL_APP_PASSWORD}`);
  const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
  const rawMessage = [
    `From: ${opts.from} <${GMAIL_USER}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  let conn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
    const read = async () => { const buf = new Uint8Array(4096); const n = await conn!.read(buf); return decoder.decode(buf.subarray(0, n ?? 0)); };
    const write = async (cmd: string) => conn!.write(encoder.encode(`${cmd}\r\n`));
    let r = await read(); if (!r.startsWith("220")) return { ok: false, error: `Greeting: ${r}` };
    await write("EHLO mdc-inventory"); r = await read(); if (!r.includes("250")) return { ok: false, error: `EHLO: ${r}` };
    await write(`AUTH PLAIN ${credentials}`); r = await read(); if (!r.startsWith("235")) return { ok: false, error: `AUTH: ${r}` };
    await write(`MAIL FROM:<${GMAIL_USER}>`); r = await read(); if (!r.startsWith("250")) return { ok: false, error: `MAIL FROM: ${r}` };
    await write(`RCPT TO:<${opts.to}>`); r = await read(); if (!r.startsWith("250")) return { ok: false, error: `RCPT TO: ${r}` };
    await write("DATA"); r = await read(); if (!r.startsWith("354")) return { ok: false, error: `DATA: ${r}` };
    await write(`${rawMessage}\r\n.`); r = await read(); if (!r.startsWith("250")) return { ok: false, error: `Send: ${r}` };
    await write("QUIT");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  } finally {
    try { conn?.close(); } catch { /* noop */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!isServiceRequest(req)) return new Response("Unauthorized", { status: 401, headers: CORS });

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Get brand name
  const { data: brandRow } = await client.from("app_config").select("value").eq("key", "brand_name").maybeSingle();
  const brandName = brandRow?.value ?? "MDC Inventory";

  // Get active digest jobs
  const { data: jobs } = await client
    .from("report_jobs")
    .select("id, recipients")
    .eq("type", "weekly_digest")
    .eq("is_active", true);

  if (!jobs?.length) return new Response(JSON.stringify({ skipped: true, reason: "No active digest jobs" }), { headers: { "Content-Type": "application/json", ...CORS } });

  // Gather stats
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [stockRes, transferRes, correctionRes, stockInRes] = await Promise.all([
    client.from("serial_numbers").select("id", { count: "exact", head: true }).eq("status", "in_stock"),
    client.from("transfers").select("id", { count: "exact", head: true }).in("status", ["draft", "packed", "in_transit"]),
    client.from("serial_corrections").select("id", { count: "exact", head: true }).gte("corrected_at", weekAgo),
    client.from("serial_numbers").select("id", { count: "exact", head: true }).gte("stock_in_at", weekAgo),
  ]);

  const inStockCount = stockRes.count ?? 0;
  const pendingCount = transferRes.count ?? 0;
  const correctionCount = correctionRes.count ?? 0;
  const stockInCount = stockInRes.count ?? 0;

  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const subject = `${brandName} — Weekly Digest · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const text = [
    `${brandName} — Weekly Digest`,
    `Week ending ${dateStr}`,
    ``,
    `In Stock:            ${inStockCount} serials`,
    `Stocked-in this week: ${stockInCount}`,
    `Pending Transfers:   ${pendingCount}`,
    `Corrections:         ${correctionCount}`,
    ``,
    `${brandName} — automated report`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Inter',Arial,sans-serif;color:#111;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <p style="margin:0 0 2px;font-size:12px;font-weight:600;color:#888;letter-spacing:.04em;">${brandName}</p>
    <h1 style="margin:0 0 8px;font-size:18px;font-weight:700;">Weekly Digest</h1>
    <p style="margin:0 0 24px;font-size:13px;color:#6b7a8d;">Week ending ${dateStr}</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin-bottom:24px;">
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#6b7a8d;">In Stock</td><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:700;text-align:right;">${inStockCount}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#6b7a8d;">Stocked-in this week</td><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:700;text-align:right;">${stockInCount}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#6b7a8d;">Pending Transfers</td><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:700;text-align:right;">${pendingCount}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#6b7a8d;">Corrections this week</td><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:700;text-align:right;">${correctionCount}</td></tr>
    </table>

    <p style="margin:0;font-size:11px;color:#aaa;">${brandName} — automated report</p>
  </div>
</body></html>`;

  // Send to all recipients
  const allRecipients = [...new Set(jobs.flatMap((j: any) => j.recipients ?? []))];
  const results: { to: string; ok: boolean; error?: string }[] = [];

  for (const to of allRecipients) {
    const res = await sendGmailSmtp({ to, from: brandName, subject, html, text });
    results.push({ to, ...res });
    if (!res.ok) console.error(`[weekly-digest] failed for ${to}: ${res.error}`);
  }

  // Update last_run_at
  await client.from("report_jobs")
    .update({ last_run_at: new Date().toISOString() })
    .eq("type", "weekly_digest")
    .eq("is_active", true);

  const sentCount = results.filter((r) => r.ok).length;
  console.log(`[weekly-digest] sent ${sentCount}/${allRecipients.length}`);
  return new Response(JSON.stringify({ sent: sentCount, total: allRecipients.length, results }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
