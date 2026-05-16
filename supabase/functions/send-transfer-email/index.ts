import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://your-app.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const DC_ROLES = ["system_admin", "dc_admin", "dc_operator"];

async function sendGmailSmtp(opts: { to: string; subject: string; html: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const credentials = btoa(`\0${GMAIL_USER}\0${GMAIL_APP_PASSWORD}`);
  const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
  const rawMessage = [
    `From: MDC Inventory <${GMAIL_USER}>`,
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

  // ── Auth: must be authenticated DC staff ──────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonResp({ ok: false, reason: "Unauthorized" }, 401);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return jsonResp({ ok: false, reason: "Unauthorized" }, 401);

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!DC_ROLES.includes(profile?.role ?? "")) {
    return jsonResp({ ok: false, reason: "Forbidden — DC staff only" }, 403);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let transfer_id: string | undefined;
  try {
    const body = await req.text();
    if (body) transfer_id = JSON.parse(body)?.transfer_id;
  } catch {
    return jsonResp({ ok: false, reason: "Invalid JSON" }, 400);
  }
  if (!transfer_id || typeof transfer_id !== "string" || !/^[0-9a-f-]{36}$/.test(transfer_id)) {
    return jsonResp({ ok: false, reason: "Invalid transfer_id" }, 400);
  }

  // ── Fetch transfer ────────────────────────────────────────────────────────
  const { data: transfer, error } = await adminClient
    .from("transfers")
    .select(`
      id, transfer_no, status, created_at,
      source_site:sites!source_site_id(site_name),
      destination_site:sites!destination_site_id(site_name, contact_emails),
      requested_by_profile:profiles!requested_by(full_name, username),
      items:transfer_items(qty, part:parts(part_number, part_name), serial:serial_numbers(serial_number))
    `)
    .eq("id", transfer_id)
    .single();

  if (error || !transfer) return jsonResp({ ok: false, reason: "Transfer not found" }, 404);

  const dest = Array.isArray(transfer.destination_site) ? transfer.destination_site[0] : transfer.destination_site;
  const emails: string[] = (dest?.contact_emails ?? []).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (emails.length === 0) {
    return jsonResp({ ok: false, skipped: true, reason: "No valid contact_emails on destination site", fix: "Edit the destination site in Config > Sites and add contact emails." });
  }

  // ── Receipt token ─────────────────────────────────────────────────────────
  const token = generateToken();
  await adminClient.from("transfers").update({
    receipt_token: token,
    receipt_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).eq("id", transfer_id);

  const receiptUrl = `${APP_URL}/transfers/${transfer_id}/receive?token=${token}`;
  const source = Array.isArray(transfer.source_site) ? transfer.source_site[0] : transfer.source_site;
  const items = (transfer.items ?? []).map((i: any) => {
    const part = Array.isArray(i.part) ? i.part[0] : i.part;
    const serial = Array.isArray(i.serial) ? i.serial[0] : i.serial;
    return { serial: serial?.serial_number ?? "—", part_number: part?.part_number ?? "—", part_name: part?.part_name ?? "—", qty: i.qty };
  });

  // ── HTML — all DB values escaped ──────────────────────────────────────────
  const itemLines = items.map((i) => `  - ${i.serial} | ${i.part_number} | ${i.part_name}`).join("\n");

  const plainText = `MDC Transfer Notice
Transfer #${transfer.transfer_no}

From: ${source?.site_name ?? "DC"}
To: ${dest?.site_name ?? "your site"}

Items:
${itemLines}

Confirm receipt (link expires in 7 days):
${receiptUrl}

MDC Inventory System`;

  const result = await sendGmailSmtp({
    to: emails[0],
    subject: `Transfer ${transfer.transfer_no} dispatched to ${dest?.site_name ?? "your site"}`,
    text: plainText,
    html: plainText.replace(/\n/g, "<br>").replace(receiptUrl, `<a href="${esc(receiptUrl)}">${esc(receiptUrl)}</a>`),
  });

  if (!result.ok) {
    console.error("[send-transfer-email] SMTP error:", result.error);
    return jsonResp({ ok: false, reason: "SMTP send failed", error: result.error }, 500);
  }

  console.log(`[send-transfer-email] sent to ${emails[0]} for ${transfer.transfer_no}`);
  return jsonResp({ ok: true, sent_to: emails[0], transfer_no: transfer.transfer_no });
});
