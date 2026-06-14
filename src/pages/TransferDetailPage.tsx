import { friendlyError } from "@/lib/friendlyError";
import { useTableResize } from "@/components/ResizableColumns";
import { DangerAction } from "@/components/DangerAction";
import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Package, CheckCircle, Truck, Check, X, FileText, ScanLine } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { toCapitalized } from "@/lib/format";
import { useBranding } from "@/lib/useBranding";
import { BarcodeScanner } from "@/components/BarcodeScanner";

type TransferStatus = "draft" | "packed" | "in_transit" | "received" | "cancelled";

type TransferDetail = {
  id: string;
  transferNo: string;
  invoiceRef: string | null;
  status: TransferStatus;
  createdAt: string;
  packedAt: string | null;
  fixablySeries: string | null;
  receiptToken: string | null;
  sourceSite: { siteName: string; invoicePrefix: string | null; address: string | null; isDc: boolean } | null;
  destinationSite: { siteName: string; siteCode: string; address: string | null } | null;
  requestedByProfile: { fullName: string | null; username: string | null } | null;
  packedByProfile: { fullName: string | null; username: string | null } | null;
  items: {
    id: string;
    qty: number;
    part: { id: string; partNumber: string; partName: string; category: string | null } | null;
    serial: { serialNumber: string; status: string } | null;
  }[];
};

const STATUS_ORDER: TransferStatus[] = ["draft", "packed", "in_transit", "received"];

const STATUS_META: Record<TransferStatus, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  draft:      { label: "Draft",      icon: <Package size={16} />,      color: "var(--muted)", bg: "var(--bg-surface-elevated)" },
  packed:     { label: "Packed",     icon: <Package size={16} />,      color: "var(--blue)",  bg: "var(--bg-surface-elevated)" },
  in_transit: { label: "In Transit", icon: <Truck size={16} />,        color: "var(--muted)",    bg: "var(--bg-surface-elevated)" },
  received:   { label: "Received",   icon: <CheckCircle size={16} />,  color: "var(--text)",     bg: "var(--bg-surface-elevated)" },
  cancelled:  { label: "Cancelled",  icon: <X size={16} />,            color: "var(--negative)", bg: "var(--bg-surface-elevated)" },
};

const NEXT_STATUS: Partial<Record<TransferStatus, TransferStatus>> = {
  draft:      "packed",
  packed:     "in_transit",
  in_transit: "received",
};

