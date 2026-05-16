import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, Package, Truck } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Item = {
  id: string;
  serial_number: string | null;
  part_number: string;
  part_name: string;
  qty: number;
  received: boolean;
};

export function MobileReceivePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [items, setItems] = useState<Item[]>([]);
  const [transferNo, setTransferNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || !id) return;

    // Validate token if provided, otherwise require auth (internal use)
    let query = client
      .from("transfers")
      .select(`transfer_no, status, receipt_token, receipt_token_expires_at, transfer_items(id, qty, part:parts(part_number, part_name), serial:serial_numbers(serial_number))`)
      .eq("id", id);

    query.single().then(({ data, error: err }) => {
      if (err || !data) { setError("Transfer not found."); setLoading(false); return; }
      const d = data as any;

      // Token validation
      if (token) {
        if (d.receipt_token !== token) { setError("Invalid or expired receipt link."); setLoading(false); return; }
        if (d.receipt_token_expires_at && new Date(d.receipt_token_expires_at) < new Date()) {
          setError("This receipt link has expired. Contact DC to resend."); setLoading(false); return;
        }
      }

      if (d.status === "received") { setDone(true); setLoading(false); return; }
      if (d.status !== "in_transit") { setError(`Transfer is ${d.status}, not in transit.`); setLoading(false); return; }

      setTransferNo(d.transfer_no);
      setItems((d.transfer_items ?? []).map((item: any) => {
        const part = Array.isArray(item.part) ? item.part[0] : item.part;
        const serial = Array.isArray(item.serial) ? item.serial[0] : item.serial;
        return { id: item.id, serial_number: serial?.serial_number ?? null, part_number: part?.part_number ?? "—", part_name: part?.part_name ?? "—", qty: item.qty, received: false };
      }));
      setLoading(false);
    });
  }, [id, token]);

  function toggle(itemId: string) {
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, received: !i.received } : i));
  }

  function markAll() {
    setItems((prev) => prev.map((i) => ({ ...i, received: true })));
  }

  async function handleConfirm() {
    setSubmitting(true); setError(null);
    const client = getSupabaseClient();
    if (!client) { setSubmitting(false); return; }
    const { error: err } = await client
      .from("transfers")
      .update({ status: "received", receipt_token: null })
      .eq("id", id)
      .eq("status", "in_transit"); // safety: only update if still in_transit
    if (err) { setError(err.message); setSubmitting(false); return; }

    // Update serial statuses
    const serialNumbers = items.filter((i) => i.received && i.serial_number).map((i) => i.serial_number!);
    if (serialNumbers.length > 0) {
      await client.from("serial_numbers").update({ status: "transferred" }).in("serial_number", serialNumbers);
    }

    setDone(true);
    setSubmitting(false);
  }

  const receivedCount = items.filter((i) => i.received).length;
  const allReceived = receivedCount === items.length && items.length > 0;

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f9fafb" }}>
      <span style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</span>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f9fafb", padding: 24 }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "#b91c1c", fontSize: 14, marginBottom: 16 }}>{error}</p>
        <button type="button" onClick={() => navigate("/transfers")}
          style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Back to transfers
        </button>
      </div>
    </div>
  );

  if (done) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f0fdf4", padding: 24 }}>
      <CheckCircle size={56} color="#16a34a" style={{ marginBottom: 16 }} />
      <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#15803d" }}>Received!</h1>
      <p style={{ margin: "0 0 24px", color: "#6b7a8d", fontSize: 14 }}>{transferNo} marked as received.</p>
      <button type="button" onClick={() => navigate("/transfers")}
        style={{ background: "#15803d", color: "#fff", border: "none", borderRadius: 10, padding: "14px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
        Done
      </button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ background: "var(--blue)", color: "#fff", padding: "20px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Truck size={20} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>{transferNo}</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
          {receivedCount}/{items.length} items confirmed
        </p>
        {/* Progress bar */}
        <div style={{ marginTop: 10, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2 }}>
          <div style={{ height: "100%", background: "#fff", borderRadius: 2, width: `${items.length ? (receivedCount / items.length) * 100 : 0}%`, transition: "width 200ms" }} />
        </div>
      </div>

      {/* Mark all button */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#6b7a8d" }}>Tap each item to confirm receipt</span>
        <button type="button" onClick={markAll}
          style={{ fontSize: 13, fontWeight: 600, color: "var(--blue)", background: "none", border: "none", cursor: "pointer" }}>
          Mark all
        </button>
      </div>

      {/* Item list */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            style={{
              display: "flex", alignItems: "center", gap: 14, padding: "16px",
              background: item.received ? "#f0fdf4" : "#fff",
              border: `2px solid ${item.received ? "#86efac" : "#e5e7eb"}`,
              borderRadius: 12, cursor: "pointer", textAlign: "left", width: "100%",
              transition: "all 150ms",
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              background: item.received ? "#16a34a" : "#f3f4f6",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 150ms",
            }}>
              {item.received
                ? <CheckCircle size={20} color="#fff" />
                : <Package size={18} color="#9ca3af" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {item.serial_number && (
                <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: item.received ? "#15803d" : "#111827" }}>
                  {item.serial_number}
                </p>
              )}
              <p style={{ margin: 0, fontSize: 13, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.part_name}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{item.part_number} · qty {item.qty}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Sticky confirm button */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 20px", background: "#fff", borderTop: "1px solid #e5e7eb" }}>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={!allReceived || submitting}
          style={{
            width: "100%", padding: "16px", fontSize: 16, fontWeight: 700,
            background: allReceived ? "#15803d" : "#d1d5db",
            color: allReceived ? "#fff" : "#9ca3af",
            border: "none", borderRadius: 12, cursor: allReceived ? "pointer" : "not-allowed",
            transition: "all 200ms",
          }}
        >
          {submitting ? "Confirming…" : allReceived ? "Confirm receipt" : `${items.length - receivedCount} items remaining`}
        </button>
      </div>
    </div>
  );
}
