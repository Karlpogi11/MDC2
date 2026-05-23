import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeadersForRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const ROW_H = 14;
const FOOTER_RESERVE = 100; // space needed for totals + signatures

function jsonResp(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

type DrawCtx = {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  fontMono: PDFFont;
  y: number;
};

function drawText(ctx: DrawCtx, str: string, x: number, opts: { size?: number; bold?: boolean; mono?: boolean; color?: [number, number, number] } = {}) {
  const f = opts.mono ? ctx.fontMono : opts.bold ? ctx.fontBold : ctx.font;
  ctx.page.drawText(String(str), {
    x, y: ctx.y,
    size: opts.size ?? 9,
    font: f,
    color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0),
  });
}

function drawLine(ctx: DrawCtx) {
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 0.4,
    color: rgb(0.8, 0.8, 0.8),
  });
}

async function newPage(ctx: DrawCtx): Promise<DrawCtx> {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  return { ...ctx, page, y: PAGE_H - MARGIN };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = corsHeadersForRequest(req, { methods: "POST, OPTIONS" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405, cors);

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return jsonResp({ error: "Missing authorization header" }, 401, cors);

  // Verify caller is authenticated
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResp({ error: "Unauthorized" }, 401, cors);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await admin
    .from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_active || !["system_admin", "dc_admin", "dc_operator", "dc_viewer"].includes(profile.role)) {
    return jsonResp({ error: "Forbidden" }, 403, cors);
  }

  let transferId: string;
  try {
    const body = await req.json();
    if (!body?.transfer_id) throw new Error("transfer_id required");
    transferId = body.transfer_id;
  } catch (e) {
    return jsonResp({ error: (e as Error).message }, 400, cors);
  }

  // Fetch with service role — PDF generation needs complete transfer data after role verification.
  const { data: transfer, error: txErr } = await admin
    .from("transfers")
    .select(`
      id, invoice_ref, created_at, packed_at, notes, box_count, courier, awb,
      requested_by:profiles!requested_by(full_name, username),
      source_site:sites!source_site_id(site_name, address),
      destination_site:sites!destination_site_id(site_name, address),
      transfer_items(
        qty,
        part:parts(part_number, part_name),
        serial:serial_numbers(serial_number)
      )
    `)
    .eq("id", transferId)
    .single();

  if (txErr || !transfer) return jsonResp({ error: "Transfer not found" }, 404, cors);

  // ── Build PDF ───────────────────────────────────────────────────────────────
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  let ctx: DrawCtx = { doc, page: doc.addPage([PAGE_W, PAGE_H]), font, fontBold, fontMono, y: PAGE_H - MARGIN };

  const t = transfer as any;
  const invoiceRef: string = t.invoice_ref ?? t.id.slice(0, 8).toUpperCase();
  const srcSite = Array.isArray(t.source_site) ? t.source_site[0] : t.source_site;
  const dstSite = Array.isArray(t.destination_site) ? t.destination_site[0] : t.destination_site;
  const reqBy = Array.isArray(t.requested_by) ? t.requested_by[0] : t.requested_by;
  const items: any[] = t.transfer_items ?? [];

  // Title
  const titleW = fontBold.widthOfTextAtSize("PACKING LIST", 16);
  ctx.page.drawText("PACKING LIST", { x: (PAGE_W - titleW) / 2, y: ctx.y, size: 16, font: fontBold, color: rgb(0, 0, 0) });
  ctx.y -= 22;

  // Invoice ref + date
  const dateStr = new Date(t.packed_at ?? t.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  drawText(ctx, `Invoice Ref: ${invoiceRef}`, MARGIN, { bold: true });
  drawText(ctx, `Date: ${dateStr}`, PAGE_W - MARGIN - 110);
  ctx.y -= 13;

  if (t.courier) { drawText(ctx, `Carrier: ${t.courier}`, MARGIN); ctx.y -= 12; }
  if (t.awb) { drawText(ctx, `Tracking: ${t.awb}`, MARGIN); ctx.y -= 12; }

  drawLine(ctx); ctx.y -= 13;

  // From / Ship To
  drawText(ctx, "FROM:", MARGIN, { bold: true, size: 8 });
  drawText(ctx, srcSite?.site_name ?? "DC Warehouse", MARGIN + 48, { size: 8 });
  ctx.y -= 11;
  if (srcSite?.address) {
    drawText(ctx, srcSite.address, MARGIN + 48, { size: 8, color: [0.4, 0.4, 0.4] });
    ctx.y -= 11;
  }

  drawText(ctx, "SHIP TO:", MARGIN, { bold: true, size: 8 });
  drawText(ctx, dstSite?.site_name ?? "—", MARGIN + 48, { size: 8 });
  ctx.y -= 11;
  if (dstSite?.address) {
    drawText(ctx, dstSite.address, MARGIN + 48, { size: 8, color: [0.4, 0.4, 0.4] });
    ctx.y -= 11;
  }

  ctx.y -= 6;
  drawLine(ctx); ctx.y -= 14;

  // Table header
  const cols = { num: MARGIN, part: MARGIN + 22, desc: MARGIN + 108, serial: MARGIN + 298, qty: PAGE_W - MARGIN - 20 };
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: PAGE_W - MARGIN * 2, height: 16, color: rgb(0.42, 0.45, 0.5) });
  const hdrOpts = { size: 8, bold: true, color: [1, 1, 1] as [number, number, number] };
  drawText(ctx, "#", cols.num + 2, hdrOpts);
  drawText(ctx, "PART NUMBER", cols.part, hdrOpts);
  drawText(ctx, "DESCRIPTION", cols.desc, hdrOpts);
  drawText(ctx, "SERIAL NUMBER", cols.serial, hdrOpts);
  drawText(ctx, "QTY", cols.qty, hdrOpts);
  ctx.y -= ROW_H + 4;

  // Table rows — with proper multi-page support
  let rowNum = 0;
  let totalQty = 0;

  for (const item of items) {
    // New page if not enough room for a row + footer
    if (ctx.y < FOOTER_RESERVE + ROW_H) {
      ctx = await newPage(ctx);
      // Repeat table header on continuation page
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: PAGE_W - MARGIN * 2, height: 16, color: rgb(0.42, 0.45, 0.5) });
      drawText(ctx, "#", cols.num + 2, hdrOpts);
      drawText(ctx, "PART NUMBER", cols.part, hdrOpts);
      drawText(ctx, "DESCRIPTION", cols.desc, hdrOpts);
      drawText(ctx, "SERIAL NUMBER", cols.serial, hdrOpts);
      drawText(ctx, "QTY", cols.qty, hdrOpts);
      ctx.y -= ROW_H + 4;
    }

    const part = Array.isArray(item.part) ? item.part[0] : item.part;
    const serial = Array.isArray(item.serial) ? item.serial[0] : item.serial;
    const qty: number = item.qty ?? 1;
    rowNum++;
    totalQty += qty;

    if (rowNum % 2 === 0) {
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: PAGE_W - MARGIN * 2, height: ROW_H, color: rgb(0.97, 0.98, 0.99) });
    }

    drawText(ctx, String(rowNum), cols.num + 2, { size: 8 });
    drawText(ctx, (part?.part_number ?? "—").slice(0, 18), cols.part, { size: 8, mono: true });
    drawText(ctx, (part?.part_name ?? "—").slice(0, 30), cols.desc, { size: 8 });
    drawText(ctx, (serial?.serial_number ?? "—").slice(0, 22), cols.serial, { size: 8, mono: true });
    drawText(ctx, String(qty), cols.qty, { size: 8 });
    ctx.y -= ROW_H;
  }

  ctx.y -= 8;
  drawLine(ctx); ctx.y -= 13;

  // Totals row
  drawText(ctx, `Total Items: ${rowNum}`, MARGIN, { bold: true });
  drawText(ctx, `Total Qty: ${totalQty}`, MARGIN + 120, { bold: true });
  drawText(ctx, `Total Boxes: ${t.box_count ?? 1}`, MARGIN + 240, { bold: true });
  ctx.y -= 18;

  // Remarks
  if (t.notes) {
    drawText(ctx, "Remarks:", MARGIN, { bold: true, size: 8 });
    drawText(ctx, String(t.notes).slice(0, 80), MARGIN + 58, { size: 8 });
    ctx.y -= 14;
  }

  drawLine(ctx); ctx.y -= 14;

  // Signatures
  const preparedBy = reqBy?.full_name ?? reqBy?.username ?? "____________________";
  drawText(ctx, "Prepared by:", MARGIN, { bold: true, size: 8 });
  drawText(ctx, preparedBy, MARGIN + 68, { size: 8 });
  drawText(ctx, "Received by:", PAGE_W / 2, { bold: true, size: 8 });
  drawText(ctx, "____________________", PAGE_W / 2 + 68, { size: 8 });

  const pdfBytes = await doc.save();

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="packing-list-${invoiceRef}.pdf"`,
      ...cors,
    },
  });
});
