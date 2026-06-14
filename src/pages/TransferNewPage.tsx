import { friendlyError } from "@/lib/friendlyError";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { PartNumberInput } from "@/components/PartNumberInput";
import { useSites } from "@/hooks/useSites";

type LineItem = {
  serial_number: string;
  part_number: string;
  part_name: string;
  qty: number;
  resolving: boolean;
  error?: string;
  partId?: string;
  serialId?: string;
};

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
  const prefill = (location.state as { prefill?: { partId: string; partNumber: string; partName: string }[] } | null)?.prefill;
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.profile.id : null;

  const { data: allSites = [] } = useSites();
  const sites = allSites.filter((s) => !s.isDc);
  const [destinationId, setDestinationId] = useState("");
  const [lines, setLines] = useState<LineItem[]>(() =>
    prefill && prefill.length > 0
      ? prefill.map((p) => ({ serial_number: "", part_number: p.partNumber, part_name: p.partName, partId: p.partId, qty: 1, resolving: false }))
      : [{ serial_number: "", part_number: "", part_name: "", qty: 1, resolving: false }]
  );
  const [invoicePrefix, setInvoicePrefix] = useState("");
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  const datePart = mm + dd + yy;
  const [invoiceSuffix, setInvoiceSuffix] = useState("");
  const invoiceRef = invoicePrefix + datePart + "-" + invoiceSuffix;
  useEffect(() => {
    api.get("/sites/dc").then((data) => {
      if (data?.invoicePrefix) setInvoicePrefix(data.invoicePrefix);
    });
  }, []);
  const invoiceSuffixRef = useRef<HTMLInputElement>(null);
  const serialRefs = useRef<(HTMLInputElement | null)[]>([]);
  const serialTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>([]);
  useEffect(() => {
    serialRefs.current = serialRefs.current.slice(0, lines.length);
    serialTimers.current = serialTimers.current.slice(0, lines.length);
  }, [lines.length]);
  useEffect(() => {
    if (destinationId) invoiceSuffixRef.current?.focus();
  }, [destinationId]);

  function focusSerial(i: number) {
    setTimeout(() => serialRefs.current[i]?.focus(), 0);
  }

  function onSerialChange(i: number, value: string) {
    updateLine(i, "serial_number", value);
    if (serialTimers.current[i]) clearTimeout(serialTimers.current[i]);
    if (!value.trim()) { updateLine(i, "part_number", ""); updateLine(i, "part_name", ""); updateLine(i, "error", ""); return; }
    serialTimers.current[i] = setTimeout(() => void resolveSerial(i, value), 350);
  }
  const [invoiceDupError, setInvoiceDupError] = useState<string | null>(null);
  useEffect(() => {
    if (!invoiceSuffix.trim() || !invoicePrefix) { setInvoiceDupError(null); return; }
    const t = setTimeout(async () => {
      const monthStart = `${invoicePrefix}${datePart.slice(0, 2)}`;
      const monthEnd = `${invoicePrefix}${String(Number(datePart.slice(0, 2)) + 1).padStart(2, "0")}`;
      const dups = await api.get(`/transfers?invoice_ref_gte=${monthStart}&invoice_ref_lt=${monthEnd}&limit=500`);
      const list = Array.isArray(dups) ? dups : dups?.data ?? [];
      const found = list.some((r: any) => r.invoiceRef?.endsWith(`-${invoiceSuffix.trim()}`));
      setInvoiceDupError(found ? `Sequence "${invoiceSuffix.trim()}" already used this month.` : null);
    }, 400);
    return () => clearTimeout(t);
  }, [invoiceSuffix, invoicePrefix, datePart]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  async function resolveSerial(i: number, sn: string) {
    if (!sn.trim()) return;
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, resolving: true, error: undefined } : l));
    try {
      const data = await api.get(`/serials/${encodeURIComponent(sn.trim())}`);
      if (!data) {
        setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, resolving: false, error: "Serial not found in inventory." } : l));
        return;
      }
      const part = data.part as { partNumber: string; partName: string } | null;
      const statusLabel = (s: string) =>
        s === "in_transit" ? "Reserved for another transfer" :
        s === "transferred" ? "Already transferred out" :
        s === "consumed" ? "Consumed" :
        s === "void" ? "Voided" :
        s.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      const statusErr = data.status !== "in_stock" ? `Not available — ${statusLabel(data.status)}` : undefined;
      setLines((prev) => prev.map((l, idx) => idx === i ? {
        ...l,
        resolving: false,
        part_number: part?.partNumber ?? l.part_number,
        part_name: part?.partName ?? "",
        partId: data.partId ?? l.partId,
        serialId: data.id ?? l.serialId,
        error: statusErr,
      } : l));
    } catch {
      setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, resolving: false, error: "Serial not found." } : l));
    }
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
    const validLines = lines.filter((l) => l.serial_number.trim() || l.part_number.trim());
    if (!actorId || !destinationId || !invoiceSuffix.trim() || validLines.length === 0) return;
    const unresolved = lines.some(l => l.serial_number.trim() && !l.part_number && !l.error && !l.resolving);
    if (unresolved) return;
    const hasError = lines.some(l => l.error);
    if (hasError) return;
    setError(null);
    // Check for duplicate suffix in current month
    const monthStart = `${invoicePrefix}${datePart.slice(0, 2)}`;
    const monthEnd = `${invoicePrefix}${String(Number(datePart.slice(0, 2)) + 1).padStart(2, "0")}`;
    const dups = await api.get(`/transfers?invoice_ref_gte=${monthStart}&invoice_ref_lt=${monthEnd}&limit=500`);
    const list = Array.isArray(dups) ? dups : dups?.data ?? [];
    const found = list.some((r: any) => r.invoiceRef?.endsWith(`-${invoiceSuffix.trim()}`));
    if (found) { setError(`Invoice sequence "${invoiceSuffix.trim()}" already used this month.`); return; }
    setShowConfirm(true); // show confirmation instead of submitting directly
  }

  async function confirmAndSubmit() {
    setShowConfirm(false);
    setSubmitting(true);
    const validLines = lines.filter((l) => l.serial_number.trim() || l.part_number.trim());

    try {
      await api.post("/transfers", {
        destinationSiteId: destinationId,
        invoiceRefSuffix: invoiceSuffix.trim(),
        items: validLines.map((l) => ({
          partId: l.partId ?? undefined,
          serialId: l.serialId ?? undefined,
          qty: l.qty,
        })),
      });

      navigate(`/transfers`);
    } catch (err) {
      setError(err instanceof Error ? friendlyError(err) : "Failed to create transfer.");
      setSubmitting(false);
    }
  }

  const hasItems = lines.some(l => l.serial_number.trim() || l.part_number.trim());
  const hasLineErrors = lines.some(l => l.error);
  const btnDisabled = submitting || !destinationId || !invoiceSuffix.trim() || !hasItems || hasLineErrors || !!invoiceDupError;

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px",
    fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Create Transfer</h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Select a destination and add serials or parts to transfer from DC.</p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          {/* Destination */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--line)" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Destination site</h2>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <select
                required
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none", width: 320, cursor: "pointer" }}
              >
                <option value="">— Select destination —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.siteName} ({s.siteCode})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Invoice Reference */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--line)" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Invoice Reference</h2>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 0 }}>
              <span style={{ fontSize: 13, fontFamily: "monospace", color: "var(--muted)", padding: "5px 0", whiteSpace: "nowrap" }}>{invoicePrefix}{datePart}-</span>
              <input
                ref={invoiceSuffixRef}
                required
                type="text"
                value={invoiceSuffix}
                onChange={(e) => setInvoiceSuffix(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && invoiceSuffix.trim()) serialRefs.current[0]?.focus(); }}
                placeholder="001"
                style={{ border: `1px solid ${invoiceDupError ? "#fca5a5" : "var(--line)"}`, borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none", width: 100, fontFamily: "monospace", marginLeft: 0 }}
              />
              {invoiceDupError && <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--negative)" }}>{invoiceDupError}</p>}
            </div>
          </div>

          {/* Line items */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Items</h2>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Enter serial number OR part number</span>
            </div>
            <div style={{ padding: "16px 20px" }}>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "180px 160px 1fr 80px 32px", gap: 10, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--line-soft)" }}>
                {["Serial number", "Part number", "Description", "Qty", ""].map((h) => (
                  <div key={h} style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
                ))}
              </div>

              {lines.map((line, i) => {
                const hasSerial = line.serial_number.trim().length > 0;
                return (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "180px 160px 1fr 80px 32px", gap: 10, alignItems: "center" }}>
                    <input
                      ref={(el) => { serialRefs.current[i] = el; }}
                      type="text"
                      placeholder="Scan or type serial"
                      value={line.serial_number}
                      onChange={(e) => onSerialChange(i, e.target.value)}
                      style={{ border: `1px solid ${line.error ? "#fca5a5" : "#d1d5db"}`, borderRadius: "var(--radius)", padding: "7px 8px", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box" as const }}
                    />
                    {hasSerial && line.part_number ? (
                      <input type="text" readOnly value={line.part_number}
                        style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 8px", fontSize: 12, fontFamily: "monospace", background: "var(--bg-surface-elevated)", color: "var(--blue)", width: "100%", boxSizing: "border-box" as const, outline: "none" }} />
                    ) : (
                      <PartNumberInput value={line.part_number}
                        onChange={(pn, part) => { updateLine(i, "part_number", pn); if (part) { updateLine(i, "part_name", part.partName); updateLine(i, "partId", part.id); focusSerial(i); } }}
                        placeholder="Part number" style={{ fontSize: 12 }} />
                    )}
                    <input type="text" readOnly
                      value={line.resolving ? "Looking up…" : (line.part_name || "")}
                      placeholder="Auto-filled"
                      style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 8px", fontSize: 12, background: "var(--bg-surface-elevated)", color: "var(--text)", outline: "none", width: "100%", boxSizing: "border-box" as const }}
                    />
                    {hasSerial ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 8px" }}>1</div>
                    ) : (
                      <input type="number" min={1} value={line.qty}
                        onChange={(e) => updateLine(i, "qty", parseInt(e.target.value) || 1)}
                        style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 8px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" as const, textAlign: "center" }} />
                    )}
                    <button type="button" onClick={() => removeLine(i)}
                      disabled={lines.length === 1}
                      style={{ border: "none", borderRadius: "var(--radius)", background: "transparent", color: "var(--muted)", cursor: lines.length === 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", height: 38, width: 32, opacity: lines.length === 1 ? 0.4 : 1, flexShrink: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                  {line.error && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--negative)" }}>{line.error}</p>}
                </div>
                );
              })}

              <button type="button" onClick={addLine}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px dashed var(--line)", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 13, color: "var(--muted)", cursor: "pointer", marginTop: 8 }}>
                <Plus size={14} /> Add row
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => navigate("/transfers")}
              style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={btnDisabled}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: btnDisabled ? "not-allowed" : "pointer", opacity: 1, pointerEvents: "auto" }}>
              {submitting ? "Creating…" : "Review & Create"}
            </button>
          </div>
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
              background: "var(--bg-surface)", borderRadius: 0, padding: 28, width: 440, zIndex: 101,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)", border: "1px solid var(--line)",
            }}>
              <h2 id="confirm-transfer-title" style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Confirm Transfer</h2>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
                Please review before creating. This cannot be undone without cancelling the transfer.
              </p>
              <div style={{ background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: 0, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--muted)" }}>Invoice ref</span>
                  <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>{invoiceRef}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--muted)" }}>Destination</span>
                  <strong style={{ color: "var(--text)" }}>{dest?.siteName ?? "—"}</strong>
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
                <button type="button" onClick={() => void confirmAndSubmit()} disabled={submitting}
                  style={{ flex: 1, background: "var(--blue)", opacity: submitting ? 0.6 : 1, color: "#fff", border: "none", borderRadius: 0, padding: "5px 0", fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer" }}>
                  {submitting ? "Creating…" : "Confirm"}
                </button>
                <button type="button" onClick={() => setShowConfirm(false)}
                  style={{ flex: 1, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: 0, padding: "5px 0", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
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






