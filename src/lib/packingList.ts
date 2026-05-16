import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

type PackingListData = {
  transferNo: string;
  invoicePrefix: string | null;
  createdAt: string;
  packedAt: string | null;
  sourceSite: string;
  destinationSite: string;
  destinationAddress: string | null;
  requestedBy: string;
  brandName?: string | null;
  logoUrl?: string | null;
  items: {
    serialNumber: string | null;
    partNumber: string;
    partName: string;
    category: string | null;
    qty: number;
  }[];
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit" });
}

export async function generatePackingListPDF(data: PackingListData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const margin = 48;
  let y = height - margin;

  const black = rgb(0, 0, 0);
  const navy  = rgb(0.07, 0.16, 0.29);
  const gray  = rgb(0.42, 0.42, 0.42);
  const light = rgb(0.94, 0.94, 0.94);
  const white = rgb(1, 1, 1);

  // ── Header bar ──────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: navy });

  const displayName = data.brandName ?? "MDC";

  // Embed logo if provided, otherwise draw text
  if (data.logoUrl) {
    try {
      const res = await fetch(data.logoUrl);
      const buf = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") ?? "";
      const img = contentType.includes("png")
        ? await doc.embedPng(buf)
        : await doc.embedJpg(buf);
      const { width: iw, height: ih } = img.scale(1);
      const scale = Math.min(120 / iw, 40 / ih);
      page.drawImage(img, { x: margin, y: height - 60, width: iw * scale, height: ih * scale });
    } catch {
      page.drawText(displayName, { x: margin, y: height - 44, size: 22, font: bold, color: rgb(0.85, 0.95, 0.17) });
    }
  } else {
    page.drawText(displayName, { x: margin, y: height - 44, size: 22, font: bold, color: rgb(0.85, 0.95, 0.17) });
    page.drawText("Distribution Center", { x: margin, y: height - 60, size: 10, font, color: rgb(0.62, 0.71, 0.73) });
  }

  page.drawText("PACKING LIST", { x: width - margin - 90, y: height - 44, size: 14, font: bold, color: white });

  y = height - 90;

  // ── Document number ─────────────────────────────────────────────────────────
  const docNo = data.invoicePrefix
    ? `${data.invoicePrefix}-${data.transferNo}`
    : data.transferNo;

  page.drawText(docNo, { x: margin, y, size: 16, font: bold, color: navy });
  page.drawText(`Date: ${fmt(data.packedAt ?? data.createdAt)}`, { x: width - margin - 140, y, size: 10, font, color: gray });
  y -= 24;

  // ── From / To ───────────────────────────────────────────────────────────────
  const col2 = width / 2 + 10;

  page.drawText("FROM", { x: margin, y, size: 8, font: bold, color: gray });
  page.drawText("TO", { x: col2, y, size: 8, font: bold, color: gray });
  y -= 14;

  page.drawText(data.sourceSite, { x: margin, y, size: 11, font: bold, color: black });
  page.drawText(data.destinationSite, { x: col2, y, size: 11, font: bold, color: black });
  y -= 14;

  if (data.destinationAddress) {
    // Wrap address at 40 chars
    const words = data.destinationAddress.split(" ");
    let line = "";
    for (const word of words) {
      if ((line + word).length > 40) {
        page.drawText(line.trim(), { x: col2, y, size: 9, font, color: gray });
        y -= 12; line = word + " ";
      } else { line += word + " "; }
    }
    if (line.trim()) { page.drawText(line.trim(), { x: col2, y, size: 9, font, color: gray }); }
  }

  page.drawText(`Prepared by: ${data.requestedBy}`, { x: margin, y: y - 2, size: 9, font, color: gray });
  y -= 28;

  // ── Divider ─────────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: light });
  y -= 16;

  // ── Table header ────────────────────────────────────────────────────────────
  const cols = { serial: margin, part: margin + 130, name: margin + 230, qty: width - margin - 30 };

  page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: 18, color: navy });
  page.drawText("#",             { x: margin + 4,    y: y + 1, size: 8, font: bold, color: white });
  page.drawText("Serial",        { x: cols.serial + 14, y: y + 1, size: 8, font: bold, color: white });
  page.drawText("Part Number",   { x: cols.part,     y: y + 1, size: 8, font: bold, color: white });
  page.drawText("Description",   { x: cols.name,     y: y + 1, size: 8, font: bold, color: white });
  page.drawText("Qty",           { x: cols.qty,      y: y + 1, size: 8, font: bold, color: white });
  y -= 20;

  // ── Table rows ───────────────────────────────────────────────────────────────
  let currentPage = page;
  let currentY = y;

  data.items.forEach((item, i) => {
    // Add new page if needed
    if (currentY < 80) {
      currentPage = doc.addPage([595, 842]);
      currentY = 842 - margin;
      // Repeat header on new page
      currentPage.drawRectangle({ x: margin, y: currentY - 4, width: width - margin * 2, height: 18, color: navy });
      currentPage.drawText("#",           { x: margin + 4,    y: currentY + 1, size: 8, font: bold, color: white });
      currentPage.drawText("Serial",      { x: cols.serial + 14, y: currentY + 1, size: 8, font: bold, color: white });
      currentPage.drawText("Part Number", { x: cols.part,     y: currentY + 1, size: 8, font: bold, color: white });
      currentPage.drawText("Description", { x: cols.name,     y: currentY + 1, size: 8, font: bold, color: white });
      currentPage.drawText("Qty",         { x: cols.qty,      y: currentY + 1, size: 8, font: bold, color: white });
      currentY -= 20;
    }

    const rowBg = i % 2 === 0 ? white : rgb(0.97, 0.97, 0.97);
    currentPage.drawRectangle({ x: margin, y: currentY - 4, width: width - margin * 2, height: 16, color: rowBg });

    const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + "…" : s;

    currentPage.drawText(String(i + 1),                          { x: margin + 4,    y: currentY, size: 8, font, color: gray });
    currentPage.drawText(truncate(item.serialNumber ?? "—", 18), { x: cols.serial + 14, y: currentY, size: 8, font, color: black });
    currentPage.drawText(truncate(item.partNumber, 14),          { x: cols.part,     y: currentY, size: 8, font, color: black });
    currentPage.drawText(truncate(item.partName, 28),            { x: cols.name,     y: currentY, size: 8, font, color: black });
    currentPage.drawText(String(item.qty),                       { x: cols.qty,      y: currentY, size: 8, font, color: black });
    currentY -= 16;
  });

  y = currentY;

  // ── Footer ───────────────────────────────────────────────────────────────────
  y -= 12;
  currentPage.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: light });
  y -= 14;
  currentPage.drawText(`Total items: ${data.items.length}`, { x: margin, y, size: 9, font: bold, color: black });
  currentPage.drawText("Authorized signature: ___________________________", { x: col2 - 20, y, size: 9, font, color: gray });
  y -= 30;
  currentPage.drawText("This document is system-generated. All actions are audited.", { x: margin, y, size: 7, font, color: rgb(0.7, 0.7, 0.7) });

  return doc.save();
}
