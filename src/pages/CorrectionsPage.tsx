import { friendlyError } from "@/lib/friendlyError";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTableResize } from "@/components/ResizableColumns";
import { DangerAction } from "@/components/DangerAction";
import { ClipboardCheck, Search, AlertTriangle, Check, Clock, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Design tokens ─────────────────────────────────────────────────────────────

const INK    = "var(--text)";
const MUTED  = "var(--muted)";
const BORDER = "var(--line)";
const FAINT  = "var(--bg-surface-elevated)";
const BLUE   = "var(--blue)";
const RED    = "var(--negative)";
const GREEN  = "var(--text)";
const AMBER  = "var(--muted)";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type ConflictInfo = {
  status: "in_stock" | "transferred" | "voided";
  part_number: string | null;
  part_name: string | null;
  transfer_no: string | null;
};

type PartResult = { id: string; part_number: string; part_name: string | null };

// ── Correction Modal ──────────────────────────────────────────────────────────

function CorrectionModal({ serial, onClose, onDone, actorId }: {
  serial: SerialInfo;
  onClose: () => void;
  onDone: (msg: string) => void;
  actorId: string;
}) {
  const [mode, setMode]             = useState<"serial" | "part">("serial");

  // Serial correction state
  const [newSerial, setNewSerial]   = useState("");
  const [checking, setChecking]     = useState(false);
  const [conflict, setConflict]     = useState<ConflictInfo | null>(null);
  const [conflictChecked, setConflictChecked] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Part reassignment state
  const [partQuery, setPartQuery]   = useState("");
  const [partResults, setPartResults] = useState<PartResult[]>([]);
  const [partSearching, setPartSearching] = useState(false);
  const [newPart, setNewPart]       = useState<PartResult | null>(null);
  const partDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared
  const [reason, setReason]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [mode]);

  useEffect(() => {
    setNewSerial(""); setConflict(null); setConflictChecked(false);
    setPartQuery(""); setPartResults([]); setNewPart(null);
    setReason(""); setError(null);
  }, [mode]);

  // Serial conflict check
  const trimmed = newSerial.trim();
  const serialChanged = !!(trimmed && trimmed !== serial.serial_number.toUpperCase());
  useEffect(() => {
    if (!trimmed || trimmed === serial.serial_number) {
      setConflict(null); setConflictChecked(false); setChecking(false); return;
    }
    setChecking(true); setConflict(null); setConflictChecked(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get(`/serials/${encodeURIComponent(trimmed)}`);
        if (data) {
          setConflict({ status: data.status, part_number: data.part_number ?? null, part_name: data.part_name ?? null, transfer_no: data.transfer_no ?? null });
        }
      } catch {}
      setConflictChecked(true); setChecking(false);
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [trimmed]);

  // Part search
  useEffect(() => {
    if (!partQuery.trim() || newPart) { setPartResults([]); return; }
    setPartSearching(true);
    if (partDebounceRef.current) clearTimeout(partDebounceRef.current);
    partDebounceRef.current = setTimeout(async () => {
      const q = partQuery.trim();
      const data = await api.get(`/parts/search?q=${encodeURIComponent(q)}`);
      setPartResults((data ?? []) as PartResult[]);
      setPartSearching(false);
    }, 350);
    return () => { if (partDebounceRef.current) clearTimeout(partDebounceRef.current); };
  }, [partQuery, newPart]);

  const isBlocked = conflict && conflict.status !== "voided";
  const canSubmitSerial = serialChanged && !checking && !isBlocked && !!reason.trim() && conflictChecked;
  const canSubmitPart   = !!(newPart && reason.trim());
  const canSubmit = mode === "serial" ? canSubmitSerial : canSubmitPart;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true); setError(null);

    try {
      if (mode === "serial") {
        await api.post("/corrections/workflow-requests", {
          type: "serial_correction", entity_type: "serial_numbers", entity_id: serial.id,
          requested_by: actorId,
          payload: { old_serial_id: serial.id, old_serial_number: serial.serial_number, new_serial_number: trimmed, reason: reason.trim(), transfer_id: serial.transfer?.id ?? null },
        });
        onDone(`Serial correction submitted: ${serial.serial_number} → ${trimmed}`);
      } else {
        await api.post("/corrections/workflow-requests", {
          type: "part_reassignment", entity_type: "serial_numbers", entity_id: serial.id,
          requested_by: actorId,
          payload: { serial_id: serial.id, serial_number: serial.serial_number, new_part_id: newPart!.id, new_part_number: newPart!.part_number, new_part_name: newPart!.part_name, reason: reason.trim() },
        });
        onDone(`Part reassignment submitted: ${serial.serial_number} → ${newPart!.part_number}`);
      }
    } catch (e: any) {
      setError(friendlyError(e));
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", width: "100%", maxWidth: 500, boxShadow: "0 32px 80px rgba(0,0,0,.22)" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${BORDER}`, borderTop: "3px solid #d97706", borderRadius: "var(--radius) var(--radius) 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <ClipboardCheck size={13} color={MUTED} />
            <div style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: "-0.01em" }}>Correct Record</div>
          </div>
          <div style={{ fontSize: 12, color: MUTED }}>
            <code style={{ fontFamily: "monospace", fontWeight: 700, color: INK, marginRight: 8 }}>{serial.serial_number}</code>
            {serial.part?.part_number && <code style={{ fontFamily: "monospace", color: MUTED, marginRight: 6 }}>{serial.part.part_number}</code>}
            {serial.part?.part_name}
          </div>
          <div style={{ display: "flex", gap: 0, marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", overflow: "hidden", width: "fit-content" }}>
            {(["serial", "part"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                style={{ border: "none", borderRadius: 0, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: mode === m ? INK : "var(--bg-surface-elevated)", color: mode === m ? "var(--nav-active)" : MUTED }}>
                {m === "serial" ? "Wrong serial number" : "Wrong part number"}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ padding: 24 }}>

          {mode === "serial" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", marginBottom: 12 }}>
                <div style={{ padding: "12px 14px", background: serialChanged ? "var(--bg-surface-elevated)" : FAINT, borderRadius: "var(--radius) 0 0 var(--radius)", border: `1px solid ${serialChanged ? "var(--line)" : BORDER}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Current serial</div>
                  <code style={{ fontSize: 13, fontWeight: 700, color: MUTED, textDecoration: serialChanged ? "line-through" : "none", opacity: serialChanged ? 0.5 : 1, wordBreak: "break-all" }}>{serial.serial_number}</code>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: FAINT, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
                  <ArrowRight size={12} color={serialChanged ? BLUE : "#cbd5e1"} />
                </div>
                <div style={{ padding: "12px 14px", background: isBlocked ? "var(--bg-surface-elevated)" : conflictChecked && !conflict ? "var(--bg-surface-elevated)" : FAINT, borderRadius: "0 var(--radius) var(--radius) 0", border: `1px solid ${isBlocked ? "var(--line)" : conflictChecked && !conflict ? "var(--line)" : BORDER}`, transition: "all .15s" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Correct serial</div>
                  <input ref={inputRef} value={newSerial} onChange={(e) => setNewSerial(e.target.value.toUpperCase())} placeholder="Type correct serial…" spellCheck={false} autoComplete="off"
                    style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: isBlocked ? RED : conflictChecked && !conflict ? GREEN : serialChanged ? INK : MUTED, background: "transparent", border: "none", outline: "none", width: "100%", padding: 0 }} />
                </div>
              </div>
              {serialChanged && (
                <div style={{ marginBottom: 16, fontSize: 12, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  {checking && <span style={{ color: MUTED }}>Checking…</span>}
                  {!checking && conflictChecked && !conflict && <><Check size={12} color={GREEN} /><span style={{ color: GREEN }}>Available — not in system.</span></>}
                  {!checking && conflict?.status === "voided" && <><AlertTriangle size={12} color={AMBER} /><span style={{ color: "var(--muted)" }}>Previously voided — will be reactivated on approval.</span></>}
                  {!checking && isBlocked && <><AlertTriangle size={12} color={RED} /><span style={{ color: MUTED }}>Already {conflict!.status === "in_stock" ? "in stock" : `on ${conflict!.transfer_no}`} · <code style={{ fontFamily: "monospace" }}>{conflict!.part_number}</code>{conflict!.part_name ? ` ${conflict!.part_name}` : ""}. Cannot use an active serial.</span></>}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", marginBottom: 12 }}>
                <div style={{ padding: "12px 14px", background: newPart ? "var(--bg-surface-elevated)" : FAINT, borderRadius: "var(--radius) 0 0 var(--radius)", border: `1px solid ${newPart ? "var(--line)" : BORDER}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Current part</div>
                  <code style={{ fontSize: 12, fontWeight: 700, color: MUTED, textDecoration: newPart ? "line-through" : "none", opacity: newPart ? 0.5 : 1 }}>{serial.part?.part_number ?? "—"}</code>
                  {serial.part?.part_name && <div style={{ fontSize: 11, color: MUTED, marginTop: 2, textDecoration: newPart ? "line-through" : "none", opacity: newPart ? 0.5 : 1 }}>{serial.part.part_name}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: FAINT, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
                  <ArrowRight size={12} color={newPart ? BLUE : "#cbd5e1"} />
                </div>
                <div style={{ padding: "12px 14px", background: newPart ? "var(--bg-surface-elevated)" : FAINT, borderRadius: "0 var(--radius) var(--radius) 0", border: `1px solid ${newPart ? "var(--line)" : BORDER}`, transition: "all .15s" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Correct part</div>
                  {newPart ? (
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
                      <div>
                        <code style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{newPart.part_number}</code>
                        {newPart.part_name && <div style={{ fontSize: 11, color: GREEN, marginTop: 2 }}>{newPart.part_name}</div>}
                      </div>
                      <button type="button" onClick={() => { setNewPart(null); setPartQuery(""); }}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
                    </div>
                  ) : (
                    <input ref={inputRef} value={partQuery} onChange={(e) => { setPartQuery(e.target.value); setNewPart(null); }}
                      placeholder="Search part number or name…"
                      style={{ fontFamily: "monospace", fontSize: 13, color: MUTED, background: "transparent", border: "none", outline: "none", width: "100%", padding: 0 }} />
                  )}
                </div>
              </div>
              {!newPart && partQuery.trim() && (
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 12 }}>
                  {partSearching && <div style={{ padding: "10px 14px", fontSize: 12, color: MUTED }}>Searching…</div>}
                  {!partSearching && !partResults.length && <div style={{ padding: "10px 14px", fontSize: 12, color: MUTED }}>No parts found.</div>}
                  {partResults.map((p) => (
                    <button key={p.id} type="button" onClick={() => { setNewPart(p); setPartQuery(""); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "5px 10px", border: "none", borderBottom: `1px solid ${FAINT}`, background: "var(--bg-surface)", cursor: "pointer", textAlign: "left" }}>
                      <code style={{ fontSize: 12, fontWeight: 700, color: BLUE, flexShrink: 0 }}>{p.part_number}</code>
                      <span style={{ fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.part_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Reason <span style={{ color: MUTED }}>*</span>
              <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none", marginLeft: 4 }}>required for audit trail</span>
            </label>
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={mode === "serial" ? "e.g. Wrong serial scanned during packing — physical unit confirmed correct" : "e.g. Unit stocked under wrong part — physical label confirmed correct part number"}
              rows={2}
              style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "none", boxSizing: "border-box", color: INK }} />
          </div>

          {error && <div style={{ marginBottom: 12, fontSize: 12, color: MUTED }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose}
                style={{ border: `1px solid ${BORDER}`, background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer", color: MUTED }}>
                Cancel
              </button>
              <button type="submit" disabled={!canSubmit || submitting}
                style={{ border: "none", background: canSubmit ? BLUE : "#e2e8f0", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", color: canSubmit ? "#fff" : "#94a3b8" }}>
                {submitting ? "Submitting…" : "Submit for approval"}
              </button>
            </div>
        </form>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function CorrectionsPage() {
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.profile.id : null;
  const canApprove = authState.status === "authenticated" && ["system_admin", "dc_admin"].includes(authState.profile.role);

  const [query, setQuery]       = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult]     = useState<SerialInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [pending, setPending]   = useState<any[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [history, setHistory]   = useState<CorrectionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  async function loadPending() {
    const data = await api.get("/corrections/workflow-requests/pending");
    setPending(data ?? []);
  }

  async function loadHistory() {
    const data = await api.get("/corrections/serial-corrections");
    setHistory(data ?? []);
    setHistoryLoading(false);
  }

  useEffect(() => { void loadHistory(); void loadPending(); }, []);

  async function handleSearch(e?: { preventDefault: () => void }, overrideQuery?: string) {
    e?.preventDefault();
    const q = (overrideQuery ?? query).trim();
    if (!q) return;
    setSearching(true); setResult(null); setNotFound(false); setSuccessMsg(null);
    try {
      const data = await api.get(`/serials/${encodeURIComponent(q)}`);
      if (!data) { setNotFound(true); setSearching(false); return; }
      setResult({ id: data.id, serial_number: data.serial_number, status: data.status, part: data.part ?? null, transfer: data.transfer ?? null });
    } catch {
      setNotFound(true);
    }
    setSearching(false);
  }

  async function handleApprove(req: any) {
    if (!actorId) return;
    setApprovingId(req.id); setApproveError(null);
    try {
      await api.put(`/corrections/workflow-requests/${req.id}/approve`, { actorId });
      await loadPending(); void loadHistory();
    } catch (e: any) {
      setApproveError(`Approval error: ${friendlyError(e)}`);
    }
    setApprovingId(null);
  }

  async function handleReject(id: string) {
    if (!actorId) return;
    await api.put(`/corrections/workflow-requests/${id}/reject`, { actorId });
    await loadPending();
  }

  const statusColor = (s: string) => s === "in_stock" ? GREEN : s === "transferred" ? BLUE : MUTED;
  const histTableRef = useTableResize();

  return (
    <AppLayout>
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>

        {/* Page header */}
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ClipboardCheck size={16} color={INK} />
            <span style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Serial Corrections</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "1px 7px" }}>DC Admin only</span>
          </div>
          <span style={{ fontSize: 11, color: MUTED }}>All changes are audited and require peer approval.</span>
        </div>

        {/* Search bar */}
        <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: "var(--radius-pill)", overflow: "hidden", marginBottom: 24, width: 360, marginLeft: "auto", padding: "0 12px" }}>
          <Search size={14} color="var(--muted)" style={{ flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value.toUpperCase()); setResult(null); setNotFound(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) void handleSearch(e as any); }}
            onPaste={(e) => {
              const val = e.clipboardData.getData("text").trim().toUpperCase();
              if (val) { setQuery(val); setResult(null); setNotFound(false); setTimeout(() => void handleSearch(undefined, val), 50); }
            }}
            placeholder="Scan or type serial number…"
            spellCheck={false}
            autoComplete="off"
            data-plain
            style={{ flex: 1, border: "none", outline: "none", padding: "7px 8px", fontSize: 12, fontFamily: "monospace", color: "var(--text)", background: "transparent", boxShadow: "none" }}
          />
          {searching && <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>…</span>}
        </div>
        {notFound && <div style={{ marginBottom: 16, fontSize: 12, color: "var(--muted)", textAlign: "right" }}>Serial "{query.trim()}" not found.</div>}

        {/* Result card — inline, no nested boxes */}
        {result && !successMsg && (
          <div style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "16px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ flex: 1, display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Serial</div>
                <code style={{ fontSize: 15, fontWeight: 700, color: INK }}>{result.serial_number}</code>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Part</div>
                <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{result.part?.part_name ?? result.part?.part_number ?? "—"}</span>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Status</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: statusColor(result.status) }}>{result.status.replace(/_/g, " ")}</span>
              </div>
              {result.transfer && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Transfer</div>
                  <code style={{ fontSize: 13, color: BLUE }}>{result.transfer.transfer_no}</code>
                </div>
              )}
            </div>
            <button type="button" onClick={() => setCorrecting(true)}
              style={{ border: "none", background: BLUE, color: "#fff", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
              Correct serial
            </button>
          </div>
        )}

        {successMsg && (
          <div style={{ background: "var(--bg-surface-elevated)", border: `1px solid var(--line)`, borderRadius: "var(--radius)", padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: GREEN }}>
            <Check size={15} /> {successMsg}
          </div>
        )}

        {/* Pending approvals */}
        {pending.length > 0 && (
          <div style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", marginBottom: 20, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Clock size={13} color={AMBER} />
              <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Pending approval</span>
              <span style={{ fontSize: 11, fontWeight: 600, background: FAINT, color: MUTED, border: `1px solid ${BORDER}`, padding: "1px 8px", borderRadius: "var(--radius)" }}>{pending.length}</span>
            </div>
            {approveError && (
              <div style={{ padding: "5px 12px", background: "var(--bg-surface-elevated)", borderBottom: `1px solid var(--line)`, fontSize: 12, color: MUTED }}>
                {approveError}
              </div>
            )}
            {pending.map((req) => (
              <div key={req.id} style={{ padding: "12px 20px", borderBottom: `1px solid ${FAINT}`, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "1px 6px", flexShrink: 0 }}>
                    {req.type === "part_reassignment" ? "Part" : "Serial"}
                  </span>
                  {req.type === "part_reassignment" ? (
                    <><code style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{req.payload.serial_number}</code>
                    <ArrowRight size={12} color={MUTED} />
                    <code style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{req.payload.new_part_number}</code></>
                  ) : (
                    <><code style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{req.payload.old_serial_number}</code>
                    <ArrowRight size={12} color={MUTED} />
                    <code style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{req.payload.new_serial_number}</code></>
                  )}
                  <span style={{ fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.payload.reason}</span>
                </div>
                <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>by {req.requester?.full_name ?? req.requester?.username ?? "—"}</span>
                <button type="button" onClick={() => void handleApprove(req)} disabled={approvingId === req.id}
                  style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: "var(--radius)", border: "none", background: BLUE, color: "#fff", cursor: approvingId === req.id ? "not-allowed" : "pointer", opacity: approvingId === req.id ? 0.5 : 1, flexShrink: 0, display: canApprove ? undefined : "none" }}>
                  {approvingId === req.id ? "…" : "Approve"}
                </button>
                {canApprove && <DangerAction label="Reject" confirmLabel="Reject" description="Reject this correction?"
                  onConfirm={() => void handleReject(req.id)} />}
              </div>
            ))}
          </div>
        )}

        {/* Correction history */}
        <div style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Correction history</span>
          </div>
          <div className="table-scroll">
            <table ref={histTableRef}>
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
                {!historyLoading && !history.length && <tr><td colSpan={6} className="empty-row">No corrections yet.</td></tr>}
                {history.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontFamily: "monospace", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.old_serial_number}>{row.old_serial_number}</td>
                    <td style={{ fontFamily: "monospace", color: GREEN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.new_serial_number}>{row.new_serial_number}</td>
                    <td style={{ fontFamily: "monospace", color: BLUE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.transfer?.transfer_no ?? "—"}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: MUTED }} title={row.reason}>{row.reason}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: MUTED }}>{row.corrected_by_profile?.full_name ?? row.corrected_by_profile?.username ?? "—"}</td>
                    <td style={{ color: MUTED, fontSize: 11, whiteSpace: "nowrap" }}>{fmtDate(row.corrected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </main>

      {correcting && result && actorId && (
        <CorrectionModal
          serial={result}
          actorId={actorId}
          onClose={() => setCorrecting(false)}
          onDone={(msg: string) => {
            setCorrecting(false);
            setSuccessMsg(msg);
            setResult(null); setQuery("");
            void loadPending();
          }}
        />
      )}
    </AppLayout>
  );
}






