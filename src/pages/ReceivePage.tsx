import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle, Package, Check, Truck } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/lib/auth";

type Item = {
  id: string;
  serial_number: string;
  part_number: string;
  part_name: string;
  qty: number;
  received: boolean;
};

export function ReceivePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { state: authState } = useAuth();
  const isLoggedIn = authState.status === "authenticated";

  const [items, setItems] = useState<Item[]>([]);
  const [transferNo, setTransferNo] = useState("");
  const [sourceSite, setSourceSite] = useState("");
  const [destSite, setDestSite] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || !id) return;
    client
      .from("transfers")
      .select(`
        transfer_no, status, receipt_token, receipt_token_expires_at,
        source_site:sites!source_site_id(site_name),
        destination_site:sites!destination_site_id(site_name),
        transfer_items(id, qty, part:parts(part_number, part_name), serial:serial_numbers(serial_number))
      `)
      .eq("id", id)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) { setError("Transfer not found."); setLoading(false); return; }
        const d = data as any;
        if (token) {
          if (d.receipt_token !== token) { setError("Invalid or expired receipt link."); setLoading(false); return; }
          if (d.receipt_token_expires_at && new Date(d.receipt_token_expires_at) < new Date()) {
            setError("This receipt link has expired. Contact DC to resend."); setLoading(false); return;
          }
        } else if (!isLoggedIn) {
          setError("Access denied. Use the link from your email."); setLoading(false); return;
        }
        if (d.status === "received") { setDone(true); setTransferNo(d.transfer_no); setLoading(false); return; }
        if (d.status !== "in_transit") { setError(`Transfer is "${d.status}" — not ready to receive.`); setLoading(false); return; }
        const src = Array.isArray(d.source_site) ? d.source_site[0] : d.source_site;
        const dst = Array.isArray(d.destination_site) ? d.destination_site[0] : d.destination_site;
        setTransferNo(d.transfer_no);
        setSourceSite(src?.site_name ?? "DC");
        setDestSite(dst?.site_name ?? "—");
        setItems((d.transfer_items ?? []).map((item: any) => {
          const part = Array.isArray(item.part) ? item.part[0] : item.part;
          const serial = Array.isArray(item.serial) ? item.serial[0] : item.serial;
          return { id: item.id, serial_number: serial?.serial_number ?? null, part_number: part?.part_number ?? "—", part_name: part?.part_name ?? "—", qty: item.qty, received: false };
        }).filter((i: any) => i.serial_number !== null));
        setLoading(false);
      });
  }, [id, token, isLoggedIn]);

  async function handleConfirm() {
    setSubmitting(true); setError(null);
    const client = getSupabaseClient();
    if (!client) { setSubmitting(false); return; }
    const { error: err } = await client.from("transfers")
      .update({ status: "received", receipt_token: null })
      .eq("id", id).eq("status", "in_transit");
    if (err) { setError(err.message); setSubmitting(false); return; }
    const serials = items.filter((i) => i.received && i.serial_number).map((i) => i.serial_number);
    if (serials.length > 0) {
      await client.from("serial_numbers").update({ status: "transferred" }).in("serial_number", serials);
    }
    setDone(true); setSubmitting(false);
  }

  const receivedCount = items.filter((i) => i.received).length;
  const allReceived = receivedCount === items.length && items.length > 0;

  // Token-based (no login): standalone branded page
  if (!isLoggedIn || token) {
    if (loading) return <StandalonePage><p style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</p></StandalonePage>;
    if (error) return <StandalonePage><div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "14px 18px", color: "#b91c1c", fontSize: 14 }}>{error}</div></StandalonePage>;
    if (done) return (
      <StandalonePage>
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <CheckCircle size={52} color="#16a34a" style={{ marginBottom: 16 }} />
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#15803d" }}>Receipt Confirmed</h2>
          <p style={{ margin: 0, color: "#6b7a8d", fontSize: 14 }}>{transferNo} has been marked as received.</p>
        </div>
      </StandalonePage>
    );
    return (
      <StandalonePage>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Truck size={16} color="#1d4ed8" />
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 17, color: "#1a2a3a" }}>{transferNo}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#fef9c3", color: "#a16207" }}>In Transit</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7a8d" }}>{sourceSite} → {destSite}</p>
        </div>

        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 5, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", background: allReceived ? "#16a34a" : "#1d4ed8", borderRadius: 3, width: `${items.length ? (receivedCount / items.length) * 100 : 0}%`, transition: "width 200ms" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: allReceived ? "#15803d" : "#374151", whiteSpace: "nowrap" }}>{receivedCount}/{items.length}</span>
          <button type="button" onClick={() => setItems((p) => p.map((i) => ({ ...i, received: true })))}
            style={{ fontSize: 12, fontWeight: 600, color: "#1d4ed8", background: "none", border: "1px solid #bfdbfe", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
            All
          </button>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
          {items.length === 0 && <p style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 13, margin: 0 }}>No serialized items.</p>}
          {items.map((item, i) => (
            <div key={item.id} onClick={() => setItems((p) => p.map((x) => x.id === item.id ? { ...x, received: !x.received } : x))}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", background: item.received ? "#f0fdf4" : "#fff", borderTop: i > 0 ? "1px solid #f3f4f6" : undefined, transition: "background 120ms" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: item.received ? "#16a34a" : "#f3f4f6", border: `2px solid ${item.received ? "#16a34a" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.received ? <Check size={13} color="#fff" strokeWidth={3} /> : <Package size={12} color="#9ca3af" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: item.received ? "#15803d" : "#1d4ed8" }}>{item.serial_number}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.part_name} · {item.part_number}</p>
              </div>
            </div>
          ))}
        </div>

        {error && <div role="alert" style={{ marginBottom: 12, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

        <button type="button" onClick={() => void handleConfirm()} disabled={!allReceived || submitting}
          style={{ width: "100%", padding: "13px", fontSize: 15, fontWeight: 700, background: allReceived ? "#15803d" : "#d1d5db", color: allReceived ? "#fff" : "#9ca3af", border: "none", borderRadius: 8, cursor: allReceived ? "pointer" : "not-allowed", transition: "all 200ms" }}>
          {submitting ? "Confirming…" : allReceived ? "✓ Confirm Receipt" : `${items.length - receivedCount} items remaining`}
        </button>
      </StandalonePage>
    );
  }

  // Logged-in DC staff: use AppLayout
  if (loading) return <AppLayout><div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</div></AppLayout>;
  if (error) return (
    <AppLayout>
      <main style={{ maxWidth: 640, margin: "40px auto", padding: "0 24px" }}>
        <div role="alert" style={{ padding: "14px 18px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>
      </main>
    </AppLayout>
  );
  if (done) return (
    <AppLayout>
      <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <CheckCircle size={48} color="#16a34a" style={{ marginBottom: 16 }} />
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#15803d" }}>Transfer Received</h1>
        <p style={{ margin: "0 0 28px", color: "#6b7a8d", fontSize: 14 }}>{transferNo} has been marked as received.</p>
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
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a", fontFamily: "monospace" }}>{transferNo}</h1>
              <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: "#fef9c3", color: "#a16207" }}>In Transit</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7a8d" }}>{sourceSite} → {destSite} · Confirm items received below</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => setItems((p) => p.map((i) => ({ ...i, received: true })))}
              style={{ fontSize: 12, fontWeight: 600, color: "var(--blue)", background: "none", border: "1px solid var(--blue)", borderRadius: "var(--radius)", padding: "5px 12px", cursor: "pointer" }}>
              Select all
            </button>
            <button type="button" onClick={() => void handleConfirm()} disabled={!allReceived || submitting}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: allReceived ? "#15803d" : "#d1d5db", color: allReceived ? "#fff" : "#9ca3af", border: "none", borderRadius: "var(--radius)", padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: allReceived ? "pointer" : "not-allowed" }}>
              <CheckCircle size={14} />
              {submitting ? "Confirming…" : allReceived ? "Confirm Receipt" : `${items.length - receivedCount} remaining`}
            </button>
          </div>
        </div>

        {error && <div role="alert" style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>{error}</div>}

        <div className="table-card">
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>Items <span style={{ fontWeight: 400, color: "#888" }}>({items.length})</span></span>
          </div>
          <div className="table-scroll">
            <table style={{ tableLayout: "fixed", minWidth: 480 }}>
              <colgroup><col style={{ width: 40 }} /><col style={{ width: 140 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 50 }} /></colgroup>
              <thead><tr><th></th><th>Serial</th><th>Description</th><th>Part #</th><th className="num">Qty</th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No serialized items.</td></tr>}
                {items.map((item) => (
                  <tr key={item.id} onClick={() => setItems((p) => p.map((x) => x.id === item.id ? { ...x, received: !x.received } : x))}
                    style={{ cursor: "pointer", background: item.received ? "#f0fdf4" : undefined }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: item.received ? "#16a34a" : "#f3f4f6", border: `2px solid ${item.received ? "#16a34a" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 32, height: 32, background: "#13294b", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Truck size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#1a2a3a" }}>MDC Inventory</span>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
