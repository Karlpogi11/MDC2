import { friendlyError } from "@/lib/friendlyError";
import { useTableResize } from "@/components/ResizableColumns";
import { DangerAction } from "@/components/DangerAction";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Package, CheckCircle, Truck, Check, X, Trash2, FileText, ScanLine, BookOpen, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { toCapitalized } from "@/lib/format";
import { useBranding } from "@/lib/useBranding";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ShipmentBookingPanel } from "@/components/ShipmentBookingPanel";
import { PartNumberInput } from "@/components/PartNumberInput";

type TransferStatus = "draft" | "booked" | "packed" | "in_transit" | "received" | "cancelled";

type TransferDetail = {
  id: string;
  transferNo: string;
  invoiceRef: string | null;
  status: TransferStatus;
  createdAt: string;
  packedAt: string | null;
  fixablySeries: string | null;
  courierName: string | null;
  trackingNumber: string | null;
  bookedBy: string | null;
  bookedAt: string | null;
  shippedBy: string | null;
  shippedAt: string | null;
  receiptToken: string | null;
  sourceSite: { siteName: string; invoicePrefix: string | null; address: string | null; isDc: boolean } | null;
  destinationSite: { siteName: string; siteCode: string; address: string | null } | null;
  requestedByProfile: { fullName: string | null; username: string | null } | null;
  packedByProfile: { fullName: string | null; username: string | null } | null;
  bookedByProfile: { fullName: string | null; username: string | null } | null;
  shippedByProfile: { fullName: string | null; username: string | null } | null;
  items: {
    id: string;
    qty: number;
    part: { id: string; partNumber: string; partName: string; category: string | null } | null;
    serial: { serialNumber: string; status: string } | null;
  }[];
};

const STATUS_ORDER: TransferStatus[] = ["draft", "booked", "packed", "in_transit", "received"];

const STATUS_META: Record<TransferStatus, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  draft:      { label: "Draft",      icon: <Package size={16} />,        color: "var(--muted)",    bg: "var(--bg-surface-elevated)" },
  booked:     { label: "Booked",     icon: <BookOpen size={16} />,       color: "var(--blue)",     bg: "var(--bg-surface-elevated)" },
  packed:     { label: "Packed",     icon: <Package size={16} />,        color: "var(--blue)",     bg: "var(--bg-surface-elevated)" },
  in_transit: { label: "In Transit", icon: <Truck size={16} />,          color: "var(--muted)",    bg: "var(--bg-surface-elevated)" },
  received:   { label: "Received",   icon: <CheckCircle size={16} />,    color: "var(--text)",     bg: "var(--bg-surface-elevated)" },
  cancelled:  { label: "Cancelled",  icon: <X size={16} />,              color: "var(--negative)", bg: "var(--bg-surface-elevated)" },
};

const NEXT_STATUS: Partial<Record<TransferStatus, TransferStatus>> = {
  draft:      "booked",
  booked:     "packed",
  packed:     "in_transit",
  in_transit: "received",
};

const NEXT_LABEL: Partial<Record<TransferStatus, string>> = {
  draft:      "Book Courier",
  booked:     "Mark as Packed",
  packed:     "Confirm Dispatch",
  in_transit: "Mark as Received",
};

