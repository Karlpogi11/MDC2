import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { PartNumberInput } from "@/components/PartNumberInput";

type Site = { id: string; site_name: string; site_code: string };
type LineItem = {
  serial_number: string;
  part_number: string;
  part_name: string;
  qty: number;
  resolving: boolean;
  error?: string;
};

async function fetchSites(): Promise<Site[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data } = await client
    .from("sites")
    .select("id,site_name,site_code")
    .eq("is_active", true)
    .eq("is_dc", false) // destination sites only (not DC itself)
    .order("site_name");
  return (data ?? []) as Site[];
}

function generateTransferNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `TR-${y}${m}${d}-${rand}`;
}

export function TransferNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { prefill?: { part_number: string; part_name: string }[] } | null)?.prefill;
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.user.id : null;

  const [sites, setSites] = useState<Site[]>([]);
  const [destinationId, setDestinationId] = useState("");
  const [lines, setLines] = useState<LineItem[]>(() =>
    prefill && prefill.length > 0
      ? prefill.map((p) => ({ serial_number: "", part_number: p.part_number, part_name: p.part_name, qty: 1, resolving: false }))
      : [{ serial_number: "", part_number: "", part_name: "", qty: 1, resolving: false }]
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    fetchSites().then(setSites);
  }, []);

  async function resolveSerial(i: number, sn: string) {
    if (!sn.trim()) return;
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, resolving: true, error: undefined } : l));
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client
      .from("serial_numbers")
      .select("status, parts(part_number, part_name)")
      .eq("serial_number", sn.trim())
      .maybeSingle();

    if (!data) {
      setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, resolving: false, error: "Serial not found in inventory." } : l));
      return;
    }
    const part = Array.isArray(data.parts) ? data.parts[0] : data.parts as { part_number: string; part_name: string } | null;
    const statusErr = data.status !== "in_stock" ? `Not available (status: ${data.status})` : undefined;
    setLines((prev) => prev.map((l, idx) => idx === i ? {
      ...l,
      resolving: false,
      part_number: part?.part_number ?? l.part_number,
      part_name: part?.part_name ?? "",
      error: statusErr,
    } : l));
  }

  function addLine() {
    setLines((prev) => [...prev, { serial_number: "", part_number: "", part_name: "", qty: 1, resolving: false }]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value, error: undefined } : l));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) { setError("Not authenticated."); return; }
    if (!destinationId) { setError("Select a destination site."); return; }
    const validLines = lines.filter((l) => l.serial_number.trim() || l.part_number.trim());
    if (validLines.length === 0) { setError("Add at least one item."); return; }
    setError(null);
    setShowConfirm(true); // show confirmation instead of submitting directly
  }

  async function confirmAndSubmit() {
    setShowConfirm(false);
    setSubmitting(true);
    const validLines = lines.filter((l) => l.serial_number.trim() || l.part_number.trim());
    const client = getSupabaseClient();
    if (!client) { setError("Supabase not configured."); setSubmitting(false); return; }

    try {
      // Get DC site id (is_dc = true)
      const { data: dcSite } = await client
        .from("sites")
        .select("id")
        .eq("is_dc", true)
        .single();

      if (!dcSite) throw new Error("DC site not found. Please configure a DC site in the Sites table.");

      // Create transfer header
      const { data: transfer, error: tErr } = await client
        .from("transfers")
        .insert({
          transfer_no: generateTransferNo(),
          source_site_id: dcSite.id,
          destination_site_id: destinationId,
          status: "draft",
          requested_by: actorId,
        })
        .select("id,transfer_no")
        .single();

      if (tErr || !transfer) throw new Error(tErr?.message ?? "Failed to create transfer.");

      // Generate invoice_ref using source site (DC) prefix — format: PREFIXYYYYMMDDLNNN
      const { data: invoiceRef } = await client.rpc("generate_invoice_ref", { p_site_id: dcSite.id });
      if (invoiceRef) {
        await client.from("transfers").update({ invoice_ref: invoiceRef }).eq("id", transfer.id);
      }

      // Resolve serials and parts, insert transfer_items
      const itemInserts = [];
      for (const line of validLines) {
        const sn = line.serial_number.trim();
        const pn = line.part_number.trim();

        let partId: string | null = null;
        let serialId: string | null = null;

        if (sn) {
          const { data: serial } = await client
            .from("serial_numbers")
            .select("id,part_id,status")
            .eq("serial_number", sn)
            .maybeSingle();

          if (!serial) throw new Error(`Serial "${sn}" not found in inventory.`);
          if (serial.status !== "in_stock") throw new Error(`Serial "${sn}" is not available (status: ${serial.status}).`);
          serialId = serial.id;
          partId = serial.part_id;
        } else if (pn) {
          const { data: part } = await client
            .from("parts")
            .select("id")
            .eq("part_number", pn)
            .maybeSingle();

          if (!part) throw new Error(`Part number "${pn}" not found.`);
          partId = part.id;
        }

        if (!partId) continue;
        itemInserts.push({ transfer_id: transfer.id, part_id: partId, serial_id: serialId, qty: line.qty });
      }

      const { error: itemErr } = await client.from("transfer_items").insert(itemInserts);
      if (itemErr) throw new Error(itemErr.message);

      navigate(`/transfers`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create transfer.");
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "8px 10px",
    fontSize: 13, color: "#111827", background: "#fff", outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>Create Transfer</h1>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7a8d" }}>Select a destination and add serials or parts to transfer from DC.</p>
          </div>
          <button type="button" onClick={() => navigate("/transfers")}
            style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
            Cancel
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          {/* Destination */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #f3f4f6" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#111827" }}>Destination site</h2>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <select
                required
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                style={{ border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, color: "#111827", background: "#fff", outline: "none", width: 320, cursor: "pointer" }}
              >
                <option value="">— Select destination —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.site_name} ({s.site_code})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Line items */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#111827" }}>Items</h2>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Enter serial number OR part number</span>
            </div>
            <div style={{ padding: "16px 20px" }}>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "180px 160px 1fr 64px 32px", gap: 10, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid #f3f4f6" }}>
                {["Serial number", "Part number", "Description", "Qty", ""].map((h) => (
                  <div key={h} style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
                ))}
              </div>

              {lines.map((line, i) => {
                const hasSerial = line.serial_number.trim().length > 0;
                return (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "180px 160px 1fr 64px 32px", gap: 10, alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="Scan or type serial"
                      value={line.serial_number}
                      onChange={(e) => updateLine(i, "serial_number", e.target.value)}
                      onBlur={(e) => void resolveSerial(i, e.target.value)}
                      style={{ border: `1px solid ${line.error ? "#fca5a5" : "#d1d5db"}`, borderRadius: "var(--radius)", padding: "9px 10px", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box" as const }}
                    />
                    {hasSerial && line.part_number ? (
                      <input type="text" readOnly value={line.part_number}
                        style={{ border: "1px solid #e5e7eb", borderRadius: "var(--radius)", padding: "9px 10px", fontSize: 12, fontFamily: "monospace", background: "#f9fafb", color: "var(--blue)", width: "100%", boxSizing: "border-box" as const, outline: "none" }} />
                    ) : (
                      <PartNumberInput value={line.part_number}
                        onChange={(pn, part) => { updateLine(i, "part_number", pn); if (part) updateLine(i, "part_name", part.part_name); }}
                        placeholder="Part number" style={{ fontSize: 12 }} />
                    )}
                    <input type="text" readOnly
                      value={line.resolving ? "Looking up…" : (line.part_name || "")}
                      placeholder="Auto-filled"
                      style={{ border: "1px solid #e5e7eb", borderRadius: "var(--radius)", padding: "9px 10px", fontSize: 12, background: "#f9fafb", color: "#374151", outline: "none", width: "100%", boxSizing: "border-box" as const }}
                    />
                    {hasSerial ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#9ca3af", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, height: 38 }}>1</div>
                    ) : (
                      <input type="number" min={1} value={line.qty}
                        onChange={(e) => updateLine(i, "qty", parseInt(e.target.value) || 1)}
                        style={{ border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 8px", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" as const, textAlign: "center" }} />
                    )}
                    <button type="button" onClick={() => removeLine(i)}
                      disabled={lines.length === 1}
                      style={{ border: "1px solid #e5e7eb", borderRadius: "var(--radius)", background: "#fff", color: "#9ca3af", cursor: lines.length === 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", height: 38, width: 32, opacity: lines.length === 1 ? 0.4 : 1, flexShrink: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                  {line.error && <p style={{ margin: "3px 0 0", fontSize: 11, color: "#b91c1c" }}>{line.error}</p>}
                </div>
                );
              })}

              <button type="button" onClick={addLine}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px dashed #d1d5db", borderRadius: "var(--radius)", padding: "7px 14px", fontSize: 13, color: "#6b7a8d", cursor: "pointer", marginTop: 8 }}>
                <Plus size={14} /> Add row
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: submitting ? "#6b8fc4" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer" }}>
            {submitting ? "Creating…" : "Review & Create"}
          </button>
        </form>
      </main>

      {/* Confirmation modal */}
      {showConfirm && (() => {
        const dest = sites.find((s) => s.id === destinationId);
        const validLines = lines.filter((l) => l.serial_number.trim() || l.part_number.trim());
        return (
          <>
            <div onClick={() => setShowConfirm(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100 }} />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-transfer-title"
              style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              background: "#fff", borderRadius: 0, padding: 28, width: 440, zIndex: 101,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}>
              <h2 id="confirm-transfer-title" style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Confirm Transfer</h2>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
                Please review before creating. This cannot be undone without cancelling the transfer.
              </p>
              <div style={{ background: "#f7f7f7", border: "1px solid var(--line)", borderRadius: 0, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--muted)" }}>Destination</span>
                  <strong style={{ color: "var(--text)" }}>{dest?.site_name ?? "—"}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--muted)" }}>Total items</span>
                  <strong style={{ color: "var(--text)" }}>{validLines.length}</strong>
                </div>
                <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8, maxHeight: 140, overflowY: "auto" }}>
                  {validLines.map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <code style={{ color: "var(--blue)" }}>{l.serial_number || l.part_number}</code>
                      <span style={{ color: "var(--text)" }}>{l.part_name || l.part_number}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => void confirmAndSubmit()}
                  style={{ flex: 1, background: "var(--blue)", color: "#fff", border: "none", borderRadius: 0, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Confirm
                </button>
                <button type="button" onClick={() => setShowConfirm(false)}
                  style={{ flex: 1, background: "#fff", border: "1px solid var(--line)", borderRadius: 0, padding: "10px 0", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                  Go back
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </AppLayout>
  );
}
