import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const APP_URL = normalizeAppUrl(Deno.env.get("APP_URL"));

const BASE_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const LOGO_FETCH_TIMEOUT_MS = 2500;
const PDF_BUILD_TIMEOUT_MS = 25000;
const PACKING_LIST_LOGO_OFFSET_MM = 4.5;
const SMTP_CONNECT_TIMEOUT_MS = 12000;
const SMTP_IO_TIMEOUT_MS = 12000;
const SMTP_DATA_ACK_TIMEOUT_MS = 45000;
const SMTP_TOTAL_TIMEOUT_MS = 90000;
const SMTP_ATTACHMENT_RETRY_COUNT = 2;
const SMTP_RETRY_DELAY_MS = 500;

function corsForRequest(req: Request) {
  const requestedHeaders = req.headers.get("Access-Control-Request-Headers");
  if (requestedHeaders && requestedHeaders.trim().length > 0) {
    return {
      ...BASE_CORS,
      "Access-Control-Allow-Headers": requestedHeaders,
    };
  }
  return BASE_CORS;
}

function jsonResp(body: unknown, status = 200, cors: Record<string, string> = BASE_CORS) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeAppUrl(raw: string | undefined): string {
  const input = (raw ?? "").trim();
  if (!input) return "https://your-app.com";

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(input);
  const localHostPattern = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/.*)?$/i;
  const inferredScheme = localHostPattern.test(input) ? "http" : "https";
  const candidate = hasScheme ? input : `${inferredScheme}://${input}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported protocol");
    parsed.hash = "";
    parsed.search = "";
    const pathNoSlash = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathNoSlash}`;
  } catch {
    console.warn(`[send-transfer-email] Invalid APP_URL "${input}". Using default.`);
    return "https://your-app.com";
  }
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const DC_ROLES = ["system_admin", "dc_admin", "dc_operator"];

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

function normalizeSerialKey(value: string): string {
  return value.trim().toUpperCase();
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function foldBase64Lines(base64: string, lineLength = 76): string {
  if (!base64) return "";
  if (lineLength <= 0 || base64.length <= lineLength) return base64;
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += lineLength) {
    lines.push(base64.slice(i, i + lineLength));
  }
  return lines.join("\r\n");
}

async function fetchLogoBytes(brandLogoUrl?: string | null): Promise<Uint8Array | null> {
  const candidates = [brandLogoUrl, `${APP_URL}/packinglistlogo.png`]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  for (const raw of candidates) {
    let url: string;
    try {
      url = new URL(raw, `${APP_URL}/`).toString();
    } catch {
      continue;
    }

    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { Accept: "image/png,image/jpeg,image/webp,*/*" } },
        LOGO_FETCH_TIMEOUT_MS,
      );
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 0) return bytes;
    } catch {
      // Skip unreachable source and try next fallback.
    }
  }

  return null;
}


