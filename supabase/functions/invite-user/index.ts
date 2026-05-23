import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeadersForRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://mdc.app";

const json = (data: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Generate a secure temp password: 3 words + number + symbol pattern */
function generateTempPassword(): string {
  const words = ["Apple","Bravo","Cloud","Delta","Eagle","Foxtrot","Globe","Hotel","India","Juliet","Kilo","Lima","Mango","Nova","Oscar","Papa","Quebec","Romeo","Sierra","Tango"];
  const w1 = words[Math.floor(Math.random() * words.length)];
  const w2 = words[Math.floor(Math.random() * words.length)];
  const num = String(Math.floor(Math.random() * 90) + 10);
  const syms = ["!", "@", "#", "$", "%"];
  const sym = syms[Math.floor(Math.random() * syms.length)];
  return `${w1}${w2}${num}${sym}`;
}

async function sendWelcomeEmail(opts: {
  to: string;
  fullName: string;
  username: string;
  tempPassword: string;
  role: string;
  brandName: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { ok: false, error: "SMTP not configured" };
  }

  const roleLabel = opts.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const name = opts.fullName || opts.username;
  const pad = (label: string) => label.padEnd(22);

  const body = [
    `Hi ${name},`,
    ``,
    `Your ${opts.brandName} account has been created.`,
    `Use the credentials below to log in. You will be required`,
    `to change your password immediately after your first login.`,
    ``,
    `${pad("Login URL")}${APP_URL}/login`,
    `${pad("Username")}${opts.username}`,
    `${pad("Temporary Password")}${opts.tempPassword}`,
    `${pad("Role")}${roleLabel}`,
    ``,
    `Keep these credentials private. Do not share this email.`,
    ``,
    `— ${opts.brandName}`,
  ].join("\n");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const credentials = btoa(`\0${GMAIL_USER}\0${GMAIL_APP_PASSWORD}`);

  let conn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });

    const read = async () => {
      const buf = new Uint8Array(4096);
      const n = await conn!.read(buf);
      return n ? decoder.decode(buf.subarray(0, n)) : "";
    };
    const write = (cmd: string) => conn!.write(encoder.encode(`${cmd}\r\n`));

    await read();
    await write("EHLO mdc-app"); await read();
    await write(`AUTH PLAIN ${credentials}`);
    const authResp = await read();
    if (!authResp.startsWith("235")) throw new Error(`Auth failed: ${authResp}`);

    await write(`MAIL FROM:<${GMAIL_USER}>`); await read();
    await write(`RCPT TO:<${opts.to}>`); await read();
    await write("DATA"); await read();

    const msg = [
      `From: ${opts.brandName} <${GMAIL_USER}>`,
      `To: ${opts.to}`,
      `Subject: Your ${opts.brandName} Account Credentials`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      body,
      `.`,
    ].join("\r\n");

    await conn.write(encoder.encode(msg + "\r\n"));
    const sendResp = await read();
    if (!sendResp.startsWith("250")) throw new Error(`Send failed: ${sendResp}`);

    await write("QUIT");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { conn?.close(); } catch { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  const cors = corsHeadersForRequest(req, { methods: "POST, OPTIONS" });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401, cors);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401, cors);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!callerProfile?.is_active || callerProfile.role !== "system_admin") {
    return json({ error: "Forbidden — system_admin required" }, 403, cors);
  }

  const { email, username, full_name, role } = await req.json();
  if (!email || !username || !role) {
    return json({ error: "email, username, role required" }, 400, cors);
  }
  if (!["system_admin", "dc_admin", "dc_operator", "dc_viewer"].includes(role)) {
    return json({ error: "Invalid role" }, 400, cors);
  }

  // Auto-generate temp password
  const tempPassword = generateTempPassword();

  // Try to create; if duplicate, find and update instead
  let userId: string;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (createErr) {
    const isDuplicate = createErr.message?.toLowerCase().includes("already") ||
                        createErr.message?.toLowerCase().includes("registered");
    if (!isDuplicate) return json({ error: createErr.message }, 400, cors);

    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) return json({ error: listErr.message }, 400, cors);
    const existing = listData.users.find((u) => u.email === email);
    if (!existing) return json({ error: "User exists but could not be located." }, 400, cors);

    const { error: updateErr } = await admin.auth.admin.updateUserById(existing.id, {
      password: tempPassword,
      email_confirm: true,
    });
    if (updateErr) return json({ error: updateErr.message }, 400, cors);
    userId = existing.id;
  } else {
    if (!created.user) return json({ error: "Failed to create user" }, 400, cors);
    userId = created.user.id;
  }

  // Upsert profile with force_password_change = true
  const { error: profileErr } = await admin.from("profiles").upsert({
    id: userId,
    email,
    full_name: full_name ?? null,
    username,
    role,
    is_active: true,
    force_password_change: true,
  }, { onConflict: "id" });

  if (profileErr) return json({ error: profileErr.message }, 400, cors);

  // Fetch brand name from app_config
  const { data: brandRow } = await admin.from("app_config").select("value").eq("key", "brand_name").single();
  const brandName = brandRow?.value ?? "MDC Inventory";

  // Send welcome email with credentials
  const emailResult = await sendWelcomeEmail({
    to: email,
    fullName: full_name ?? "",
    username,
    tempPassword,
    role,
    brandName,
  });

  return json({
    id: userId,
    email_sent: emailResult.ok,
    email_error: emailResult.ok ? null : emailResult.error,
  }, 200, cors);
});
