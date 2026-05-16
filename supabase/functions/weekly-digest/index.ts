import { createClient } from "jsr:@supabase/supabase-js@2";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;         // your@gmail.com
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!; // 16-char app password

Deno.serve(async (_req) => {
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: jobs } = await client
    .from("report_jobs")
    .select("id, recipients")
    .eq("type", "weekly_digest")
    .eq("is_active", true);

  if (!jobs?.length) return new Response("No active digest jobs", { status: 200 });

  const [{ data: inStock }, { data: pendingTransfers }, { data: recentCorrections }] = await Promise.all([
    client.from("serial_numbers").select("id", { count: "exact", head: true }).eq("status", "in_stock"),
    client.from("transfers").select("id", { count: "exact", head: true }).in("status", ["draft", "packed", "in_transit"]),
    client.from("serial_corrections").select("id").gte("corrected_at", new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  const subject = `MDC Weekly Digest — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const html = `
    <h2 style="color:#1a2a3a">MDC Weekly Inventory Digest</h2>
    <p>Week ending ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
    <table style="border-collapse:collapse;width:100%;max-width:480px">
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">In Stock</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${(inStock as any)?.length ?? 0} serials</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Pending Transfers</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${(pendingTransfers as any)?.length ?? 0}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Corrections this week</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${recentCorrections?.length ?? 0}</td></tr>
    </table>
    <p style="margin-top:20px;font-size:12px;color:#9ca3af">MDC Inventory System · Automated digest</p>
  `;

  const allRecipients = [...new Set(jobs.flatMap((j: any) => j.recipients ?? []))];

  if (allRecipients.length > 0) {
    const smtp = new SmtpClient();
    await smtp.connectTLS({ hostname: "smtp.gmail.com", port: 465, username: GMAIL_USER, password: GMAIL_APP_PASSWORD });

    for (const to of allRecipients) {
      await smtp.send({ from: GMAIL_USER, to, subject, content: html, html });
    }
    await smtp.close();
  }

  await client.from("report_jobs")
    .update({ last_run_at: new Date().toISOString() })
    .eq("type", "weekly_digest")
    .eq("is_active", true);

  return new Response(JSON.stringify({ sent_to: allRecipients.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
