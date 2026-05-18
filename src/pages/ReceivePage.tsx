import { useTableResize } from "@/components/ResizableColumns";
import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Package, Check, Truck, CheckCircle } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/useBranding";

type Item = {
  id: string;
  serial_number: string;
  part_number: string;
  part_name: string;
  qty: number;
  received: boolean;
};

const ERROR_MESSAGES: Record<string, string> = {
  TRANSFER_NOT_FOUND: "Transfer not found. The link may be invalid.",
  INVALID_TOKEN: "Invalid or expired receipt link.",
  TOKEN_EXPIRED: "This receipt link has expired. Contact DC to resend.",
  INVALID_STATUS: "This transfer is not ready to receive.",
};

export function ReceivePage() {
  const tableRef = useTableResize();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { state: authState } = useAuth();
  const isLoggedIn = authState.status === "authenticated";

  const [items, setItems] = useState<Item[]>([]);
  const [transferNo, setTransferNo] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [sourceSite, setSourceSite] = useState("");
  const [destSite, setDestSite] = useState("");
  const [destSiteId, setDestSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || !id) return;

    if (token) {
      // Public token-based access — use security definer RPC
      client.rpc("get_transfer_by_token", { p_transfer_id: id, p_token: token })
        .single()
        .then(({ data, error: err }) => {
          if (err || !data) {
            const code = err?.message ?? "TRANSFER_NOT_FOUND";
            setError(ERROR_MESSAGES[code] ?? "Transfer not found.");
            setLoading(false);
            return;
          }
          const d = data as any;
          if (d.status === "received") {
            setDone(true); setTransferNo(d.transfer_no); setInvoiceRef(d.invoice_ref ?? "");
            setLoading(false); return;
          }
          if (d.status !== "in_transit") {
            setError(`Transfer is "${d.status}" — not ready to receive.`);
            setLoading(false); return;
          }
          setTransferNo(d.transfer_no);
          setInvoiceRef(d.invoice_ref ?? "");
          setSourceSite(d.source_site_name ?? "DC");
          setDestSite(d.destination_site_name ?? "—");
          setDestSiteId(d.destination_site_id ?? null);
          setItems((d.items ?? [])
            .filter((i: any) => i.serial_number)
            .map((i: any) => ({
              id: i.id, serial_number: i.serial_number,
              part_number: i.part_number ?? "—", part_name: i.part_name ?? "—",
              qty: i.qty, received: false,
            })));
          setLoading(false);
        });
    } else if (isLoggedIn) {
      // Authenticated DC staff — direct query (RLS allows it)
      client
        .from("transfers")
        .select(`
          transfer_no, status, invoice_ref,
          source_site:sites!source_site_id(site_name),
          destination_site:sites!destination_site_id(id, site_name),
          transfer_items(id, qty, part:parts(part_number, part_name), serial:serial_numbers(serial_number))
        `)
        .eq("id", id)
        .single()
        .then(({ data, error: err }) => {
          if (err || !data) { setError("Transfer not found."); setLoading(false); return; }
          const d = data as any;
          if (d.status === "received") { setDone(true); setTransferNo(d.transfer_no); setInvoiceRef(d.invoice_ref ?? ""); setLoading(false); return; }
          if (d.status !== "in_transit") { setError(`Transfer is "${d.status}" — not ready to receive.`); setLoading(false); return; }
          const src = Array.isArray(d.source_site) ? d.source_site[0] : d.source_site;
          const dst = Array.isArray(d.destination_site) ? d.destination_site[0] : d.destination_site;
          setTransferNo(d.transfer_no);
          setInvoiceRef(d.invoice_ref ?? "");
          setSourceSite(src?.site_name ?? "DC");
          setDestSite(dst?.site_name ?? "—");
          setDestSiteId(dst?.id ?? null);
          setItems((d.transfer_items ?? []).map((item: any) => {
            const part = Array.isArray(item.part) ? item.part[0] : item.part;
            const serial = Array.isArray(item.serial) ? item.serial[0] : item.serial;
            return { id: item.id, serial_number: serial?.serial_number ?? null, part_number: part?.part_number ?? "—", part_name: part?.part_name ?? "—", qty: item.qty, received: false };
          }).filter((i: any) => i.serial_number !== null));
          setLoading(false);
        });
    } else {
      setError("Access denied. Use the link from your email.");
      setLoading(false);
    }
  }, [id, token, isLoggedIn]);

  async function handleConfirm() {
    setSubmitting(true); setError(null);
    const client = getSupabaseClient();
    if (!client) { setSubmitting(false); return; }

    if (token) {
      // Use token-based RPC for unauthenticated confirm
      const { error: err } = await client.rpc("confirm_receipt_by_token", {
        p_transfer_id: id, p_token: token,
      });
      if (err) {
        setError(ERROR_MESSAGES[err.message] ?? err.message);
        setSubmitting(false); return;
      }
    } else {
      // Authenticated path
      const { error: err } = await client.from("transfers")
        .update({ status: "received", receipt_token: null })
        .eq("id", id).eq("status", "in_transit");
      if (err) { setError(err.message); setSubmitting(false); return; }
    }

    // Update current_site_id for all serials (trigger handles status)
    if (destSiteId) {
      const allSerials = items.filter((i) => i.serial_number).map((i) => i.serial_number);
      if (allSerials.length > 0) {
        await client.from("serial_numbers")
          .update({ current_site_id: destSiteId })
          .in("serial_number", allSerials);
      }
    }
    setDone(true); setSubmitting(false);
  }

  const receivedCount = items.filter((i) => i.received).length;
  const allReceived = receivedCount === items.length && items.length > 0;
  const confirmDisabled = submitting || !allReceived;

  // ── Token / unauthenticated path: standalone page ─────────────────────────
  if (!isLoggedIn || token) {
    if (loading) return <StandalonePage><p style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</p></StandalonePage>;
    if (error) return (
      <StandalonePage>
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "14px 18px", color: "#b91c1c", fontSize: 14 }}>{error}</div>
      </StandalonePage>
    );
    if (done) return (
      <StandalonePage>
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <CheckCircle size={48} color="#16a34a" style={{ marginBottom: 16 }} />
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#15803d" }}>Receipt Confirmed</h2>
          <p style={{ margin: 0, color: "#6b7a8d", fontSize: 14 }}>{invoiceRef || transferNo} has been marked as received.</p>
        </div>
      </StandalonePage>
    );
    return (
      <StandalonePage>
        <div style={{ maxWidth: 420, margin: "0 auto 24px", textAlign: "left" }}>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "#9ca3af" }}>Invoice #</p>
          <p style={{ margin: "0 0 12px", fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#1a2a3a" }}>{invoiceRef || transferNo}</p>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "#9ca3af" }}>From</p>
          <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#1a2a3a" }}>{sourceSite}</p>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "#9ca3af" }}>To</p>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1a2a3a" }}>{destSite}</p>
        </div>

        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", padding: "12px 14px", marginBottom: 24, fontSize: 13, color: "#374151", lineHeight: 1.6, textAlign: "center" }}>
          Please verify all items against the <strong>packing list</strong> before confirming receipt.
        </div>

        {error && <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>{error}</div>}

        <button type="button" onClick={() => void handleConfirm()} disabled={submitting}
          style={{ width: "100%", padding: "14px", fontSize: 15, fontWeight: 700, background: "#15803d", color: "#fff", border: "none", cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Confirming…" : "Confirm Received"}
        </button>
      </StandalonePage>
    );
  }

  // ── Authenticated DC staff path ───────────────────────────────────────────
  if (loading) return <AppLayout><div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</div></AppLayout>;
  if (error) return (
    <AppLayout>
      <main style={{ maxWidth: 640, margin: "40px auto", padding: "0 24px" }}>
        <div role="alert" style={{ padding: "14px 18px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>{error}</div>
      </main>
    </AppLayout>
  );
  if (done) return (
    <AppLayout>
      <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <CheckCircle size={48} color="#16a34a" style={{ marginBottom: 16 }} />
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#15803d" }}>Receipt Confirmed</h1>
        <p style={{ margin: "0 0 28px", color: "#6b7a8d", fontSize: 14 }}>{invoiceRef || transferNo} has been marked as received.</p>
      </main>
    </AppLayout>
  );

  return (
    <AppLayout>
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <Truck size={18} color="var(--blue)" />
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a", fontFamily: "monospace" }}>{invoiceRef || transferNo}</h1>
              <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: "#fef9c3", color: "#a16207" }}>In Transit</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7a8d" }}>
              {sourceSite} → {destSite} · Confirm items received below
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => setItems((p) => p.map((i) => ({ ...i, received: true })))}
              style={{ fontSize: 12, fontWeight: 600, color: "var(--blue)", background: "none", border: "1px solid var(--blue)", padding: "5px 12px", cursor: "pointer" }}>
              Select all
            </button>
            <button type="button" onClick={() => void handleConfirm()} disabled={confirmDisabled}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: confirmDisabled ? "#d1d5db" : "#15803d", color: confirmDisabled ? "#9ca3af" : "#fff", border: "none", padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: confirmDisabled ? "not-allowed" : "pointer" }}>
              {submitting ? "Confirming…" : (!allReceived ? `${items.length - receivedCount} remaining` : "Confirm Received")}
            </button>
          </div>
        </div>

        {error && <div role="alert" style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>{error}</div>}

        <div className="table-card">
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>Items <span style={{ fontWeight: 400, color: "#888" }}>({items.length})</span></span>
          </div>
          <div className="table-scroll">
            <table ref={tableRef} style={{ tableLayout: "fixed", minWidth: 480 }}>
              <colgroup><col style={{ width: 40 }} /><col style={{ width: 140 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 50 }} /></colgroup>
              <thead><tr><th></th><th>Serial</th><th>Description</th><th>Part #</th><th className="num">Qty</th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No serialized items.</td></tr>}
                {items.map((item) => (
                  <tr key={item.id}
                    onClick={() => setItems((p) => p.map((x) => x.id === item.id ? { ...x, received: !x.received } : x))}
                    style={{ cursor: "pointer", background: item.received ? "#f0fdf4" : undefined }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ width: 22, height: 22, background: item.received ? "#16a34a" : "#f3f4f6", border: `2px solid ${item.received ? "#16a34a" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {item.received ? <Check size={12} color="#fff" strokeWidth={3} /> : <Package size={11} color="#9ca3af" />}
                      </div>
                    </td>
                    <td style={{ fontFamily: "monospace", fontWeight: 600, color: item.received ? "#15803d" : "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>{item.serial_number}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={item.part_name}>{item.part_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7a8d" }}>{item.part_number}</td>
                    <td className="num">{item.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}

function StandalonePage({ children }: { children: React.ReactNode }) {
  const { brandName } = useBranding();
  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px", fontFamily: "\"Inter\", \"Segoe UI\", Arial, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 32, height: 32, background: "#13294b", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Truck size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1a2a3a" }}>{brandName ?? "MDC Inventory"}</span>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", padding: 24 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
