export type PackingListData = {
  transferNo: string;
  /** Pre-built invoice ref from DB (e.g. DC-20260517-A001). Falls back to transferNo. */
  invoiceRef: string;
  createdAt: string;
  packedAt: string | null;
  sourceSite: string;
  sourceAddress?: string | null;
  /** When true, hides the From block — DC address is already in the sender header */
  sourceIsDC?: boolean;
  destinationSite: string;
  destinationAddress: string | null;
  requestedBy: string;
  verifiedBy?: string | null;
  notes?: string | null;
  boxCount?: number | null;
  courier?: string | null;
  awb?: string | null;
  items: {
    serialNumber: string | null;
    partNumber: string;
    partName: string;
    qty: number;
  }[];
};

function asString(v: unknown, fallback = ""): string {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function formatPackingDate(iso: string | null): string {
  const text = asString(iso);
  if (!text) return new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  const d = new Date(text);
  return Number.isNaN(d.getTime())
    ? new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })
    : d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
}

function normalizePositiveInt(v: unknown, fallback = 1): number {
  const n = Math.floor(Number(v));
  return n > 0 ? n : fallback;
}

type PdfImageAsset = { dataUrl: string; format: "PNG" | "JPEG" };

async function fetchLogoBase64(): Promise<PdfImageAsset | null> {
  try {
    const url = `${import.meta.env.BASE_URL ?? "/"}packinglistlogo.png`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
    if (typeof document === "undefined") return { dataUrl: rawDataUrl, format: "PNG" };
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("load failed"));
        el.src = rawDataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
      canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return { dataUrl: canvas.toDataURL("image/png"), format: "PNG" };
    } catch {
      return { dataUrl: rawDataUrl, format: "PNG" };
    }
  } catch {
    return null;
  }
}

function buildMetaLines(data: PackingListData): [string, string][] {
  const displayDate = data.packedAt || data.createdAt || new Date().toISOString();
  const lines: [string, string][] = [
    ["INVOICE REF:", asString(data.invoiceRef, "—")],
    ["SHIPMENT DATE:", formatPackingDate(displayDate)],
    ["BOX/S #:", String(normalizePositiveInt(data.boxCount, 1))],
  ];
  if (asString(data.courier)) lines.push(["CARRIER:", asString(data.courier)]);
  if (asString(data.awb)) lines.push(["TRACKING NUMBER:", asString(data.awb)]);
  return lines;
}

function getTotalUnits(data: PackingListData): number {
  return data.items.reduce((sum, item) => {
    const qty = normalizePositiveInt(item.qty, 1);
    return sum + qty;
  }, 0);
}