function canAdvanceStatus(role: string | null, status: TransferStatus): boolean {
  if (!role) return false;
  const next = NEXT_STATUS[status];
  if (!next) return false;
  if (status === "draft") return ["shipping_coordinator", "dc_admin", "system_admin"].includes(role);
  if (status === "booked") return ["dc_operator", "dc_admin", "system_admin"].includes(role);
  if (status === "packed") return ["shipping_coordinator", "dc_admin", "system_admin"].includes(role);
  if (status === "in_transit") return true;
  return false;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function TransferDetailPage() {
  const tableRef = useTableResize();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.profile.id : null;
  const role = authState.status === "authenticated" ? authState.profile.role : null;

  const isOpsRole = ["system_admin", "dc_admin", "dc_operator"].includes(role ?? "");
  const [transfer, setTransfer] = useState<TransferDetail | null>(null);
  const canAdvance = canAdvanceStatus(role, transfer?.status ?? "draft");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const { brandName } = useBranding();
  const orgName = brandName ?? window.location.hostname;

  // Booking panel (shown before Book Courier)
  const [showBookingPanel, setShowBookingPanel] = useState(false);
  const [showReceiptConfirm, setShowReceiptConfirm] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const RESEND_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
  const resendCooldownKey = `mdc_resend_cooldown:${transfer?.id ?? ""}`;
  const [resendCooldownSec, setResendCooldownSec] = useState<number>(() => {
    const ts = parseInt(localStorage.getItem(`mdc_resend_cooldown:${id ?? ""}`) ?? "0", 10);
    return ts ? Math.max(0, Math.ceil((ts - Date.now()) / 1000)) : 0;
  });
  useEffect(() => {
    if (resendCooldownSec <= 0) return;
    const t = setInterval(() => setResendCooldownSec((s) => (s <= 1 ? (clearInterval(t), 0) : s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldownSec > 0]);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  // Partial receipt: track which items are confirmed received
  const [receivedItems, setReceivedItems] = useState<Set<string>>(new Set());

  // Inline serial assignment (draft only)
  const [serialInputs, setSerialInputs] = useState<Record<string, string>>({});
  const [serialSaving, setSerialSaving] = useState<Record<string, boolean>>({});
  const [serialErrors, setSerialErrors] = useState<Record<string, string>>({});

  // Add item to draft transfer
  const [showAddItem, setShowAddItem] = useState(false);
  const [addPartId, setAddPartId] = useState<string | null>(null);
  const [addPartNumber, setAddPartNumber] = useState("");
  const [addSerialInput, setAddSerialInput] = useState("");
  const [addSerialId, setAddSerialId] = useState<string | null>(null);
  const [addSerialError, setAddSerialError] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [addSaving, setAddSaving] = useState(false);

  // Auto-focus next serial input after assignment
  const [focusSerialItemId, setFocusSerialItemId] = useState<string | null>(null);
  const serialInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Confirm remove item
  const [confirmRemoveItemId, setConfirmRemoveItemId] = useState<string | null>(null);

  async function assignSerial(itemId: string, partId: string, value: string) {
    const sn = value.trim().toUpperCase();
    if (!sn) return;
    setSerialSaving(p => ({ ...p, [itemId]: true }));
    setSerialErrors(p => ({ ...p, [itemId]: "" }));

    // Check for duplicate assignment locally in this transfer
    const isDup = (transfer?.items ?? []).some((item: any) => item.id !== itemId && item.serial?.serialNumber?.trim().toUpperCase() === sn.toUpperCase());
    if (isDup) {
      setSerialErrors(p => ({ ...p, [itemId]: "Serial already assigned in this transfer" }));
      setSerialSaving(p => ({ ...p, [itemId]: false }));
      return;
    }

    try {
      const serial = await api.get(`/serials/${encodeURIComponent(sn)}`);
      if (!serial) {
        setSerialErrors(p => ({ ...p, [itemId]: "Serial not found" }));
        setSerialSaving(p => ({ ...p, [itemId]: false }));
        return;
      }
      // Check if serial is already reserved in an active transfer (draft/packed/in_transit)
      if (serial.reservedInActiveTransfer) {
        const statusLabel = serial.activeTransferStatus === "draft" ? "Draft" : 
                           serial.activeTransferStatus === "packed" ? "Packed" : "In Transit";
        setSerialErrors(p => ({ ...p, [itemId]: `Serial already reserved in Transfer ${serial.activeTransferNo} (${statusLabel})` }));
        setSerialSaving(p => ({ ...p, [itemId]: false }));
        return;
      }
      if (serial.status !== "in_stock") {
        setSerialErrors(p => ({ ...p, [itemId]: `Not available — ${serial.status === "in_transit" ? "Reserved for another transfer" : serial.status === "transferred" ? "Already transferred out" : serial.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}` }));
        setSerialSaving(p => ({ ...p, [itemId]: false }));
        return;
      }
      if ((serial.partId ?? serial.part_id) !== partId) {
        setSerialErrors(p => ({ ...p, [itemId]: "Serial belongs to a different part" }));
        setSerialSaving(p => ({ ...p, [itemId]: false }));
        return;
      }

      await api.put(`/transfers/${id}/assign-serial`, { itemId, serialId: serial.id });
      setSerialInputs(p => ({ ...p, [itemId]: "" }));
      await load(true);
      // Focus next empty serial input
      const nextItem = (transfer?.items ?? []).find(i => i.id !== itemId && !i.serial);
      if (nextItem) setFocusSerialItemId(nextItem.id);
    } catch {
      setSerialErrors(p => ({ ...p, [itemId]: "Save failed" }));
    }
    setSerialSaving(p => ({ ...p, [itemId]: false }));
  }

  useEffect(() => {
    if (!focusSerialItemId) return;
    const input = serialInputRefs.current[focusSerialItemId];
    if (input) { input.focus(); setFocusSerialItemId(null); }
  }, [focusSerialItemId]);

  // Pre-pack scan verification
  const [scanMode, setScanMode] = useState(false);
  const [scannedSerials, setScannedSerials] = useState<Set<string>>(new Set());
  const [scanFeedback, setScanFeedback] = useState<{ serial: string; ok: boolean; msg: string } | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  async function generatePDF() {
    if (!transfer) return;
    setGeneratingPDF(true);
    setActionError(null);
    try {
      const { generatePackingListPDF } = await import("@/lib/packingList");
      const doc = await generatePackingListPDF({
        transferNo: transfer.transferNo,
        invoiceRef: transfer.invoiceRef ?? transfer.transferNo,
        createdAt: transfer.createdAt,
        packedAt: transfer.packedAt,
        sourceSite: transfer.sourceSite?.siteName ?? "DC",
        sourceAddress: transfer.sourceSite?.address ?? null,
        sourceIsDC: transfer.sourceSite?.isDc ?? true,
        destinationSite: transfer.destinationSite?.siteName ?? "—",
        destinationAddress: transfer.destinationSite?.address ?? null,
        requestedBy: transfer.requestedByProfile?.fullName ?? transfer.requestedByProfile?.username ?? "—",
        fixablySeries: transfer.fixablySeries ?? null,
        courierName: transfer.courierName ?? null,
        trackingNumber: transfer.trackingNumber ?? null,
        items: transfer.items.map((item) => ({
          serialNumber: item.serial?.serialNumber ?? null,
          partNumber: item.part?.partNumber ?? "—",
          partName: item.part?.partName ?? "—",
          qty: item.qty,
        })),
      });

      const pdfBlob = doc.output("blob") as Blob;
      await api.post(`/transfers/${transfer.id}/generate-pdf`, { pdfBlob, fileName: `${transfer.transferNo}.pdf` });

      doc.save(`${transfer.transferNo}-packing-list.pdf`);
    } catch (err) {
      setActionError(err instanceof Error ? friendlyError(err) : "PDF generation failed.");
    }
    setGeneratingPDF(false);
  }

  async function load(silent = false) {
    if (!id) return;
    if (!silent) setLoading(true);

    try {
      const d = await api.get(`/transfers/${id}`);
      if (!d) { setLoadError("Transfer not found."); setLoading(false); return; }

      setTransfer({
        ...d,
        sourceSite: Array.isArray(d.sourceSite) ? d.sourceSite[0] ?? null : d.sourceSite,
        destinationSite: Array.isArray(d.destinationSite) ? d.destinationSite[0] ?? null : d.destinationSite,
        requestedByProfile: Array.isArray(d.requestedByProfile) ? d.requestedByProfile[0] ?? null : d.requestedByProfile,
        packedByProfile: Array.isArray(d.packedByProfile) ? d.packedByProfile[0] ?? null : d.packedByProfile,
        bookedByProfile: Array.isArray(d.bookedByProfile) ? d.bookedByProfile[0] ?? null : d.bookedByProfile,
        shippedByProfile: Array.isArray(d.shippedByProfile) ? d.shippedByProfile[0] ?? null : d.shippedByProfile,
        items: (d.items ?? []).map((item: any) => ({
          ...item,
          part: Array.isArray(item.part) ? item.part[0] ?? null : item.part,
          serial: Array.isArray(item.serial) ? item.serial[0] ?? null : item.serial,
        })),
      });
    } catch {
      setLoadError("Transfer not found.");
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [id]);

  // Poll for updates
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => void load(true), 30000);
    return () => clearInterval(interval);
  }, [id]);


  useEffect(() => {
    if (!showActionMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && actionMenuRef.current && !actionMenuRef.current.contains(target)) {
        setShowActionMenu(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showActionMenu]);

  async function invokeTransferEmail(
    transferId: string,
    options?: { attempts?: number; includeAttachment?: boolean; allowAttachmentFallback?: boolean; pdfBase64?: string | null; forceSend?: boolean },
  ): Promise<{ ok: boolean; detail?: string; packingListAttached?: boolean; pdfError?: string | null; smtpAttachmentError?: string | null }> {
    const attempts = Math.max(1, options?.attempts ?? 1);
    let detail = "Unknown error";

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const emailResult = await api.post(`/transfers/${transferId}/send-email`, {
          include_attachment: options?.includeAttachment ?? true,
          ...(options?.pdfBase64 ? { pdf_base64: options.pdfBase64 } : {}),
          ...(options?.forceSend ? { force_send: true } : {}),
        });

        if (!emailResult || (emailResult as any).ok === false) {
          detail = (emailResult as any)?.reason ?? (emailResult as any)?.error ?? "Unknown error";
        } else {
          return { ok: true, packingListAttached: (emailResult as any)?.packing_list_attached ?? false, pdfError: (emailResult as any)?.pdf_error ?? null, smtpAttachmentError: (emailResult as any)?.smtp_attachment_error ?? null };
        }
      } catch (err) {
        detail = err instanceof Error ? friendlyError(err) : String(err);
      }

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    return { ok: false, detail };
  }

  async function generateAndUploadPDF(): Promise<string | null> {
    if (!transfer || !actorId) return null;
    try {
      const { generatePackingListPDF } = await import("@/lib/packingList");
      const doc = await generatePackingListPDF({
        transferNo: transfer.transferNo,
        invoiceRef: transfer.invoiceRef ?? transfer.transferNo,
        createdAt: transfer.createdAt,
        packedAt: transfer.packedAt,
        sourceSite: transfer.sourceSite?.siteName ?? "DC",
        sourceAddress: transfer.sourceSite?.address ?? null,
        sourceIsDC: transfer.sourceSite?.isDc ?? true,
        destinationSite: transfer.destinationSite?.siteName ?? "—",
        destinationAddress: transfer.destinationSite?.address ?? null,
        requestedBy: transfer.requestedByProfile?.fullName ?? transfer.requestedByProfile?.username ?? "—",
        fixablySeries: transfer.fixablySeries ?? null,
        courierName: transfer.courierName ?? null,
        trackingNumber: transfer.trackingNumber ?? null,
        items: transfer.items.map((item) => ({
          serialNumber: item.serial?.serialNumber ?? null,
          partNumber: item.part?.partNumber ?? "—",
          partName: item.part?.partName ?? "—",
          qty: item.qty,
        })),
      });
      const pdfBlob = doc.output("blob") as Blob;
      const fileName = `${transfer.transferNo}.pdf`;
      // Upload to storage via API and return base64
      await api.post(`/transfers/${transfer.id}/generate-pdf`, { pdfBlob, fileName, actorId });
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch (e) {
      console.warn("generateAndUploadPDF failed:", e);
      return null;
    }
  }

  async function resendTransferEmail(transferId: string) {
    setShowActionMenu(false);
    setSendingEmail(true);
    const pdfBase64 = await generateAndUploadPDF();
    setActionError(null);
    setActionNotice(null);
    const result = await invokeTransferEmail(transferId, { attempts: 1, includeAttachment: true, allowAttachmentFallback: false, pdfBase64, forceSend: true });
    if (!result.ok) {
      const isMissingEmail = (result.detail ?? "").includes("contact_emails") || (result.detail ?? "").includes("No valid");
      setActionError(
        isMissingEmail
          ? "No email sent — destination site has no contact email. Add one in Config → Sites."
          : `Resend failed: ${result.detail ?? "Unknown error"}`
      );
    } else {
      const detail = result.smtpAttachmentError ?? result.pdfError;
      setActionNotice(
        result.packingListAttached
          ? "Email resent with packing list."
          : `Email resent — packing list could not be attached.${detail ? " Error: " + detail : ""}`
      );
      const cooldownUntil = Date.now() + RESEND_COOLDOWN_MS;
      localStorage.setItem(resendCooldownKey, String(cooldownUntil));
      setResendCooldownSec(Math.ceil(RESEND_COOLDOWN_MS / 1000));
    }
    setSendingEmail(false);
  }

  function handleScan(value: string) {
    if (!transfer) return;
    const serial = value.trim().toUpperCase();
    const match = transfer.items.find(i => i.serial?.serialNumber?.toUpperCase() === serial);
    if (match) {
      setScannedSerials(prev => new Set([...prev, serial]));
      setScanFeedback({ serial, ok: true, msg: `✓ ${serial} — on this transfer` });
    } else {
      setScanFeedback({ serial, ok: false, msg: `✗ ${serial} — NOT on this transfer` });
    }
    setShowScanner(false);
    setTimeout(() => setScanFeedback(null), 4000);
  }

  async function advanceStatus() {
    if (!transfer || !actorId) return;
    const next = NEXT_STATUS[transfer.status];
    if (!next) return;
    setAdvancing(true); setActionError(null);

    try {
      if (transfer.status === "draft" && next === "booked") {
        await api.post(`/shipments/${transfer.id}/book`, {
          courierName: transfer.courierName,
          trackingNumber: transfer.trackingNumber,
          fixablySeries: transfer.fixablySeries,
        });
      } else if (transfer.status === "packed" && next === "in_transit") {
        const res = await api.post(`/shipments/${transfer.id}/dispatch`, {});
        if ((res as any)?.emailSent === false) {
          setActionNotice("Transfer dispatched. No email sent — destination site may have no contact email.");
        }
      } else {
        await api.put(`/transfers/${transfer.id}/status`, {
          status: next,
          actorId,
        });
      }
    } catch (err) {
      setActionError(friendlyError(err instanceof Error ? err : new Error(String(err))));
      setAdvancing(false);
      return;
    }

    await load(true);
    setAdvancing(false);
  }

  async function cancelTransfer() {
    if (!transfer) return;
    setCancelling(true); setActionError(null);
    try {
      await api.put(`/transfers/${transfer.id}/status`, { status: "cancelled", actorId });
      await load(true);
    } catch (err) {
      setActionError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
    setCancelling(false);
  }

  async function addItem() {
    if (!transfer) return;
    if (!addPartId && !addSerialId) return;
    setAddSaving(true);
    setActionError(null);
    try {
      const items = [{ partId: addPartId!, serialId: addSerialId ?? undefined, qty: addQty }];
      await api.post(`/transfers/${transfer.id}/items`, { items });
      setShowAddItem(false);
      setAddPartId(null);
      setAddPartNumber("");
      setAddSerialInput("");
      setAddSerialId(null);
      setAddQty(1);
      await load(true);
    } catch (err) {
      setActionError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
    setAddSaving(false);
  }

  async function deleteItem(itemId: string) {
    if (!transfer) return;
    setActionError(null);
    try {
      await api.delete(`/transfers/${transfer.id}/items/${itemId}`);
      await load(true);
    } catch (err) {
      setActionError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
  }

  if (loading) return (
    <AppLayout>
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading…</div>
    </AppLayout>
  );

  if (loadError || !transfer) return (
    <AppLayout>
      <div style={{ padding: 40, textAlign: "center", color: "var(--negative)" }}>{loadError ?? "Transfer not found."}</div>
    </AppLayout>
  );

  const meta = STATUS_META[transfer.status];
  const nextStatus = NEXT_STATUS[transfer.status];
  const currentStep = STATUS_ORDER.indexOf(transfer.status);

  return (
    <AppLayout>
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        {/* Header + actions in one row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: "monospace" }}>
                {transfer.transferNo}
              </h1>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: meta.bg, color: meta.color }}>
                {meta.icon} {meta.label}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              <span>From <strong style={{ color: "var(--text)" }}>{transfer.sourceSite?.siteName ?? "DC"}</strong></span>
              <span style={{ margin: "0 6px" }}>·</span>
              <span>To <strong style={{ color: "var(--text)" }}>{transfer.destinationSite?.siteName ?? "—"}</strong></span>
              {transfer.destinationSite?.address && <span style={{ marginLeft: 8 }}>· {transfer.destinationSite.address}</span>}
            </p>
          </div>

          {canAdvance && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {/* Secondary */}
              {(transfer.status === "draft" || transfer.status === "booked" || transfer.status === "packed") && (
                <DangerAction label="Cancel transfer" confirmLabel="Yes, cancel"
                  description={transfer.courierName && transfer.trackingNumber
                    ? `This transfer has a ${transfer.courierName} booking with tracking ${transfer.trackingNumber}. Are you sure you want to cancel?`
                    : "This cannot be undone."}
                  onConfirm={() => void cancelTransfer()} busy={cancelling} />
              )}
              {(transfer.status === "draft" || transfer.status === "booked") && (
                <button type="button" onClick={() => setScanMode(v => !v)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <ScanLine size={14} /> {scanMode ? "Exit Scan Mode" : "Verify Serials"}
                </button>
              )}
              {["packed", "received"].includes(transfer.status) && (
                <button type="button" onClick={() => void generatePDF()} disabled={generatingPDF}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: generatingPDF ? "not-allowed" : "pointer", opacity: generatingPDF ? 0.7 : 1 }}>
                  <FileText size={14} /> {generatingPDF ? "Generating…" : "Packing List PDF"}
                </button>
              )}
              {transfer.status === "in_transit" && (
                <div ref={actionMenuRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setShowActionMenu((v) => !v)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    aria-haspopup="menu"
                    aria-expanded={showActionMenu}
                  >
                    More
                  </button>
                  {showActionMenu && (
                    <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", minWidth: 180, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", boxShadow: "0 6px 16px rgba(0,0,0,0.12)", padding: 6, zIndex: 30 }}>
                      <button type="button" onClick={() => { setShowActionMenu(false); void generatePDF(); }} disabled={generatingPDF}
                        style={{ width: "100%", textAlign: "left", background: "var(--bg-surface)", border: "none", padding: "5px 8px", fontSize: 13, color: "var(--text)", cursor: generatingPDF ? "not-allowed" : "pointer", opacity: generatingPDF ? 0.6 : 1 }}>
                        {generatingPDF ? "Generating PDF…" : "Packing List PDF"}
                      </button>
                      <button type="button" onClick={() => void resendTransferEmail(transfer.id)} disabled={sendingEmail || resendCooldownSec > 0}
                        style={{ width: "100%", textAlign: "left", background: "var(--bg-surface)", border: "none", padding: "5px 8px", fontSize: 13, color: (sendingEmail || resendCooldownSec > 0) ? "var(--muted)" : "var(--text)", cursor: (sendingEmail || resendCooldownSec > 0) ? "not-allowed" : "pointer" }}>
                        {sendingEmail ? "Sending…" : resendCooldownSec > 0 ? `Resend Email (${Math.floor(resendCooldownSec / 60)}:${String(resendCooldownSec % 60).padStart(2, "0")})` : "Resend Email"}
                      </button>
                      <a href={`/transfers/${transfer.id}/receive`} target="_blank" rel="noopener noreferrer" onClick={() => setShowActionMenu(false)}
                        style={{ display: "block", textAlign: "left", padding: "5px 8px", fontSize: 13, color: "var(--text)", textDecoration: "none" }}>
                        Open Receive Page
                      </a>
                    </div>
                  )}
                </div>
              )}
              {/* Primary */}
              {nextStatus && nextStatus !== "received" && (
                <button type="button"
                  onClick={() => {
                    if (NEXT_STATUS[transfer.status] === "booked") {
                      setShowBookingPanel(true);
                    } else if (NEXT_STATUS[transfer.status] === "packed") {
                      if (transfer.items.length === 0) {
                        setActionError("Cannot pack: transfer has no items."); return;
                      }
                      const missing = transfer.items.filter(i => !i.serial);
                      if (missing.length > 0) {
                        const errs: Record<string, string> = {};
                        missing.forEach(i => { errs[i.id] = "Serial required before packing"; });
                        setSerialErrors(p => ({ ...p, ...errs }));
                        setActionError(`${missing.length} item${missing.length > 1 ? "s are" : " is"} missing a serial — assign all serials before packing.`);
                        return;
                      }
                      void advanceStatus();
                    } else {
                      void advanceStatus();
                    }
                  }}
                  disabled={advancing}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: advancing ? "not-allowed" : "pointer", opacity: advancing ? 0.7 : 1 }}>
                  <ArrowRight size={14} /> {advancing ? "Updating…" : NEXT_LABEL[transfer.status]}
                </button>
              )}
              {transfer.status === "in_transit" && (
                <button type="button"
                  onClick={() => { if (receivedItems.size === 0) { setActionError("Check at least one item as received."); return; } setShowReceiptConfirm(true); }}
                  disabled={advancing || receivedItems.size === 0}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: receivedItems.size > 0 ? "var(--blue)" : "var(--bg-surface-elevated)", color: receivedItems.size > 0 ? "#fff" : "var(--muted)", border: "none", borderRadius: "var(--radius)", padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: receivedItems.size > 0 ? "pointer" : "not-allowed" }}>
                  Confirm receipt ({receivedItems.size}/{transfer.items.length})
                </button>
              )}
            </div>
          )}
        </div>
        {/* Edit booking button for coordinator on booked transfers */}
        {!canAdvance && role === "shipping_coordinator" && transfer.status === "booked" && (
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setShowBookingPanel(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Edit Booking
            </button>
          </div>
        )}
        {actionError && (
          <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>
            {actionError}
          </div>
        )}
        {actionNotice && (
          <div role="status" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--text)", fontSize: 13 }}>
            {actionNotice}
          </div>
        )}
        {canAdvance && transfer.status === "in_transit" && !transfer.receiptToken && (
          <div role="status" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--muted)", fontSize: 13 }}>
            This transfer does not have a receipt email token yet. Use More → Resend Email when you're ready.
          </div>
        )}

        {/* Status timeline */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {STATUS_ORDER.map((s, i) => {
              const done = i <= currentStep && transfer.status !== "cancelled";
              const active = i === currentStep && transfer.status !== "cancelled";
              const sm = STATUS_META[s];
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STATUS_ORDER.length - 1 ? 1 : undefined }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div className="circle" style={{
                      width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                      background: done ? (active ? "var(--blue)" : "var(--bg-surface-elevated)") : "var(--bg-surface-elevated)",
                      color: done ? (active ? "#fff" : "var(--text)") : "var(--muted)",
                      border: active ? "2px solid var(--blue)" : "2px solid var(--line)",
                    }}>
                      {done && !active ? <Check size={14} /> : sm.icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? "var(--blue)" : done ? "var(--text)" : "var(--muted)", whiteSpace: "nowrap" }}>
                      {sm.label}
                    </span>
                  </div>
                  {i < STATUS_ORDER.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: i < currentStep && transfer.status !== "cancelled" ? "var(--blue)" : "var(--line)", margin: "0 4px", marginBottom: 20 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Pre-pack scan verification panel */}
        {scanMode && (transfer.status === "draft" || transfer.status === "booked") && (
          <div style={{ background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 18px", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ScanLine size={16} color="var(--blue)" />
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                  Scan Verification — {scannedSerials.size}/{transfer.items.filter(i => i.serial).length} verified
                </span>
              </div>
              <button type="button" onClick={() => setShowScanner(true)}
                style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Scan Serial
              </button>
            </div>

            {scanFeedback && (
              <div style={{ marginBottom: 10, padding: "5px 8px", borderRadius: "var(--radius)", background: "var(--bg-surface)", border: `1px solid ${scanFeedback.ok ? "var(--line)" : "var(--negative)"}`, color: scanFeedback.ok ? "var(--text)" : "var(--negative)", fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>
                {scanFeedback.msg}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {transfer.items.filter(i => i.serial).map(item => {
                const sn = item.serial!.serialNumber.toUpperCase();
                const verified = scannedSerials.has(sn);
                return (
                  <span key={item.id} style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 600, padding: "3px 8px", borderRadius: "var(--radius-sm)", background: "var(--bg-surface)", color: verified ? "var(--link)" : "var(--text)", border: `1px solid ${verified ? "var(--blue)" : "var(--line)"}` }}>
                    {verified ? "✓ " : ""}{item.serial!.serialNumber}
                  </span>
                );
              })}
            </div>

            {scannedSerials.size > 0 && scannedSerials.size === transfer.items.filter(i => i.serial).length && (
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                ✓ All serials verified — safe to mark as packed.
              </div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
          {/* Items table */}
          <div className="table-card">
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>
                Items <span style={{ fontWeight: 400, color: "#888" }}>({transfer.items.length})</span>
              </span>
              {transfer.status === "draft" && isOpsRole && (
                <button type="button" onClick={() => { setShowAddItem(true); setAddSerialError(""); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "3px 8px", fontSize: 11, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                  <Plus size={12} /> Add Item
                </button>
              )}
            </div>
            <div className="table-scroll">
              <table ref={tableRef}>
                <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface)" }}>
                  <tr>
                    {transfer.status === "in_transit" && <th style={{ width: 40 }}></th>}
                    <th>Serial</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="num">Qty</th>
                    {transfer.status === "draft" && <th style={{ width: 40, padding: 0 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {transfer.items.length === 0 && (
                    <tr><td colSpan={transfer.status === "in_transit" ? 5 : (transfer.status === "draft" && isOpsRole ? 5 : 4)} className="empty-row">No items.</td></tr>
                  )}
                  {transfer.items.map((item) => (
                    <tr key={item.id} style={{ background: receivedItems.has(item.id) ? "#f0fdf4" : undefined }}>
                      {transfer.status === "in_transit" && (
                        <td style={{ padding: "5px 8px" }}>
                          <input type="checkbox" checked={receivedItems.has(item.id)}
                            onChange={() => setReceivedItems((prev) => {
                              const next = new Set(prev);
                              next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                              return next;
                            })}
                            style={{ width: 16, height: 16, cursor: "pointer" }}
                          />
                        </td>
                      )}
                      <td style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.serial?.serialNumber
                          ? item.serial.serialNumber
                          : (transfer.status === "draft" || transfer.status === "booked") && item.part
                            ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                  <input
                                    ref={el => { serialInputRefs.current[item.id] = el; }}
                                    value={serialInputs[item.id] ?? ""}
                                    onChange={e => setSerialInputs(p => ({ ...p, [item.id]: e.target.value.toUpperCase() }))}
                                    onKeyDown={e => {
                                      if (e.key === "Enter" || e.key === "Tab") {
                                        e.preventDefault();
                                        void assignSerial(item.id, item.part!.id, serialInputs[item.id] ?? "");
                                      }
                                    }}
                                    onBlur={e => { if (e.target.value.trim()) void assignSerial(item.id, item.part!.id, e.target.value); }}
                                    placeholder="Enter serial number"
                                    disabled={serialSaving[item.id]}
                                    spellCheck={false}
                                    style={{ width: 140, border: `1px solid ${serialErrors[item.id] ? "#fca5a5" : "#d1d5db"}`, borderRadius: "var(--radius-sm)", padding: "3px 6px", fontSize: 12, fontFamily: "monospace", outline: "none", background: serialSaving[item.id] ? "#f9fafb" : "#fff" }}
                                  />
                                  {serialSaving[item.id] && <span style={{ fontSize: 11, color: "var(--muted)" }}>…</span>}
                                </div>
                                {serialErrors[item.id] && <span style={{ fontSize: 11, color: "var(--negative)" }}>{serialErrors[item.id]}</span>}
                              </div>
                            )
                          : item.part?.partNumber ?? "—"}
                      </td>
                      <td title={item.part?.partName ?? ""} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        <div>{item.part?.partName ?? "—"}</div>
                        {item.part?.partNumber && <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted)" }}>{item.part.partNumber}</div>}
                      </td>
                      <td className="capitalize" style={{ overflow: "hidden", textOverflow: "ellipsis", color: "var(--muted)" }}>
                        {toCapitalized(item.part?.category) || "—"}
                      </td>
                      <td className="num">{item.qty}</td>
                      {transfer.status === "draft" && isOpsRole && (
                        <td style={{ padding: "4px 8px", textAlign: "center", width: 40 }}>
                          <button type="button" onClick={() => setConfirmRemoveItemId(item.id)}
                            title="Remove item"
                            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 4, borderRadius: "var(--radius-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--negative)"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--muted)"; }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Info panel */}
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <InfoCard title="Transfer info">
              <InfoRow label="Transfer #" value={transfer.transferNo} mono />
              <InfoRow label="Created" value={formatDate(transfer.createdAt)} />
              {transfer.packedAt && <InfoRow label="Packed" value={formatDate(transfer.packedAt)} />}
              <InfoRow label="Requested by" value={transfer.requestedByProfile?.fullName ?? transfer.requestedByProfile?.username ?? "—"} />
              {transfer.packedByProfile && <InfoRow label="Packed by" value={transfer.packedByProfile.fullName ?? transfer.packedByProfile.username ?? "—"} />}
              {transfer.invoiceRef && (
                <InfoRow label="Invoice ref" value={transfer.invoiceRef} mono />
              )}
              {transfer.sourceSite?.invoicePrefix && !transfer.invoiceRef && (
                <InfoRow label="Invoice prefix" value={transfer.sourceSite.invoicePrefix} mono />
              )}
              {transfer.fixablySeries && <InfoRow label="Fixably series" value={transfer.fixablySeries} />}
              {transfer.courierName && <InfoRow label="Courier" value={transfer.courierName} />}
              {transfer.trackingNumber && <InfoRow label="Tracking no." value={transfer.trackingNumber} mono />}
              {transfer.bookedAt && <InfoRow label="Booked" value={formatDate(transfer.bookedAt)} />}
              {transfer.bookedByProfile?.fullName && <InfoRow label="Booked by" value={transfer.bookedByProfile.fullName} />}
            </InfoCard>

            <InfoCard title="Destination">
              <InfoRow label="Site" value={transfer.destinationSite?.siteName ?? "—"} />
              <InfoRow label="Code" value={transfer.destinationSite?.siteCode ?? "—"} mono />
              {transfer.destinationSite?.address && (
                <InfoRow label="Address" value={transfer.destinationSite.address} />
              )}
            </InfoCard>
          </div>
        </div>
      </main>

      {/* Booking panel */}
      {showBookingPanel && transfer && (
        <ShipmentBookingPanel
          transfer={transfer}
          onClose={() => setShowBookingPanel(false)}
          onBooked={() => { setShowBookingPanel(false); void load(true); }}
        />
      )}

      {showReceiptConfirm && transfer && (
        <>
          <div onClick={() => setShowReceiptConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100 }} />
          <div role="dialog" aria-modal="true" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "var(--bg-surface)", borderRadius: 0, padding: 28, width: 400, zIndex: 101, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{orgName}</p>
            <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Confirm Receipt</h2>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)" }}>
              Confirming receipt of <strong>{receivedItems.size}</strong> of <strong>{transfer.items.length}</strong> item{transfer.items.length !== 1 ? "s" : ""} from <strong>{transfer.sourceSite?.siteName ?? "DC"}</strong>. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button"
                onClick={() => { setShowReceiptConfirm(false); void (async () => {
                  setAdvancing(true); setActionError(null);
                  try {
                    await api.put(`/transfers/${transfer.id}/status`, { status: "received", actorId });
                    await load(true);
                  } catch (err) {
                    setActionError(friendlyError(err instanceof Error ? err : new Error(String(err))));
                  }
                  setAdvancing(false);
                })(); }}
                style={{ flex: 1, background: "var(--blue)", color: "#fff", border: "none", borderRadius: 0, padding: "5px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Confirm
              </button>
              <button type="button" onClick={() => setShowReceiptConfirm(false)}
                style={{ flex: 1, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: 0, padding: "5px 0", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
      {showScanner && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {showAddItem && (
        <>
          <div onClick={() => { setShowAddItem(false); setAddSerialError(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 100 }} />
          <div role="dialog" aria-modal="true" style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--bg-surface)", borderRadius: "var(--radius)",
            padding: 24, width: 380, zIndex: 101,
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Add Item</h2>

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Serial</label>
            <input value={addSerialInput}
              onChange={e => {
                const val = e.target.value.toUpperCase();
                setAddSerialInput(val);
                setAddSerialError("");
                if (debounceRef.current) clearTimeout(debounceRef.current);
                if (val.trim().length >= 2) {
                  setAddSerialId(null);
                  setAddPartId(null);
                  setAddPartNumber("");
                  debounceRef.current = setTimeout(async () => {
                    try {
                      const serial = await api.get(`/serials/${encodeURIComponent(val.trim())}`);
                      if (!serial?.id) {
                        setAddSerialError("Serial number not found in inventory");
                      } else if (serial.reservedInActiveTransfer) {
                        const label = serial.activeTransferStatus === "draft" ? "Draft" : serial.activeTransferStatus === "packed" ? "Packed" : "In Transit";
                        setAddSerialError(`Already reserved on Transfer ${serial.activeTransferNo} (${label})`);
                      } else if (serial.status !== "in_stock") {
                        setAddSerialError(`Not available — ${serial.status === "in_transit" ? "Reserved for another transfer" : serial.status === "transferred" ? "Already transferred out" : serial.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}`);
                      } else {
                        setAddPartNumber(serial.part?.partNumber ?? serial.partNumber ?? "");
                        setAddPartId(serial.part_id ?? serial.partId ?? null);
                        setAddSerialId(serial.id);
                        setAddQty(1);
                      }
                    } catch { setAddSerialError("Serial lookup failed"); }
                  }, 300);
                } else {
                  setAddSerialId(null);
                  setAddPartId(null);
                  setAddPartNumber("");
                }
              }}
              placeholder="Scan or type serial number"
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "7px 10px", fontSize: 13, fontFamily: "monospace", color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
            />
            {addSerialError && <div style={{ fontSize: 11, color: "var(--negative)", marginTop: 4 }}>{addSerialError}</div>}

            {role !== "dc_operator" && (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginTop: 14, marginBottom: 4 }}>Part</label>
                {addSerialId && addPartNumber ? (
                  <div style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "7px 10px", fontSize: 13, fontFamily: "monospace", color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}>
                    {addPartNumber}
                  </div>
                ) : (
                  <PartNumberInput
                    value={addPartNumber}
                    onChange={(pn, part) => { setAddPartNumber(pn); setAddPartId(part?.id ?? null); }}
                    style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
                  />
                )}
              </>
            )}

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginTop: 14, marginBottom: 4 }}>Qty</label>
            <input type="number" min={1} value={addQty}
              onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ width: 80, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
            />

            <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
              <button type="button" onClick={() => { setShowAddItem(false); setAddSerialError(""); }}
                style={{ flex: 1, border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "7px 0", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={() => void addItem()} disabled={(!addPartId && !addSerialId) || addSaving}
                style={{ flex: 1, background: (addPartId || addSerialId) && !addSaving ? "var(--blue)" : "var(--bg-surface)", color: (addPartId || addSerialId) && !addSaving ? "#fff" : "var(--muted)", border: (addPartId || addSerialId) && !addSaving ? "none" : "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 0", fontSize: 13, fontWeight: 600, cursor: (addPartId || addSerialId) && !addSaving ? "pointer" : "not-allowed" }}>
                {addSaving ? "Adding…" : "Add Item"}
              </button>
            </div>
          </div>
        </>
      )}

      {confirmRemoveItemId && (
        <>
          <div onClick={() => setConfirmRemoveItemId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 100 }} />
          <div role="dialog" aria-modal="true" style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--bg-surface)", borderRadius: "var(--radius)",
            padding: 24, width: 320, zIndex: 101,
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--text)", lineHeight: 1.5 }}>
              Remove this item from the transfer?
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setConfirmRemoveItemId(null)}
                style={{ flex: 1, border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "7px 0", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={() => { const id = confirmRemoveItemId; setConfirmRemoveItemId(null); void deleteItem(id); }}
                style={{ flex: 1, background: "var(--negative)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "7px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Remove
              </button>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e5e5e5", background: "var(--bg-surface-elevated)" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</span>
      </div>
      <div style={{ padding: "12px 14px", display: "grid", gap: 8 }}>{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 12 }}>
      <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600, fontFamily: mono ? "monospace" : undefined, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}





