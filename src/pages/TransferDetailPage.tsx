import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowRight, Package, CheckCircle, Truck, Check, X, FileText } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { useBranding } from "@/lib/useBranding";

type TransferStatus = "draft" | "packed" | "in_transit" | "received" | "cancelled";

type TransferDetail = {
  id: string;
  transfer_no: string;
  status: TransferStatus;
  created_at: string;
  packed_at: string | null;
  source_site: { site_name: string } | null;
  destination_site: { site_name: string; site_code: string; invoice_prefix: string | null; address: string | null } | null;
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state: authState } = useAuth();
  const { logoUrl, brandName } = useBranding();
  const actorId = authState.status === "authenticated" ? authState.user.id : null;
  const role = authState.status === "authenticated" ? authState.profile.role : null;
  const canAdvance = role === "system_admin" || role === "dc_admin" || role === "dc_operator";

  const [transfer, setTransfer] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  async function generatePDF() {
    if (!transfer) return;
    setGeneratingPDF(true);
    try {
      // Lazy-load pdf-lib — keeps it out of the main bundle
      const { generatePackingListPDF } = await import("@/lib/packingList");
      const pdfBytes = await generatePackingListPDF({
        transferNo: transfer.transfer_no,
        invoicePrefix: transfer.destination_site?.invoice_prefix ?? null,
        createdAt: transfer.created_at,
        packedAt: transfer.packed_at,
        sourceSite: transfer.source_site?.site_name ?? "DC",
        destinationSite: transfer.destination_site?.site_name ?? "—",
        destinationAddress: transfer.destination_site?.address ?? null,
        requestedBy: transfer.requested_by_profile?.full_name ?? transfer.requested_by_profile?.username ?? "—",
        brandName,
        logoUrl,
        items: transfer.items.map((item) => ({
          serialNumber: item.serial?.serial_number ?? null,
          partNumber: item.part?.part_number ?? "—",
          partName: item.part?.part_name ?? "—",
          category: item.part?.category ?? null,
          qty: item.qty,
        })),
      });

      // Upload to storage
      const client = getSupabaseClient();
      const fileName = `${transfer.transfer_no}-${Date.now()}.pdf`;
      if (client) {
        await client.storage.from("packing-lists").upload(fileName, pdfBytes, { contentType: "application/pdf", upsert: true });
        // Save reference
        await client.from("packing_lists").upsert({
          transfer_id: transfer.id,
          file_path: fileName,
          generated_by: actorId,
        }, { onConflict: "transfer_id" });
      }

      // Also trigger browser download
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${transfer.transfer_no}-packing-list.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "PDF generation failed.");
    }
    setGeneratingPDF(false);
  }

  async function load() {
    const client = getSupabaseClient();
    if (!client || !id) return;

    const { data, error: err } = await client
      .from("transfers")
      .select(`
        id, transfer_no, status, created_at, packed_at,
        source_site:sites!source_site_id(site_name),
        destination_site:sites!destination_site_id(site_name, site_code, invoice_prefix, address),
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

  async function advanceStatus() {
    if (!transfer || !actorId) return;
    const next = NEXT_STATUS[transfer.status];
    if (!next) return;
    setAdvancing(true); setActionError(null);
    const client = getSupabaseClient()!;
    const update: Record<string, unknown> = { status: next };
    if (next === "packed") { update.packed_by = actorId; update.packed_at = new Date().toISOString(); }
    const { error: err } = await client.from("transfers").update(update).eq("id", transfer.id);
    if (err) setActionError(err.message);
    else await load();
    setAdvancing(false);
  }

  async function cancelTransfer() {
    if (!transfer) return;
    setCancelling(true); setActionError(null);
    const client = getSupabaseClient()!;
    const { error: err } = await client.from("transfers").update({ status: "cancelled" }).eq("id", transfer.id);
    if (err) setActionError(err.message);
    else await load();
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
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
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

          {/* Action buttons */}
          {canAdvance && (
            <div style={{ display: "flex", gap: 8 }}>
              {nextStatus && (
                <button type="button" onClick={() => void advanceStatus()} disabled={advancing}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: advancing ? "not-allowed" : "pointer", opacity: advancing ? 0.7 : 1 }}>
                  <ArrowRight size={14} /> {advancing ? "Updating…" : NEXT_LABEL[transfer.status]}
                </button>
              )}
              {["packed", "in_transit", "received"].includes(transfer.status) && (
                <button type="button" onClick={() => void generatePDF()} disabled={generatingPDF}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "var(--blue)", border: "1px solid var(--blue)", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: generatingPDF ? "not-allowed" : "pointer", opacity: generatingPDF ? 0.7 : 1 }}>
                  <FileText size={14} /> {generatingPDF ? "Generating…" : "Packing List PDF"}
                </button>
              )}
              {(transfer.status === "draft" || transfer.status === "packed") && (
                <button type="button" onClick={() => void cancelTransfer()} disabled={cancelling}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <X size={14} /> Cancel
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
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
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
              <table style={{ tableLayout: "fixed", minWidth: 480 }}>
                <colgroup>
                  <col style={{ width: 130 }} />
                  <col style={{ width: "auto" }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 60 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Serial / Part</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="num">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {transfer.items.length === 0 && (
                    <tr><td colSpan={4} className="empty-row">No items.</td></tr>
                  )}
                  {transfer.items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.serial?.serial_number ?? item.part?.part_number ?? "—"}
                      </td>
                      <td title={item.part?.part_name ?? ""} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.part?.part_name ?? "—"}
                      </td>
                      <td style={{ overflow: "hidden", textOverflow: "ellipsis", color: "#6b7a8d" }}>
                        {item.part?.category ?? "—"}
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
            </InfoCard>

            <InfoCard title="Destination">
              <InfoRow label="Site" value={transfer.destination_site?.site_name ?? "—"} />
              <InfoRow label="Code" value={transfer.destination_site?.site_code ?? "—"} mono />
              {transfer.destination_site?.invoice_prefix && (
                <InfoRow label="Invoice prefix" value={transfer.destination_site.invoice_prefix} mono />
              )}
              {transfer.destination_site?.address && (
                <InfoRow label="Address" value={transfer.destination_site.address} />
              )}
            </InfoCard>
          </div>
        </div>
      </main>
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
