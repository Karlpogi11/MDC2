import { useState, useEffect, type FormEvent } from "react";
import { ClipboardCheck, Search, AlertTriangle, Check } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";

type SerialInfo = {
  id: string;
  serial_number: string;
  status: string;
  part: { part_number: string; part_name: string } | null;
  transfer: { transfer_no: string; id: string } | null;
};

type CorrectionRow = {
  id: string;
  old_serial_number: string;
  new_serial_number: string;
  reason: string;
  corrected_at: string;
  corrected_by_profile: { full_name: string | null; username: string | null } | null;
  transfer: { transfer_no: string } | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function CorrectionsPage() {
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.user.id : null;

  // Lookup
  const [lookupSerial, setLookupSerial] = useState("");
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<SerialInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Correction form
  const [newSerial, setNewSerial] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<CorrectionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  async function loadHistory() {
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client
      .from("serial_corrections")
      .select(`
        id, old_serial_number, new_serial_number, reason, corrected_at,
        corrected_by_profile:profiles!corrected_by(full_name, username),
        transfer:transfers(transfer_no)
      `)
      .order("corrected_at", { ascending: false })
      .limit(50);
    setHistory((data ?? []).map((r: any) => ({
      ...r,
      corrected_by_profile: Array.isArray(r.corrected_by_profile) ? r.corrected_by_profile[0] ?? null : r.corrected_by_profile,
      transfer: Array.isArray(r.transfer) ? r.transfer[0] ?? null : r.transfer,
    })));
    setHistoryLoading(false);
  }

  useEffect(() => { void loadHistory(); }, []);

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    setLooking(true); setLookupError(null); setFound(null);
    const client = getSupabaseClient();
    if (!client) { setLooking(false); return; }

    const { data } = await client
      .from("serial_numbers")
      .select(`
        id, serial_number, status,
        part:parts(part_number, part_name),
        transfer_items(transfer:transfers(transfer_no, id))
      `)
      .eq("serial_number", lookupSerial.trim())
      .maybeSingle();

    if (!data) { setLookupError(`Serial "${lookupSerial.trim()}" not found.`); setLooking(false); return; }

    const d = data as any;
    const latestTransferItem = (d.transfer_items ?? [])[0];
    const transfer = latestTransferItem
      ? (Array.isArray(latestTransferItem.transfer) ? latestTransferItem.transfer[0] : latestTransferItem.transfer)
      : null;

    setFound({
      id: d.id,
      serial_number: d.serial_number,
      status: d.status,
      part: Array.isArray(d.part) ? d.part[0] ?? null : d.part,
      transfer,
    });
    setLooking(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!found || !actorId) return;
    setSubmitting(true); setSubmitError(null); setSubmitSuccess(null);

    const client = getSupabaseClient();
    if (!client) { setSubmitting(false); return; }

    const { data, error } = await client.rpc("apply_serial_correction", {
      p_old_serial_id: found.id,
      p_new_serial_number: newSerial.trim(),
      p_reason: reason.trim(),
      p_actor_id: actorId,
      p_transfer_id: found.transfer?.id ?? null,
    });

    if (error) {
      setSubmitError(error.message);
    } else {
      setSubmitSuccess(`Corrected: ${found.serial_number} → ${newSerial.trim()}`);
      setFound(null); setLookupSerial(""); setNewSerial(""); setReason("");
      void loadHistory();
    }
    setSubmitting(false);
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "8px 10px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit",
  };

  return (
    <AppLayout>
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <ClipboardCheck size={20} color="var(--blue)" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>Serial Corrections</h1>
          <span style={{ background: "#fef9c3", color: "#a16207", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)" }}>
            DC Admin only
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          {/* Step 1: Lookup */}
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>Step 1 — Find serial to correct</span>
            </div>
            <div style={{ padding: 16 }}>
              <form onSubmit={(e) => void handleLookup(e)} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input required value={lookupSerial} onChange={(e) => setLookupSerial(e.target.value)}
                  placeholder="Enter serial number" style={{ ...inputStyle, fontFamily: "monospace" }} />
                <button type="submit" disabled={looking}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                  <Search size={14} /> {looking ? "…" : "Look up"}
                </button>
              </form>

              {lookupError && (
                <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 12 }}>
                  {lookupError}
                </div>
              )}

              {found && (
                <div style={{ padding: "12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "var(--radius)", fontSize: 12 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#6b7a8d" }}>Serial</span>
                      <code style={{ fontWeight: 700, color: "var(--blue)" }}>{found.serial_number}</code>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#6b7a8d" }}>Part</span>
                      <span style={{ fontWeight: 600, color: "#111827", textAlign: "right" }}>{found.part?.part_name ?? "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#6b7a8d" }}>Status</span>
                      <span style={{ fontWeight: 600, color: "#374151" }}>{found.status}</span>
                    </div>
                    {found.transfer && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#6b7a8d" }}>Transfer</span>
                        <code style={{ color: "#374151" }}>{found.transfer.transfer_no}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Correct */}
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>Step 2 — Enter correction</span>
            </div>
            <div style={{ padding: 16 }}>
              {!found ? (
                <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>Look up a serial first.</p>
              ) : (
                <form onSubmit={(e) => void handleSubmit(e)}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Correct serial number *
                    </label>
                    <input required value={newSerial} onChange={(e) => setNewSerial(e.target.value)}
                      placeholder="Enter correct serial" style={{ ...inputStyle, fontFamily: "monospace" }} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Reason * <span style={{ color: "#9ca3af", textTransform: "none", fontWeight: 400 }}>(required for audit)</span>
                    </label>
                    <textarea required value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Wrong serial scanned during packing — physical unit confirmed as correct serial"
                      rows={3} style={{ ...inputStyle, resize: "vertical" }} />
                  </div>

                  <div style={{ padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "var(--radius)", marginBottom: 14, display: "flex", gap: 8, fontSize: 12 }}>
                    <AlertTriangle size={14} color="#a16207" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ color: "#92400e" }}>
                      Old serial <strong>{found.serial_number}</strong> will be voided. This action is permanent and audited.
                    </span>
                  </div>

                  {submitError && (
                    <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 12 }}>
                      {submitError}
                    </div>
                  )}

                  <button type="submit" disabled={submitting}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: submitting ? "#6b8fc4" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer" }}>
                    <ClipboardCheck size={14} /> {submitting ? "Saving…" : "Apply correction"}
                  </button>
                </form>
              )}

              {submitSuccess && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", color: "#15803d", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                  <Check size={14} /> {submitSuccess}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Correction history */}
        <div className="table-card">
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>Correction history</span>
          </div>
          <div className="table-scroll">
            <table style={{ tableLayout: "fixed", minWidth: 760 }}>
              <colgroup>
                <col style={{ width: 140 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: "auto" }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 150 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Old serial</th>
                  <th>New serial</th>
                  <th>Transfer</th>
                  <th>Reason</th>
                  <th>By</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading && <tr><td colSpan={6} className="empty-row">Loading…</td></tr>}
                {!historyLoading && history.length === 0 && <tr><td colSpan={6} className="empty-row">No corrections yet.</td></tr>}
                {history.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontFamily: "monospace", color: "#b91c1c", overflow: "hidden", textOverflow: "ellipsis" }}>{row.old_serial_number}</td>
                    <td style={{ fontFamily: "monospace", color: "#15803d", overflow: "hidden", textOverflow: "ellipsis" }}>{row.new_serial_number}</td>
                    <td style={{ fontFamily: "monospace", color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>{row.transfer?.transfer_no ?? "—"}</td>
                    <td title={row.reason} style={{ overflow: "hidden", textOverflow: "ellipsis", color: "#374151" }}>{row.reason}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", color: "#6b7a8d" }}>
                      {row.corrected_by_profile?.full_name ?? row.corrected_by_profile?.username ?? "—"}
                    </td>
                    <td style={{ color: "#6b7a8d", fontSize: 11 }}>{formatDate(row.corrected_at)}</td>
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