// ── Packing list PDF using pdf-lib (Deno-compatible, no DOM) ─────────────────
async function buildPackingListPDF(opts: {
  transferNo: string;
  invoiceRef: string;
  createdAt: string;
  sourceSite: string;
  destSite: string;
  destAddress: string | null;
  requestedBy: string;
  courier?: string | null;
  awb?: string | null;
  boxCount?: number | null;
  notes?: string | null;
  logoUrl?: string | null;
  items: { serial: string; part_number: string; part_name: string; qty: number }[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4 in points
  const { width, height } = page.getSize();
  const fontR = await doc.embedFont(StandardFonts.Helvetica);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
  let fontM = fontR;
  try {
    fontM = await doc.embedFont(StandardFonts.Courier);
  } catch {
    // fall back to Helvetica if Courier embed fails
  }

  // pdf-lib origin: BOTTOM-LEFT. Convert jsPDF mm coords: ptY = height - mm*2.835
  const mm = (v: number) => v * 2.835;
  const ptY = (mmVal: number) => height - mm(mmVal);

  const lgray = rgb(0.78, 0.78, 0.78);
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const hdrBg = rgb(107/255, 114/255, 128/255); // [107,114,128] from jsPDF
  const altBg = rgb(249/255, 250/255, 251/255); // [249,250,251]
  const fillGray = rgb(180/255, 180/255, 180/255);

  const margin = 14; // mm — matches jsPDF margin

  const txt = (s: string, xMm: number, yMm: number, sizePt = 9, font = fontR, color = black) => {
    // Sanitize: pdf-lib StandardFonts only support WinAnsi (Latin-1).
    // Replace common typographic chars and strip anything outside 0x20-0xFF.
    const safe = String(s ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2022/g, "*")
      .replace(/[\u00B7\u2027]/g, ".")
      .replace(/\u2192/g, "->")
      .replace(/[^\x20-\xFF]/g, "?");
    return page.drawText(safe, { x: mm(xMm), y: ptY(yMm), size: sizePt, font, color, maxWidth: mm(210 - xMm - margin) });
  };
  const txtCenteredInCell = (
    s: string,
    cellXmm: number,
    cellWmm: number,
    yMm: number,
    sizePt: number,
    font: typeof fontR,
    color = black,
  ) => {
    const safe = String(s ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2022/g, "*")
      .replace(/[\u00B7\u2027]/g, ".")
      .replace(/\u2192/g, "->")
      .replace(/[^\x20-\xFF]/g, "?");
    const cellCenterXmm = cellXmm + cellWmm / 2;
    const textWidthMm = (font.widthOfTextAtSize(safe, sizePt)) / 2.835;
    const textXmm = cellCenterXmm - textWidthMm / 2;
    page.drawText(safe, {
      x: mm(textXmm),
      y: ptY(yMm),
      size: sizePt,
      font,
      color,
      maxWidth: mm(cellWmm - 2),
    });
  };

  const rule = (yMm: number) =>
    page.drawLine({ start: { x: mm(margin), y: ptY(yMm) }, end: { x: mm(210 - margin), y: ptY(yMm) }, thickness: 0.85, color: lgray });

  const rect = (xMm: number, yMm: number, wMm: number, hMm: number, fill?: typeof black, stroke?: typeof lgray) =>
    page.drawRectangle({ x: mm(xMm), y: ptY(yMm + hMm), width: mm(wMm), height: mm(hMm),
      ...(fill ? { color: fill } : {}), ...(stroke ? { borderColor: stroke, borderWidth: 0.85 } : {}) });

  // ── Title at y=14mm ────────────────────────────────────────────────────────
  const titleStr = 'Packing List';
  const titleW = fontB.widthOfTextAtSize(titleStr, 13) / 2.835; // pt→mm
  txt(titleStr, (210 - titleW) / 2, 14, 13, fontB);

  // ── Header block starts at y=38mm ─────────────────────────────────────────
  const headerY = 38; // mm
  const senderX = margin + 28; // mm (logo placeholder width 22mm + 6mm gap)
  const logoSizeMm = 22;
  const logoSizePt = mm(logoSizeMm);

  // Logo (left)
  const logoBytes = await fetchLogoBytes(opts.logoUrl);
  if (logoBytes) {
    try {
      const image = await doc.embedPng(logoBytes);
      page.drawImage(image, {
        x: mm(margin),
        y: ptY(headerY + PACKING_LIST_LOGO_OFFSET_MM + logoSizeMm),
        width: logoSizePt,
        height: logoSizePt,
      });
    } catch {
      try {
        const image = await doc.embedJpg(logoBytes);
        page.drawImage(image, {
          x: mm(margin),
          y: ptY(headerY + PACKING_LIST_LOGO_OFFSET_MM + logoSizeMm),
          width: logoSizePt,
          height: logoSizePt,
        });
      } catch {
        // Skip logo if it cannot be embedded.
      }
    }
  }

  // Sender (left)
  txt('MOBILECARE SERVICES PHILS. INC.',              senderX, headerY + 5,  9,   fontB);
  txt('Business and Distribution Center',             senderX, headerY + 11, 8,   fontR, black);
  txt('2/L Northeast Square, #47',                   senderX, headerY + 16, 8,   fontR, black);
  txt('Connecticut St. Northeast Greenhills',         senderX, headerY + 21, 8,   fontR, black);
  txt('San Juan City, Metro Manila',                  senderX, headerY + 26, 8,   fontR, black);

  // Meta (right) — fixed label/value columns for consistent alignment
  const metaLabelX = 110; // mm
  const metaLabelW = 40; // mm
  const metaValX   = metaLabelX + metaLabelW + 3;
  const displayDate = new Date(opts.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  const metaRows: [string, string][] = [
    ['INVOICE REF:', opts.invoiceRef || opts.transferNo],
    ['SHIPMENT DATE:', displayDate],
  ];
  if (opts.courier) metaRows.push(['CARRIER:', opts.courier]);
  if (opts.awb)     metaRows.push(['TRACKING NUMBER:', opts.awb]);

  metaRows.forEach(([label, value], i) => {
    const rowYmm = headerY + 5 + i * 5.5;
    txt(label, metaLabelX, rowYmm, 7.5, fontB, black);
    txt(value, metaValX, rowYmm, 7.5, fontR, black);
  });

  // Advance y past header (matches jsPDF logic)
  const senderBottom = headerY + 30;
  const metaBottom   = headerY + 5 + (metaRows.length - 1) * 5.5 + 7;
  let y = Math.max(senderBottom, metaBottom); // mm

  // ── Divider ────────────────────────────────────────────────────────────────
  rule(y);
  y += 5;

  // ── Address blocks ─────────────────────────────────────────────────────────
  y += 3;
  // Ship To
  txt('Ship To', margin, y, 9, fontB);
  txt(opts.destSite, margin + 18, y, 9, fontR);
  if (opts.destAddress?.trim()) {
    y += 5;
    txt(opts.destAddress.trim(), margin + 18, y, 8, fontR, black);
    y += 5;
  }
  y += 9;
  y += 2;

  // ── Divider ────────────────────────────────────────────────────────────────
  rule(y);
  y += 5;

  // ── Table ──────────────────────────────────────────────────────────────────
  // Column widths (mm) matching jsPDF columnStyles: 10, 32, auto, 38, 14
  // Total usable = 210 - 14*2 = 182mm
  const colWidths = [10, 32, 182 - 10 - 32 - 38 - 14, 38, 14]; // [10,32,88,38,14]
  const colX = [margin];
  for (let i = 0; i < colWidths.length - 1; i++) colX.push(colX[i] + colWidths[i]);

  const rowHmm = 8; // ~cellPadding 2.5*2 + fontSize 8pt/2.835 ≈ 7.8mm
  const cellPad = 2.5;

  // Header row
  rect(margin, y, 182, rowHmm, hdrBg);
  const hdrLabels = ['#', 'PART NUMBER', 'DESCRIPTION', 'SERIAL NUMBER', 'BOX #'];
  hdrLabels.forEach((h, i) => {
    txtCenteredInCell(h, colX[i], colWidths[i], y + cellPad + 2.5, 8.5, fontB, white);
  });
  y += rowHmm;

  // Data rows
  const totalQty = opts.items.reduce((s, i) => s + (i.qty || 1), 0);
  let rowNum = 0;
  opts.items.forEach((item) => {
    if (y > 240) return; // guard near bottom
    rowNum++;
    if (rowNum % 2 === 0) rect(margin, y, 182, rowHmm, altBg);
    const partNo = String(item.part_number ?? "").slice(0, 18);
    const partName = String(item.part_name ?? "").slice(0, 28);
    const serial = String(item.serial ?? "").slice(0, 22);
    txtCenteredInCell(String(rowNum), colX[0], colWidths[0], y + cellPad + 2.5, 8, fontR, black);
    txtCenteredInCell(partNo,         colX[1], colWidths[1], y + cellPad + 2.5, 8, fontM, black);
    txtCenteredInCell(partName,       colX[2], colWidths[2], y + cellPad + 2.5, 8, fontR, black);
    txtCenteredInCell(serial,         colX[3], colWidths[3], y + cellPad + 2.5, 8, fontM, black);
    txtCenteredInCell(String(item.qty ?? 1), colX[4], colWidths[4], y + cellPad + 2.5, 8, fontR, black);
    y += rowHmm;
  });

  // ── Footer ─────────────────────────────────────────────────────────────────
  let footerY = y + 5;

  rule(footerY);
  footerY += 5;

  // Remarks + Totals box (remarksBoxH = 16mm)
  const rmkH = 16;
  const totalBoxW = 28;
  const totalLabelX = 210 - margin - totalBoxW * 2;
  const totalValueX = 210 - margin - totalBoxW;

  rect(margin, footerY, 210 - margin * 2, rmkH, undefined, lgray);
  txt('Remarks', margin + 2, footerY + 5, 8, fontB);
  txt(opts.notes || 'SERIAL TRANSFER', margin + 6, footerY + 11, 8, fontR);

  // Total Qty box
  rect(totalLabelX, footerY, totalBoxW, rmkH / 2, fillGray);
  rect(totalValueX, footerY, totalBoxW, rmkH / 2, undefined, lgray);
  txt('TOTAL QTY',    totalLabelX + totalBoxW / 2 - 8, footerY + 4.5, 7.5, fontB);
  txt(String(totalQty), totalValueX + totalBoxW / 2 - 3, footerY + 4.5, 7.5, fontR);

  // Total Boxes box
  rect(totalLabelX, footerY + rmkH / 2, totalBoxW, rmkH / 2, fillGray);
  rect(totalValueX, footerY + rmkH / 2, totalBoxW, rmkH / 2, undefined, lgray);
  txt('TOTAL BOXES',  totalLabelX + totalBoxW / 2 - 10, footerY + rmkH / 2 + 4.5, 7.5, fontB);
  txt(String(opts.boxCount || 1), totalValueX + totalBoxW / 2 - 2, footerY + rmkH / 2 + 4.5, 7.5, fontR);

  y = footerY + rmkH + 6;

  rule(y);
  y += 5;

  // ── Signatures ─────────────────────────────────────────────────────────────
  const sigX = [margin, margin + 62, margin + 124];
  // Two-line layout matching jsPDF
  txt('Prepared and Counted by:', sigX[0], y, 8.5, fontB);
  txt(opts.requestedBy, sigX[0] + 52, y, 8.5, fontR);
  txt('Verified by:', sigX[0] + 96, y, 8.5, fontB);
  txt('____________________', sigX[0] + 96 + 24, y, 8.5, fontR);
  y += 10;
  txt('Receiving Branch Signature:', sigX[0], y, 8.5, fontB);
  txt('____________________', sigX[0] + 50, y, 8.5, fontR);

  return doc.save();
}

// ── SMTP sender ───────────────────────────────────────────────────────────────
async function sendGmailSmtp(opts: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  attachment?: { filename: string; contentType: string; base64: string };
}): Promise<{ ok: boolean; error?: string }> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const credentials = btoa(`\0${GMAIL_USER}\0${GMAIL_APP_PASSWORD}`);

  const altBoundary = `alt_${crypto.randomUUID().replace(/-/g, "")}`;
  const mixBoundary = `mix_${crypto.randomUUID().replace(/-/g, "")}`;

  // multipart/alternative part (text + html)
  const altPart = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.text,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.html,
    "",
    `--${altBoundary}--`,
  ].join("\r\n");

  let rawMessage: string;

  if (opts.attachment) {
    const foldedBase64 = foldBase64Lines(opts.attachment.base64);
    // Wrap in multipart/mixed so we can add the attachment
    rawMessage = [
      `From: ${opts.from} <${GMAIL_USER}>`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
      "",
      `--${mixBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      altPart,
      "",
      `--${mixBoundary}`,
      `Content-Type: ${opts.attachment.contentType}; name="${opts.attachment.filename}"`,
      `Content-Disposition: attachment; filename="${opts.attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      foldedBase64,
      "",
      `--${mixBoundary}--`,
    ].join("\r\n");
  } else {
    rawMessage = [
      `From: ${opts.from} <${GMAIL_USER}>`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      altPart,
    ].join("\r\n");
  }

  let conn: Deno.TlsConn | null = null;
  try {
    conn = await withTimeout(
      Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 }),
      SMTP_CONNECT_TIMEOUT_MS,
      "SMTP connect",
    );
    const read = async (timeoutMs = SMTP_IO_TIMEOUT_MS) =>
      withTimeout((async () => {
        const buf = new Uint8Array(4096);
        const n = await conn!.read(buf);
        if (n === null) throw new Error("SMTP socket closed unexpectedly");
        return decoder.decode(buf.subarray(0, n));
      })(), timeoutMs, "SMTP read");
    const write = async (cmd: string) =>
      withTimeout(conn!.write(encoder.encode(`${cmd}\r\n`)), SMTP_IO_TIMEOUT_MS, "SMTP write");
    const writeRaw = async (payload: string) => {
      const data = encoder.encode(payload);
      const chunkSize = 16 * 1024;
      for (let offset = 0; offset < data.length; offset += chunkSize) {
        const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.length));
        await withTimeout(conn!.write(chunk), SMTP_IO_TIMEOUT_MS, "SMTP write");
      }
    };

    await withTimeout((async () => {
      let r = await read(); if (!r.startsWith("220")) throw new Error(`Greeting: ${r}`);
      await write("EHLO mdc-inventory"); r = await read(); if (!r.includes("250")) throw new Error(`EHLO: ${r}`);
      await write(`AUTH PLAIN ${credentials}`); r = await read(); if (!r.startsWith("235")) throw new Error(`AUTH: ${r}`);
      await write(`MAIL FROM:<${GMAIL_USER}>`); r = await read(); if (!r.startsWith("250")) throw new Error(`MAIL FROM: ${r}`);
      await write(`RCPT TO:<${opts.to}>`); r = await read(); if (!r.startsWith("250")) throw new Error(`RCPT TO: ${r}`);
      await write("DATA"); r = await read(); if (!r.startsWith("354")) throw new Error(`DATA: ${r}`);
      await writeRaw(`${rawMessage}\r\n.\r\n`);
      r = await read(SMTP_DATA_ACK_TIMEOUT_MS); if (!r.startsWith("250")) throw new Error(`Send: ${r}`);
      await write("QUIT");
    })(), SMTP_TOTAL_TIMEOUT_MS, "SMTP session");

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  } finally {
    try { conn?.close(); } catch { /* noop */ }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = corsForRequest(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonResp({ ok: false, reason: "Unauthorized" }, 401, cors);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return jsonResp({ ok: false, reason: "Unauthorized" }, 401, cors);

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!DC_ROLES.includes(profile?.role ?? "")) {
    return jsonResp({ ok: false, reason: "Forbidden — DC staff only" }, 403, cors);
  }

  let transfer_id: string | undefined;
  let include_attachment = true;
  try {
    const body = await req.text();
    if (body) {
      const parsed = JSON.parse(body);
      transfer_id = parsed?.transfer_id;
      if (typeof parsed?.include_attachment === "boolean") {
        include_attachment = parsed.include_attachment;
      }
    }
  } catch {
    return jsonResp({ ok: false, reason: "Invalid JSON" }, 400, cors);
  }
  if (!transfer_id || typeof transfer_id !== "string" || !/^[0-9a-f-]{36}$/.test(transfer_id)) {
    return jsonResp({ ok: false, reason: "Invalid transfer_id" }, 400, cors);
  }

  const [{ data: transfer, error }, { data: brandRow }] = await Promise.all([
    adminClient
      .from("transfers")
      .select(`
        id, transfer_no, invoice_ref, status, created_at, courier, awb,
        source_site:sites!source_site_id(site_name),
        destination_site:sites!destination_site_id(site_name, address, contact_emails),
        requested_by_profile:profiles!requested_by(full_name, username),
        items:transfer_items(
          id, qty, part_id, serial_id,
          part:parts(id, part_number, part_name),
          serial:serial_numbers(id, serial_number, part_id)
        )
      `)
      .eq("id", transfer_id)
      .single(),
    adminClient
      .from("app_config")
      .select("key,value")
      .in("key", ["brand_name", "brand_logo_url"]),
  ]);

  if (error || !transfer) return jsonResp({ ok: false, reason: "Transfer not found" }, 404, cors);

  const configRows = (brandRow ?? []) as { key: string; value: string | null }[];
  const configMap: Record<string, string> = {};
  for (const row of configRows) {
    if (row.value) configMap[row.key] = row.value;
  }
  const brandName: string = configMap.brand_name ?? "MDC Inventory";
  const brandLogoUrl: string | null = configMap.brand_logo_url ?? null;

  const dest = asOne(transfer.destination_site);
  const emails: string[] = (dest?.contact_emails ?? []).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (emails.length === 0) {
    return jsonResp({ ok: false, skipped: true, reason: "No valid contact_emails on destination site", fix: "Edit the destination site in Config > Sites and add contact emails." }, 200, cors);
  }

  const source = asOne(transfer.source_site);
  const requester = asOne(transfer.requested_by_profile);

  const itemRows = (transfer.items ?? []) as any[];
  const normalizedItems = itemRows.map((i) => {
    const part = asOne(i.part);
    const serial = asOne(i.serial);
    return {
      qty: Number(i.qty ?? 1) > 0 ? Number(i.qty) : 1,
      part_id: (i.part_id ?? part?.id ?? null) as string | null,
      part_number: (part?.part_number ?? "—") as string,
      part_name: (part?.part_name ?? "—") as string,
      serial_id: (i.serial_id ?? serial?.id ?? null) as string | null,
      serial_number: (serial?.serial_number ?? null) as string | null,
      serial_part_id: (serial?.part_id ?? null) as string | null,
    };
  });

  // Validate serial rows before any email/token side effects.
  let missingSerialCount = 0;
  let partMismatchCount = 0;
  let duplicateSerialCount = 0;
  const seenSerials = new Set<string>();
  const mismatchSamples: string[] = [];

  for (const item of normalizedItems) {
    if (!item.serial_id) continue;

    const serialNumber = item.serial_number?.trim() ?? "";
    if (!serialNumber) {
      missingSerialCount += 1;
      continue;
    }

    const serialKey = normalizeSerialKey(serialNumber);
    if (seenSerials.has(serialKey)) {
      duplicateSerialCount += 1;
    } else {
      seenSerials.add(serialKey);
    }

    if (!item.part_id || !item.serial_part_id || item.part_id !== item.serial_part_id) {
      partMismatchCount += 1;
      if (mismatchSamples.length < 3) {
        mismatchSamples.push(serialNumber);
      }
    }
  }

  if (missingSerialCount > 0 || partMismatchCount > 0 || duplicateSerialCount > 0) {
    const reasons: string[] = [];
    if (missingSerialCount > 0) reasons.push(`${missingSerialCount} serial reference(s) are missing from inventory`);
    if (partMismatchCount > 0) reasons.push(`${partMismatchCount} serial(s) do not match their transfer part`);
    if (duplicateSerialCount > 0) reasons.push(`${duplicateSerialCount} duplicate serial(s) found in this transfer`);

    const sampleHint = mismatchSamples.length > 0 ? ` Samples: ${mismatchSamples.join(", ")}` : "";
    return jsonResp({
      ok: false,
      reason: `Serial validation failed: ${reasons.join("; ")}.${sampleHint}`,
    }, 409, cors);
  }

  const token = generateToken();
  await adminClient.from("transfers").update({
    receipt_token: token,
    receipt_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).eq("id", transfer_id);

  const receiptLink = new URL(`transfers/${transfer_id}/receive`, `${APP_URL}/`);
  receiptLink.searchParams.set("token", token);
  const receiptUrl = receiptLink.toString();

  const items = normalizedItems.map((item) => ({
    serial: item.serial_number?.trim() || "—",
    part_number: item.part_number,
    part_name: item.part_name,
    qty: item.qty,
  }));

  // ── Email body ────────────────────────────────────────────────────────────

  const sourceName = source?.site_name ?? "DC";
  const destName = dest?.site_name ?? "your site";
  const requesterName = requester?.full_name ?? requester?.username ?? "";

  const itemsText = items.map((i) =>
    `  ${i.serial}  ${i.part_number}  ${i.part_name}  (qty: ${i.qty})`
  ).join("\n");

  const kvRows = [
    ["Invoice #",    transfer.invoice_ref ?? transfer.transfer_no],
    ["From",         sourceName],
    ["To",           destName],
    ["Items",        `${items.length} item(s)`],
    ["Date",         new Date(transfer.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })],
  ];

  // Honor explicit include_attachment request even when transfer is no longer in_transit
  // (e.g., manual resend after status changed).
  const shouldAttachPackingList = include_attachment;

  const kvHtml = kvRows.map(([k, v]) =>
    `<tr>
      <td style="padding:4px 20px 4px 0;color:#888;font-size:14px;white-space:nowrap;vertical-align:top;">${esc(k)}</td>
      <td style="padding:4px 0;color:#111;font-size:14px;font-weight:600;">${esc(v)}</td>
    </tr>`
  ).join("\n");

  const itemsHtml = items.map((i) =>
    `<tr>
      <td style="padding:4px 20px 4px 0;color:#888;font-size:14px;white-space:nowrap;">${esc(i.serial)}</td>
      <td style="padding:4px 20px 4px 0;color:#111;font-size:14px;">${esc(i.part_number)}</td>
      <td style="padding:4px 0;color:#555;font-size:14px;">${esc(i.part_name)}</td>
    </tr>`
  ).join("\n");

  const buildEmailContent = (includePackingListNote: boolean) => {
    const plainText = [
      brandName,
      ``,
      `Transfer Action Required`,
      requesterName ? `Hi ${requesterName}, please confirm receipt of this transfer.` : `Please confirm receipt of this transfer.`,
      ``,
      ...kvRows.map(([k, v]) => `${k}  ${v}`),
      ``,
      itemsText,
      ``,
      ...(includePackingListNote ? [`Packing list attached.`, ``] : []),
      `Confirm receipt here:`,
      receiptUrl,
      ``,
      `You are receiving this because you are a contact for the destination site.`,
    ].join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#fff;font-family:'Inter',Arial,sans-serif;color:#111;">
  <div style="max-width:520px;margin:0 auto;padding:48px 32px;">

    <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#888;letter-spacing:.04em;">${esc(brandName)}</p>
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:600;color:#111;">Transfer Action Required</h1>

    <p style="margin:0 0 28px;font-size:15px;color:#333;line-height:1.6;">
      ${requesterName ? `Hi <strong>${esc(requesterName)}</strong>, please` : "Please"} confirm receipt of this transfer.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">${kvHtml}</table>

    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#888;letter-spacing:.04em;">ITEMS</p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">${itemsHtml}</table>

    ${includePackingListNote ? `<p style="margin:0 0 24px;font-size:14px;color:#555;">Packing list attached as PDF.</p>` : ""}

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:32px;border-collapse:separate;">
      <tr>
        <td align="left">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(receiptUrl)}" style="height:42px;v-text-anchor:middle;width:210px;" arcsize="8%" strokecolor="#111111" fillcolor="#111111">
            <w:anchorlock xmlns:w="urn:schemas-microsoft-com:office:word" />
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;">Confirm Receipt &#8594;</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a
            href="${esc(receiptUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            style="background:#111111;border:1px solid #111111;border-radius:6px;color:#ffffff;display:inline-block;font-size:14px;font-weight:700;letter-spacing:.02em;line-height:42px;text-align:center;text-decoration:none;padding:0 28px;white-space:nowrap;"
          >Confirm Receipt &#8594;</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>

    <p style="margin:0 0 20px;font-size:12px;color:#888;line-height:1.5;">
      If the button does not work, copy and open this link: <a href="${esc(receiptUrl)}" style="color:#111;text-decoration:underline;word-break:break-all;">${esc(receiptUrl)}</a>
    </p>

    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
      You are receiving this because you are a contact for the destination site.
    </p>

  </div>
</body>
</html>`;
    return { plainText, html };
  };

  // ── Packing list attachment ────────────────────────────────────────────────
  let attachment: { filename: string; contentType: string; base64: string } | undefined;
  let pdfError: string | undefined;
  if (shouldAttachPackingList) {
    try {
      const pdfBytes = await withTimeout(
        buildPackingListPDF({
          transferNo: transfer.transfer_no,
          invoiceRef: transfer.invoice_ref ?? transfer.transfer_no,
          createdAt: transfer.created_at,
          sourceSite: source?.site_name ?? "DC",
          destSite: dest?.site_name ?? "—",
          destAddress: dest?.address ?? null,
          requestedBy: requester?.full_name ?? requester?.username ?? "—",
          courier: transfer.courier ?? null,
          awb: transfer.awb ?? null,
          boxCount: 1,
          notes: null,
          logoUrl: brandLogoUrl,
          items,
        }),
        PDF_BUILD_TIMEOUT_MS,
        "Packing list PDF generation",
      );
      // base64 encode the binary PDF
      const b64 = bytesToBase64(pdfBytes);
      attachment = {
        filename: `${transfer.invoice_ref ?? transfer.transfer_no}.pdf`,
        contentType: "application/pdf",
        base64: b64,
      };
    } catch (pdfErr) {
      pdfError = pdfErr instanceof Error ? `${pdfErr.message}${pdfErr.stack ? "\n" + pdfErr.stack.split("\n").slice(0, 4).join("\n") : ""}` : String(pdfErr);
      console.error("[send-transfer-email] PDF generation failed:", pdfError);
    }
  }

  const emailContent = buildEmailContent(Boolean(attachment));

  const sendOpts = {
    to: emails[0],
    from: brandName,
    subject: `${transfer.invoice_ref ?? transfer.transfer_no} dispatched to ${dest?.site_name ?? "your site"}`,
    text: emailContent.plainText,
    html: emailContent.html,
  };

  let result: { ok: boolean; error?: string } = { ok: false, error: "SMTP send was not attempted" };
  let smtpAttachmentError: string | undefined;

  if (attachment) {
    for (let attempt = 1; attempt <= SMTP_ATTACHMENT_RETRY_COUNT; attempt++) {
      result = await sendGmailSmtp({
        ...sendOpts,
        attachment,
      });
      if (result.ok) break;
      smtpAttachmentError = result.error ?? "Unknown SMTP error";
      console.warn(
        `[send-transfer-email] SMTP failed with attachment (attempt ${attempt}/${SMTP_ATTACHMENT_RETRY_COUNT}).`,
        smtpAttachmentError,
      );
      if (attempt < SMTP_ATTACHMENT_RETRY_COUNT) {
        await new Promise((resolve) => setTimeout(resolve, SMTP_RETRY_DELAY_MS * attempt));
      }
    }

    if (!result.ok) {
      console.warn("[send-transfer-email] Retrying without attachment after repeated attachment failures.");
      const fallbackContent = buildEmailContent(false);
      result = await sendGmailSmtp({
        ...sendOpts,
        text: fallbackContent.plainText,
        html: fallbackContent.html,
      });
      attachment = undefined;
    }
  } else {
    result = await sendGmailSmtp(sendOpts);
  }

  if (!result.ok) {
    console.error("[send-transfer-email] SMTP error:", result.error);
    return jsonResp({ ok: false, reason: "SMTP send failed", error: result.error }, 500, cors);
  }

  const packingListAttached = Boolean(attachment);
  console.log(`[send-transfer-email] sent to ${emails[0]} for ${transfer.transfer_no}${packingListAttached ? " (with packing list)" : ""}`);
  return jsonResp({ ok: true, sent_to: emails[0], transfer_no: transfer.transfer_no, packing_list_attached: packingListAttached, pdf_error: pdfError ?? null, smtp_attachment_error: smtpAttachmentError ?? null }, 200, cors);
});