export async function generatePackingListPDF(data: PackingListData): Promise<any> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const logo = await fetchLogoBase64();

  const totalUnits = getTotalUnits(data);
  const metaLines = buildMetaLines(data);
  const sourceLabel = asString(data.sourceSite, "DC Warehouse");
  const shipToLabel = asString(data.destinationSite, "DC Warehouse");
  let y = 38;

  // ── Title ──────────────────────────────────────────────────────────────────
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Packing List", pageWidth / 2, 14, { align: "center" });

  // ── Logo ───────────────────────────────────────────────────────────────────
  if (logo) {
    try {
      doc.addImage(logo.dataUrl, logo.format, margin, y, 22, 22, undefined, "FAST");
    } catch { /* skip */ }
  }

  // ── Sender block ───────────────────────────────────────────────────────────
  const senderX = margin + 28;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("MOBILECARE SERVICES PHILS. INC.", senderX, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Business and Distribution Center", senderX, y + 11);
  doc.text("2/L Northeast Square, #47", senderX, y + 16);
  doc.text("Connecticut St. Northeast Greenhills", senderX, y + 21);
  doc.text("San Juan City, Metro Manila", senderX, y + 26);

  // ── Meta block (right side) ────────────────────────────────────────────────
  const metaBlockX = pageWidth / 2 + 5;
  const metaLabelW = 38;
  const metaValX = metaBlockX + metaLabelW + 2;
  const metaMaxValW = pageWidth - margin - metaValX - 2;
  doc.setFontSize(7.5);
  metaLines.forEach(([label, value], lineIndex) => {
    const rowY = y + 5 + lineIndex * 5.5;
    doc.setFont("helvetica", "bold");
    doc.text(label, metaBlockX + metaLabelW, rowY, { align: "right" });
    doc.setFont("helvetica", "normal");
    const metaValue = asString(value, "—");
    const wrapped = doc.splitTextToSize(metaValue, metaMaxValW);
    doc.text(wrapped[0] ?? metaValue, metaValX, rowY);
  });

  // ── Advance y past header ──────────────────────────────────────────────────
  const senderBottom = y + 30; // sender text ends at y+26, add 4mm gap before divider
  const metaBottom = y + 5 + (metaLines.length - 1) * 5.5 + 7;
  y = Math.max(senderBottom, metaBottom);

  // ── Divider ────────────────────────────────────────────────────────────────
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // ── Address blocks ─────────────────────────────────────────────────────────
  const renderAddressBlock = (label: string, name: string, address?: string | null) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(name, margin + 18, y);
    if (address?.trim()) {
      doc.setFontSize(8);
      const wrapped = doc.splitTextToSize(address.trim(), pageWidth - margin - (margin + 18) - 5);
      doc.text(wrapped, margin + 18, y + 5);
      y += wrapped.length * 5; // 5mm per line (was 4.5 — too tight)
    }
    y += 9; // gap after each address block
  };

  y += 3;
  if (!data.sourceIsDC) {
    renderAddressBlock("From", sourceLabel, data.sourceAddress);
  }
  renderAddressBlock("Ship To", shipToLabel, data.destinationAddress);
  y += 2; // extra gap before divider

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // ── Table rows ─────────────────────────────────────────────────────────────
  const tableRows: (string | number)[][] = [];
  let rowNum = 0;
  for (const item of data.items) {
    const partNumber = asString(item.partNumber, "Unknown");
    const description = asString(item.partName);
    if (item.serialNumber) {
      rowNum += 1;
      tableRows.push([rowNum, partNumber, description, item.serialNumber, 1]);
    } else {
      for (let i = 0; i < normalizePositiveInt(item.qty, 1); i++) {
        rowNum += 1;
        tableRows.push([rowNum, partNumber, description, "—", 1]);
      }
    }
  }
  if (tableRows.length === 0) {
    tableRows.push([1, "—", "No line items available", "—", 1]);
  }

  autoTable(doc, {
    startY: y,
    head: [["#", "PART NUMBER", "DESCRIPTION", "SERIAL NUMBER", "BOX #"]],
    body: tableRows,
    theme: "grid",
    headStyles: {
      fillColor: [107, 114, 128],
      textColor: 255,
      fontSize: 8.5,
      fontStyle: "bold",
      halign: "center",
      font: "helvetica",
    },
    bodyStyles: {
      fontSize: 8,
      halign: "center",
      cellPadding: 2.5,
      font: "helvetica",
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: margin, right: margin },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 32, font: "courier" },
      2: { cellWidth: "auto", halign: "center" },
      3: { cellWidth: 38, font: "courier" },
      4: { cellWidth: 14 },
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || y + 20;
  let footerY = finalY + 5;

  // ── Divider ────────────────────────────────────────────────────────────────
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY, pageWidth - margin, footerY);
  footerY += 5;

  // ── Remarks + Totals ───────────────────────────────────────────────────────
  const remarksBoxH = 16;
  doc.setDrawColor(220);
  doc.rect(margin, footerY, pageWidth - margin * 2, remarksBoxH);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Remarks", margin + 2, footerY + 5);
  doc.setFont("helvetica", "normal");
  doc.text(asString(data.notes, "SERIAL TRANSFER"), margin + 6, footerY + 11);

  const totalBoxWidth = 28;
  const totalLabelX = pageWidth - margin - totalBoxWidth * 2;
  const totalValueX = pageWidth - margin - totalBoxWidth;

  doc.setFillColor(180, 180, 180);
  doc.rect(totalLabelX, footerY, totalBoxWidth, remarksBoxH / 2, "F");
  doc.rect(totalValueX, footerY, totalBoxWidth, remarksBoxH / 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("TOTAL QTY", totalLabelX + totalBoxWidth / 2, footerY + 4.5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.text(String(totalUnits), totalValueX + totalBoxWidth / 2, footerY + 4.5, { align: "center" });

  doc.setFillColor(180, 180, 180);
  doc.rect(totalLabelX, footerY + remarksBoxH / 2, totalBoxWidth, remarksBoxH / 2, "F");
  doc.rect(totalValueX, footerY + remarksBoxH / 2, totalBoxWidth, remarksBoxH / 2, "S");
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL BOXES", totalLabelX + totalBoxWidth / 2, footerY + remarksBoxH / 2 + 4.5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.text(String(normalizePositiveInt(data.boxCount, 1)), totalValueX + totalBoxWidth / 2, footerY + remarksBoxH / 2 + 4.5, { align: "center" });

  y = footerY + remarksBoxH + 6;

  // ── Divider ────────────────────────────────────────────────────────────────
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // ── Signatures ─────────────────────────────────────────────────────────────
  const half = (pageWidth - margin * 2) / 2;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.text("Prepared and Counted by:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(asString(data.requestedBy, "____________________"), margin + 52, y);
  doc.setFont("helvetica", "bold");
  doc.text("Verified by:", margin + half, y);
  doc.setFont("helvetica", "normal");
  doc.text(asString(data.verifiedBy, "____________________"), margin + half + 24, y);
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.text("Receiving Branch Signature:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text("____________________", margin + 50, y);

  return doc;
}