const NEXT_LABEL: Partial<Record<TransferStatus, string>> = {
  draft:      "Mark as Packed",
  packed:     "Mark as In Transit",
  in_transit: "Mark as Received",
};

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
  const canAdvance = role === "system_admin" || role === "dc_admin" || role === "dc_operator";

  const [transfer, setTransfer] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const { brandName } = useBranding();
  const orgName = brandName ?? window.location.hostname;

  // Fixably series modal (shown before Mark as In Transit)
  const [showFixablyModal, setShowFixablyModal] = useState(false);
  const [fixablySeries, setFixablySeries] = useState("");
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

  async function assignSerial(itemId: string, partId: string, value: string) {
    const sn = value.trim();
    if (!sn) return;
    setSerialSaving(p => ({ ...p, [itemId]: true }));
    setSerialErrors(p => ({ ...p, [itemId]: "" }));

    try {
      const serial = await api.get(`/serials/${encodeURIComponent(sn)}`);
      if (!serial) {
        setSerialErrors(p => ({ ...p, [itemId]: "Serial not found" }));
        setSerialSaving(p => ({ ...p, [itemId]: false }));
        return;
      }
      if (serial.status !== "in_stock") {
        setSerialErrors(p => ({ ...p, [itemId]: `Not available — ${serial.status === "in_transit" ? "Reserved for another transfer" : serial.status === "transferred" ? "Already transferred out" : serial.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}` }));
        setSerialSaving(p => ({ ...p, [itemId]: false }));
        return;
      }
      if (serial.part_id !== partId) {
        setSerialErrors(p => ({ ...p, [itemId]: "Serial belongs to a different part" }));
        setSerialSaving(p => ({ ...p, [itemId]: false }));
        return;
      }

      await api.put(`/transfers/${id}/assign-serial`, { itemId, serialId: serial.id });
      setSerialInputs(p => ({ ...p, [itemId]: "" }));
      await load(true);
    } catch {
      setSerialErrors(p => ({ ...p, [itemId]: "Save failed" }));
    }
    setSerialSaving(p => ({ ...p, [itemId]: false }));
  }

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

  // Poll for updates every 10 seconds
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => void load(true), 10000);
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

  async function generateAndUploadPDF(fixablySeriesOverride?: string | null): Promise<string | null> {
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
        fixablySeries: fixablySeriesOverride ?? transfer.fixablySeries ?? null,
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

  async function advanceStatus(fixablySeries?: string) {
    if (!transfer || !actorId) return;
    const next = NEXT_STATUS[transfer.status];
    if (!next) return;
    setAdvancing(true); setActionError(null);

    try {
      await api.put(`/transfers/${transfer.id}/status`, {
        status: next,
        actorId,
        ...(next === "packed" ? { packed_by: actorId, packed_at: new Date().toISOString() } : {}),
        ...(next === "in_transit" && fixablySeries?.trim() ? { fixablySeries: fixablySeries.trim() } : {}),
      });
    } catch (err) {
      setActionError(friendlyError(err instanceof Error ? err : new Error(String(err))));
      setAdvancing(false);
      return;
    }

    // When dispatched (in_transit), generate PDF + send email
    if (next === "in_transit") {
      const pdfBase64 = await generateAndUploadPDF(fixablySeries?.trim());
      try {
        const cfg = await api.get(`/transfers/${transfer.id}/email-config`);
        const emailEnabled = (cfg as any)?.sendEmail !== false;
        if (emailEnabled) {
          setSendingEmail(true);
          const result = await invokeTransferEmail(transfer.id, { attempts: 1, includeAttachment: true, pdfBase64 });
          if (!result.ok) {
            const isMissingEmail = (result.detail ?? "").includes("contact_emails") || (result.detail ?? "").includes("No valid");
            setActionError(
              isMissingEmail
                ? "Transfer dispatched. No email sent — destination site has no contact email. Add one in Config → Sites."
                : `Transfer dispatched, but email failed: ${result.detail ?? "Unknown error"}`
            );
          }
          setSendingEmail(false);
        }
      } catch {
        // email config lookup non-fatal
      }
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
              {(transfer.status === "draft" || transfer.status === "packed") && (
                <DangerAction label="Cancel transfer" confirmLabel="Yes, cancel" description="This cannot be undone."
                  onConfirm={() => void cancelTransfer()} busy={cancelling} />
              )}
              {transfer.status === "draft" && (
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
                    if (NEXT_STATUS[transfer.status] === "in_transit") {
                      setFixablySeries(""); setShowFixablyModal(true);
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
        {scanMode && transfer.status === "draft" && (
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
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>
                Items <span style={{ fontWeight: 400, color: "#888" }}>({transfer.items.length})</span>
              </span>
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
                  </tr>
                </thead>
                <tbody>
                  {transfer.items.length === 0 && (
                    <tr><td colSpan={transfer.status === "in_transit" ? 5 : 4} className="empty-row">No items.</td></tr>
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
                          : transfer.status === "draft" && item.part
                            ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                  <input
                                    value={serialInputs[item.id] ?? ""}
                                    onChange={e => setSerialInputs(p => ({ ...p, [item.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === "Enter") void assignSerial(item.id, item.part!.id, serialInputs[item.id] ?? ""); }}
                                    onBlur={e => { if (e.target.value.trim()) void assignSerial(item.id, item.part!.id, e.target.value); }}
                                    placeholder="Enter serial number"
                                    disabled={serialSaving[item.id]}
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

      {/* Fixably series modal */}
      {showFixablyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <form
            onSubmit={(e) => { e.preventDefault(); if (!fixablySeries.trim() || advancing) return; setShowFixablyModal(false); void advanceStatus(fixablySeries); }}
            style={{ background: "var(--bg-surface)", borderRadius: 0, width: "100%", maxWidth: 420, padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Mark as In Transit</h2>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)" }}>Enter Fixably series before dispatching.</p>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>
                Fixably Series <span style={{ color: "var(--negative)" }}>*</span>
              </label>
              <input
                value={fixablySeries}
                onChange={(e) => setFixablySeries(e.target.value)}
                placeholder="e.g. iPhone 15 Pro Max"
                autoFocus
                style={{ width: "100%", border: `1px solid ${fixablySeries.trim() ? "var(--line)" : "#fca5a5"}`, borderRadius: 0, padding: "5px 8px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
              {!fixablySeries.trim() && <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--negative)" }}>Fixably series is required.</p>}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setShowFixablyModal(false)}
                style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: 0, padding: "4px 10px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="submit"
                disabled={!fixablySeries.trim() || advancing}
                style={{ background: fixablySeries.trim() ? "var(--blue)" : "#d1d5db", color: "#fff", border: "none", borderRadius: 0, padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: fixablySeries.trim() ? "pointer" : "not-allowed" }}>
                Dispatch
              </button>
            </div>
          </form>
        </div>
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





