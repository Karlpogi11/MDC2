import { useTableResize } from "@/components/ResizableColumns";
import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowRight, Package, CheckCircle, Truck, Check, X, FileText } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { toCapitalized } from "@/lib/format";
import { useBranding } from "@/lib/useBranding";

type TransferStatus = "draft" | "packed" | "in_transit" | "received" | "cancelled";

type TransferDetail = {
  id: string;
  transfer_no: string;
  invoice_ref: string | null;
  status: TransferStatus;
  created_at: string;
  packed_at: string | null;
  courier: string | null;
  awb: string | null;
  receipt_token: string | null;
  source_site: { site_name: string; invoice_prefix: string | null; address: string | null; is_dc: boolean } | null;
  destination_site: { site_name: string; site_code: string; address: string | null } | null;
  requested_by_profile: { full_name: string | null; username: string | null } | null;
  packed_by_profile: { full_name: string | null; username: string | null } | null;
  items: {
    id: string;
    qty: number;
    part: { part_number: string; part_name: string; category: string | null } | null;
    serial: { serial_number: string; status: string } | null;
  }[];
};

const STATUS_ORDER: TransferStatus[] = ["draft", "packed", "in_transit", "received"];

const STATUS_META: Record<TransferStatus, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  draft:      { label: "Draft",      icon: <Package size={16} />,      color: "#6b7a8d", bg: "#f3f4f6" },
  packed:     { label: "Packed",     icon: <Package size={16} />,      color: "#1d4ed8", bg: "#dbeafe" },
  in_transit: { label: "In Transit", icon: <Truck size={16} />,        color: "#a16207", bg: "#fef9c3" },
  received:   { label: "Received",   icon: <CheckCircle size={16} />,  color: "#15803d", bg: "#dcfce7" },
  cancelled:  { label: "Cancelled",  icon: <X size={16} />,            color: "#b91c1c", bg: "#fee2e2" },
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
  const actorId = authState.status === "authenticated" ? authState.user.id : null;
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

  // Tracking modal (shown before Mark as In Transit)
  const [showTrackingModal, setShowTrackingModal] = useState(false);
  const [trackingCourier, setTrackingCourier] = useState("");
  const [trackingAwb, setTrackingAwb] = useState("");
  const [showReceiptConfirm, setShowReceiptConfirm] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const autoEmailRetryRef = useRef<Set<string>>(new Set());
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  // Partial receipt: track which items are confirmed received
  const [receivedItems, setReceivedItems] = useState<Set<string>>(new Set());

  async function generatePDF() {
    if (!transfer) return;
    setGeneratingPDF(true);
    setActionError(null);
    try {
      const client = getSupabaseClient();

      // Ensure a receipt token exists for QR/barcode on packing list
      let token = transfer.receipt_token;
      if (!token && client) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        await client.from("transfers").update({
          receipt_token: token,
          receipt_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }).eq("id", transfer.id);
      }
      const receiveUrl = token ? `${window.location.origin}/transfers/${transfer.id}/receive?token=${token}` : null;

      // Always regenerate fresh — ensures latest layout/data is used
      const { generatePackingListPDF } = await import("@/lib/packingList");
      const doc = await generatePackingListPDF({
        transferNo: transfer.transfer_no,
        invoiceRef: transfer.invoice_ref ?? transfer.transfer_no,
        createdAt: transfer.created_at,
        packedAt: transfer.packed_at,
        sourceSite: transfer.source_site?.site_name ?? "DC",
        sourceAddress: transfer.source_site?.address ?? null,
        sourceIsDC: transfer.source_site?.is_dc ?? true,
        destinationSite: transfer.destination_site?.site_name ?? "—",
        destinationAddress: transfer.destination_site?.address ?? null,
        requestedBy: transfer.requested_by_profile?.full_name ?? transfer.requested_by_profile?.username ?? "—",
        courier: transfer.courier ?? null,
        awb: transfer.awb ?? null,
        items: transfer.items.map((item) => ({
          serialNumber: item.serial?.serial_number ?? null,
          partNumber: item.part?.part_number ?? "—",
          partName: item.part?.part_name ?? "—",
          qty: item.qty,
        })),
      });

      // Upload to storage and save reference
      if (client) {
        const fileName = `${transfer.transfer_no}.pdf`;
        const pdfBlob = doc.output("blob") as Blob;
        await client.storage.from("packing-lists").upload(fileName, pdfBlob, { contentType: "application/pdf", upsert: true });
        await client.from("packing_lists").upsert(
          { transfer_id: transfer.id, file_path: fileName, generated_by: actorId },
          { onConflict: "transfer_id" }
        );
      }

      // Download
      doc.save(`${transfer.transfer_no}-packing-list.pdf`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "PDF generation failed.");
    }
    setGeneratingPDF(false);
  }

  async function load(silent = false) {
    const client = getSupabaseClient();
    if (!client || !id) return;
    if (!silent) setLoading(true);

    const { data, error: err } = await client
      .from("transfers")
      .select(`
        id, transfer_no, invoice_ref, status, created_at, packed_at, courier, awb, receipt_token,
        source_site:sites!source_site_id(site_name, invoice_prefix, address, is_dc),
        destination_site:sites!destination_site_id(site_name, site_code, address),
        requested_by_profile:profiles!requested_by(full_name, username),
        packed_by_profile:profiles!packed_by(full_name, username),
        items:transfer_items(
          id, qty,
          part:parts(part_number, part_name, category),
          serial:serial_numbers(serial_number, status)
        )
      `)
      .eq("id", id)
      .single();

    if (err || !data) { setLoadError("Transfer not found."); setLoading(false); return; }

    // Normalize Supabase join arrays
    const d = data as any;
    setTransfer({
      ...d,
      source_site: Array.isArray(d.source_site) ? d.source_site[0] ?? null : d.source_site,
      destination_site: Array.isArray(d.destination_site) ? d.destination_site[0] ?? null : d.destination_site,
      requested_by_profile: Array.isArray(d.requested_by_profile) ? d.requested_by_profile[0] ?? null : d.requested_by_profile,
      packed_by_profile: Array.isArray(d.packed_by_profile) ? d.packed_by_profile[0] ?? null : d.packed_by_profile,
      items: (d.items ?? []).map((item: any) => ({
        ...item,
        part: Array.isArray(item.part) ? item.part[0] ?? null : item.part,
        serial: Array.isArray(item.serial) ? item.serial[0] ?? null : item.serial,
      })),
    });
    setLoading(false);
  }

  useEffect(() => { void load(); }, [id]);

  // Realtime: reload when this transfer changes (e.g. received from ReceivePage)
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || !id) return;
    const channel = client
      .channel(`transfer-detail-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "transfers", filter: `id=eq.${id}` }, () => {
        void load();
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [id]);

  // Heal path: if a transfer is already in transit but has no receipt token,
  // the email likely failed previously. Auto-retry once per transfer view.
  useEffect(() => {
    if (!transfer || !canAdvance) return;
    if (transfer.status !== "in_transit" || transfer.receipt_token) return;
    if (autoEmailRetryRef.current.has(transfer.id)) return;
    autoEmailRetryRef.current.add(transfer.id);

    void (async () => {
      setSendingEmail(true);
      const result = await invokeTransferEmail(transfer.id, { attempts: 1, includeAttachment: true });
      if (!result.ok) {
        const isMissingEmail = (result.detail ?? "").includes("contact_emails") || (result.detail ?? "").includes("No valid");
        setActionError(
          isMissingEmail
            ? "Transfer is in transit, but no email sent — destination site has no contact email. Add one in Config → Sites."
            : `Transfer is in transit, but email retry failed: ${result.detail ?? "Unknown error"}`
        );
      } else {
        await load(true);
      }
      setSendingEmail(false);
    })();
  }, [transfer, canAdvance]);

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
    options?: { attempts?: number; includeAttachment?: boolean; allowAttachmentFallback?: boolean; pdfBase64?: string | null },
  ): Promise<{ ok: boolean; detail?: string; packingListAttached?: boolean; pdfError?: string | null; smtpAttachmentError?: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { ok: false, detail: "Supabase not configured." };

    const attempts = Math.max(1, options?.attempts ?? 1);
    const includeAttachment = options?.includeAttachment ?? true;
    const allowAttachmentFallback = options?.allowAttachmentFallback ?? true;
    const attachmentModes = includeAttachment && allowAttachmentFallback ? [true, false] : [includeAttachment];
    let detail = "Unknown error";

    for (let modeIndex = 0; modeIndex < attachmentModes.length; modeIndex++) {
      const includeAttachmentInAttempt = attachmentModes[modeIndex];
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          await client.auth.getSession();
          const invokeResult = client.functions.invoke<{
            ok?: boolean;
            reason?: string;
            error?: string;
            skipped?: boolean;
            packing_list_attached?: boolean;
            pdf_error?: string | null;
            smtp_attachment_error?: string | null;
          }>("send-transfer-email", {
            body: { transfer_id: transferId, include_attachment: includeAttachmentInAttempt, ...(options?.pdfBase64 ? { pdf_base64: options.pdfBase64 } : {}) },
          });
          const { data: emailResult, error: emailErr } = await invokeResult;

          if (emailErr) {
            detail = emailErr.message;
            try {
              const body = (emailErr as any).context;
              if (body?.reason) detail = body.reason;
              else if (body?.error) detail = body.error;
            } catch {
              // Keep default detail.
            }
          } else if (emailResult?.ok === false) {
            detail = emailResult.reason ?? emailResult.error ?? "Unknown error";
          } else {
            return { ok: true, packingListAttached: emailResult?.packing_list_attached ?? false, pdfError: emailResult?.pdf_error ?? null, smtpAttachmentError: emailResult?.smtp_attachment_error ?? null };
          }
        } catch (err) {
          detail = err instanceof Error ? err.message : String(err);
        }

        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }

    return { ok: false, detail };
  }

  async function generateAndUploadPDF(courierOverride?: string | null, awbOverride?: string | null): Promise<string | null> {
    if (!transfer || !actorId) return null;
    const client = getSupabaseClient();
    if (!client) return null;
    try {
      const { generatePackingListPDF } = await import("@/lib/packingList");
      const doc = await generatePackingListPDF({
        transferNo: transfer.transfer_no,
        invoiceRef: transfer.invoice_ref ?? transfer.transfer_no,
        createdAt: transfer.created_at,
        packedAt: transfer.packed_at,
        sourceSite: transfer.source_site?.site_name ?? "DC",
        sourceAddress: transfer.source_site?.address ?? null,
        sourceIsDC: transfer.source_site?.is_dc ?? true,
        destinationSite: transfer.destination_site?.site_name ?? "—",
        destinationAddress: transfer.destination_site?.address ?? null,
        requestedBy: transfer.requested_by_profile?.full_name ?? transfer.requested_by_profile?.username ?? "—",
        courier: courierOverride ?? transfer.courier ?? null,
        awb: awbOverride ?? transfer.awb ?? null,
        items: transfer.items.map((item) => ({
          serialNumber: item.serial?.serial_number ?? null,
          partNumber: item.part?.part_number ?? "—",
          partName: item.part?.part_name ?? "—",
          qty: item.qty,
        })),
      });
      const pdfBlob = doc.output("blob") as Blob;
      // Upload to storage (best-effort, for record keeping)
      const fileName = `${transfer.transfer_no}.pdf`;
      void client.storage.from("packing-lists").upload(fileName, pdfBlob, { contentType: "application/pdf", upsert: true });
      void client.from("packing_lists").upsert(
        { transfer_id: transfer.id, file_path: fileName, generated_by: actorId },
        { onConflict: "transfer_id" }
      );
      // Return base64 for direct attachment
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
    const result = await invokeTransferEmail(transferId, { attempts: 1, includeAttachment: true, allowAttachmentFallback: false, pdfBase64 });
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
    }
    setSendingEmail(false);
  }

  async function advanceStatus(courier?: string, awb?: string) {
    if (!transfer || !actorId) return;
    const next = NEXT_STATUS[transfer.status];
    if (!next) return;
    setAdvancing(true); setActionError(null);
    const client = getSupabaseClient()!;
    const update: Record<string, unknown> = { status: next };
    if (next === "packed") { update.packed_by = actorId; update.packed_at = new Date().toISOString(); }
    if (next === "in_transit") {
      if (courier?.trim()) update.courier = courier.trim();
      if (awb?.trim()) update.awb = awb.trim();
    }
    const { error: err } = await client.from("transfers").update(update).eq("id", transfer.id);
    if (err) { setActionError(err.message); setAdvancing(false); return; }

    // When dispatched (in_transit), generate PDF first so email attachment uses the canonical layout
    if (next === "in_transit") {
      const pdfBase64 = await generateAndUploadPDF(courier?.trim(), awb?.trim());
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
    if (next === "received") {
      const destSiteId = transfer.destination_site
        ? await getDestSiteId(client, transfer.destination_site.site_code)
        : undefined;
      if (destSiteId) {
        const serialIds = transfer.items.map((i) => i.serial?.serial_number).filter(Boolean) as string[];
        if (serialIds.length > 0) {
          await client.from("serial_numbers")
            .update({ current_site_id: destSiteId })
            .in("serial_number", serialIds);
        }
      }
    }

    await load(true);
    setAdvancing(false);
  }

  async function getDestSiteId(client: ReturnType<typeof getSupabaseClient>, siteCode: string): Promise<string | undefined> {
    if (!client) return undefined;
    const { data } = await client.from("sites").select("id").eq("site_code", siteCode).maybeSingle();
    return data?.id;
  }

  async function cancelTransfer() {
    if (!transfer) return;
    setCancelling(true); setActionError(null);
    const client = getSupabaseClient()!;
    const { error: err } = await client.from("transfers").update({ status: "cancelled" }).eq("id", transfer.id);
    if (err) setActionError(err.message);
    else await load(true);
    setCancelling(false);
  }

  if (loading) return (
    <AppLayout>
      <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</div>
    </AppLayout>
  );

  if (loadError || !transfer) return (
    <AppLayout>
      <div style={{ padding: 40, textAlign: "center", color: "#b91c1c" }}>{loadError ?? "Transfer not found."}</div>
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
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a", fontFamily: "monospace" }}>
                {transfer.transfer_no}
              </h1>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: meta.bg, color: meta.color }}>
                {meta.icon} {meta.label}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7a8d" }}>
              {transfer.source_site?.site_name ?? "DC"} → {transfer.destination_site?.site_name ?? "—"}
              {transfer.destination_site?.address && <span style={{ marginLeft: 8, color: "#9ca3af" }}>· {transfer.destination_site.address}</span>}
            </p>
          </div>

          {canAdvance && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {/* Secondary */}
              {(transfer.status === "draft" || transfer.status === "packed") && (
                <button type="button" onClick={() => void cancelTransfer()} disabled={cancelling}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: "var(--radius)", padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <X size={14} /> Cancel
                </button>
              )}
              {["packed", "received"].includes(transfer.status) && (
                <button type="button" onClick={() => void generatePDF()} disabled={generatingPDF}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "var(--blue)", border: "1px solid var(--blue)", borderRadius: "var(--radius)", padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: generatingPDF ? "not-allowed" : "pointer", opacity: generatingPDF ? 0.7 : 1 }}>
                  <FileText size={14} /> {generatingPDF ? "Generating…" : "Packing List PDF"}
                </button>
              )}
              {transfer.status === "in_transit" && (
                <div ref={actionMenuRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setShowActionMenu((v) => !v)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    aria-haspopup="menu"
                    aria-expanded={showActionMenu}
                  >
                    More
                  </button>
                  {showActionMenu && (
                    <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", minWidth: 180, background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)", boxShadow: "0 6px 16px rgba(0,0,0,0.12)", padding: 6, zIndex: 30 }}>
                      <button type="button" onClick={() => { setShowActionMenu(false); void generatePDF(); }} disabled={generatingPDF}
                        style={{ width: "100%", textAlign: "left", background: "#fff", border: "none", padding: "8px 10px", fontSize: 13, color: "#1f2937", cursor: generatingPDF ? "not-allowed" : "pointer", opacity: generatingPDF ? 0.6 : 1 }}>
                        {generatingPDF ? "Generating PDF…" : "Packing List PDF"}
                      </button>
                      <button type="button" onClick={() => void resendTransferEmail(transfer.id)} disabled={sendingEmail}
                        style={{ width: "100%", textAlign: "left", background: "#fff", border: "none", padding: "8px 10px", fontSize: 13, color: "#1f2937", cursor: sendingEmail ? "not-allowed" : "pointer", opacity: sendingEmail ? 0.6 : 1 }}>
                        {sendingEmail ? "Sending…" : "Resend Email"}
                      </button>
                      <a href={`/transfers/${transfer.id}/receive`} target="_blank" rel="noopener noreferrer" onClick={() => setShowActionMenu(false)}
                        style={{ display: "block", textAlign: "left", padding: "8px 10px", fontSize: 13, color: "#1f2937", textDecoration: "none" }}>
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
                      setTrackingCourier(""); setTrackingAwb(""); setShowTrackingModal(true);
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
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: receivedItems.size > 0 ? "#15803d" : "#d1d5db", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: receivedItems.size > 0 ? "pointer" : "not-allowed" }}>
                  Confirm receipt ({receivedItems.size}/{transfer.items.length})
                </button>
              )}
            </div>
          )}
        </div>
        {actionError && (
          <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>
            {actionError}
          </div>
        )}
        {actionNotice && (
          <div role="status" style={{ marginBottom: 16, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", color: "#166534", fontSize: 13 }}>
            {actionNotice}
          </div>
        )}

        {/* Status timeline */}
        <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "16px 20px", marginBottom: 20 }}>
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
                      background: done ? (active ? "var(--blue)" : "#dcfce7") : "#f3f4f6",
                      color: done ? (active ? "#fff" : "#15803d") : "#9ca3af",
                      border: active ? "2px solid var(--blue)" : "2px solid transparent",
                    }}>
                      {done && !active ? <Check size={14} /> : sm.icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? "var(--blue)" : done ? "#374151" : "#9ca3af", whiteSpace: "nowrap" }}>
                      {sm.label}
                    </span>
                  </div>
                  {i < STATUS_ORDER.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: i < currentStep && transfer.status !== "cancelled" ? "var(--blue)" : "#e5e7eb", margin: "0 4px", marginBottom: 20 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
          {/* Items table */}
          <div className="table-card">
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>
                Items <span style={{ fontWeight: 400, color: "#888" }}>({transfer.items.length})</span>
              </span>
            </div>
            <div className="table-scroll">
              <table ref={tableRef} style={{ minWidth: 480 }}>
                <colgroup>
                  {transfer.status === "in_transit" && <col style={{ width: 40 }} />}
                  <col style={{ width: 140 }} />
                  <col style={{ width: "auto" }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 60 }} />
                </colgroup>
                <thead>
                  <tr>
                    {transfer.status === "in_transit" && <th style={{ width: 40 }}></th>}
                    <th>Serial / Part</th>
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
                        <td style={{ padding: "10px 12px" }}>
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
                        {item.serial?.serial_number ?? item.part?.part_number ?? "—"}
                      </td>
                      <td title={item.part?.part_name ?? ""} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.part?.part_name ?? "—"}
                      </td>
                      <td className="capitalize" style={{ overflow: "hidden", textOverflow: "ellipsis", color: "#6b7a8d" }}>
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
              <InfoRow label="Transfer #" value={transfer.transfer_no} mono />
              <InfoRow label="Created" value={formatDate(transfer.created_at)} />
              {transfer.packed_at && <InfoRow label="Packed" value={formatDate(transfer.packed_at)} />}
              <InfoRow label="Requested by" value={transfer.requested_by_profile?.full_name ?? transfer.requested_by_profile?.username ?? "—"} />
              {transfer.packed_by_profile && <InfoRow label="Packed by" value={transfer.packed_by_profile.full_name ?? transfer.packed_by_profile.username ?? "—"} />}
              {transfer.invoice_ref && (
                <InfoRow label="Invoice ref" value={transfer.invoice_ref} mono />
              )}
              {transfer.source_site?.invoice_prefix && !transfer.invoice_ref && (
                <InfoRow label="Invoice prefix" value={transfer.source_site.invoice_prefix} mono />
              )}
              {transfer.courier && <InfoRow label="Courier" value={transfer.courier} />}
              {transfer.awb && <InfoRow label="Tracking #" value={transfer.awb} mono />}
            </InfoCard>

            <InfoCard title="Destination">
              <InfoRow label="Site" value={transfer.destination_site?.site_name ?? "—"} />
              <InfoRow label="Code" value={transfer.destination_site?.site_code ?? "—"} mono />
              {transfer.destination_site?.address && (
                <InfoRow label="Address" value={transfer.destination_site.address} />
              )}
            </InfoCard>
          </div>
        </div>
      </main>

      {/* Tracking number modal */}
      {showTrackingModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 0, width: "100%", maxWidth: 420, padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Mark as In Transit</h2>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)" }}>Enter tracking details before dispatching.</p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Courier</label>
              <input
                value={trackingCourier}
                onChange={(e) => setTrackingCourier(e.target.value)}
                placeholder="e.g. LBC, J&T, Lalamove"
                style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 0, padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>
                Tracking Number (AWB) <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <input
                value={trackingAwb}
                onChange={(e) => setTrackingAwb(e.target.value)}
                placeholder="e.g. 1234567890"
                autoFocus
                style={{ width: "100%", border: `1px solid ${trackingAwb.trim() ? "var(--line)" : "#fca5a5"}`, borderRadius: 0, padding: "8px 10px", fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
              />
              {!trackingAwb.trim() && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#b91c1c" }}>Tracking number is required.</p>}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setShowTrackingModal(false)}
                style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 0, padding: "7px 16px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button"
                disabled={!trackingAwb.trim() || advancing}
                onClick={() => { setShowTrackingModal(false); void advanceStatus(trackingCourier, trackingAwb); }}
                style={{ background: trackingAwb.trim() ? "var(--blue)" : "#d1d5db", color: "#fff", border: "none", borderRadius: 0, padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: trackingAwb.trim() ? "pointer" : "not-allowed" }}>
                Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceiptConfirm && transfer && (
        <>
          <div onClick={() => setShowReceiptConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100 }} />
          <div role="dialog" aria-modal="true" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "#fff", borderRadius: 0, padding: 28, width: 400, zIndex: 101, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{orgName}</p>
            <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Confirm Receipt</h2>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)" }}>
              Confirming receipt of <strong>{receivedItems.size}</strong> of <strong>{transfer.items.length}</strong> item{transfer.items.length !== 1 ? "s" : ""} from <strong>{transfer.source_site?.site_name ?? "DC"}</strong>. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button"
                onClick={() => { setShowReceiptConfirm(false); void (async () => {
                  setAdvancing(true); setActionError(null);
                  const client = getSupabaseClient()!;
                  const { error: err } = await client.from("transfers").update({ status: "received" }).eq("id", transfer.id);
                  if (err) { setActionError(err.message); setAdvancing(false); return; }
                  const destId = transfer.destination_site ? await getDestSiteId(client, transfer.destination_site.site_code) : undefined;
                  if (destId) {
                    const receivedSerials = transfer.items
                      .filter((i) => receivedItems.has(i.id) && i.serial?.serial_number)
                      .map((i) => i.serial!.serial_number);
                    if (receivedSerials.length > 0) {
                      await client.from("serial_numbers")
                        .update({ current_site_id: destId })
                        .in("serial_number", receivedSerials);
                    }
                  }
                  await load(true);
                  setAdvancing(false);
                })(); }}
                style={{ flex: 1, background: "#15803d", color: "#fff", border: "none", borderRadius: 0, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Confirm
              </button>
              <button type="button" onClick={() => setShowReceiptConfirm(false)}
                style={{ flex: 1, background: "#fff", border: "1px solid var(--line)", borderRadius: 0, padding: "10px 0", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                Cancel
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
    <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</span>
      </div>
      <div style={{ padding: "12px 14px", display: "grid", gap: 8 }}>{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 12 }}>
      <span style={{ color: "#9ca3af", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "#111827", fontWeight: 600, fontFamily: mono ? "monospace" : undefined, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}
