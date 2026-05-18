import { useState, useEffect, useRef, type FormEvent } from "react";
import { useResizableColumns, ResizableTh, useTableResize } from "@/components/ResizableColumns";
import { ClipboardCheck, Search, AlertTriangle, Check, Clock, ArrowRight } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
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

const INK    = "#0f172a";
const MUTED  = "#64748b";
const BORDER = "#e2e8f0";
const FAINT  = "#f8fafc";
const BLUE   = "#2563eb";
const RED    = "#dc2626";
const GREEN  = "#16a34a";
const AMBER  = "#d97706";

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
  const serialChanged = !!(trimmed && trimmed !== serial.serial_number);
  useEffect(() => {
    if (!trimmed || trimmed === serial.serial_number) {
      setConflict(null); setConflictChecked(false); setChecking(false); return;
    }
    setChecking(true); setConflict(null); setConflictChecked(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const client = getSupabaseClient(); if (!client) { setChecking(false); return; }
      const { data } = await client.from("serial_numbers")
        .select("status, part:parts(part_number,part_name), transfer_items(transfer:transfers(transfer_no))")
        .eq("serial_number", trimmed).maybeSingle();
      if (data) {
        const d = data as any;
        const part = Array.isArray(d.part) ? d.part[0] : d.part;
        const ti = (d.transfer_items ?? [])[0];
        const tr = ti ? (Array.isArray(ti.transfer) ? ti.transfer[0] : ti.transfer) : null;
        setConflict({ status: d.status, part_number: part?.part_number ?? null, part_name: part?.part_name ?? null, transfer_no: tr?.transfer_no ?? null });
      }
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
      const client = getSupabaseClient(); if (!client) { setPartSearching(false); return; }
      const q = partQuery.trim();
      const { data } = await client.from("parts")
        .select("id, part_number, part_name")
        .or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`)
        .limit(8);
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
    const client = getSupabaseClient(); if (!client) { setSubmitting(false); return; }

    if (mode === "serial") {
      const { error: err } = await client.from("workflow_requests").insert({
        type: "serial_correction", entity_type: "serial_numbers", entity_id: serial.id,
        requested_by: actorId,
        payload: { old_serial_id: serial.id, old_serial_number: serial.serial_number, new_serial_number: trimmed, reason: reason.trim(), transfer_id: serial.transfer?.id ?? null },
      });
      if (err) { setError(err.message); setSubmitting(false); return; }
      onDone(`Serial correction submitted: ${serial.serial_number} → ${trimmed}`);
    } else {
      const { error: err } = await client.from("workflow_requests").insert({
        type: "part_reassignment", entity_type: "serial_numbers", entity_id: serial.id,
        requested_by: actorId,
        payload: { serial_id: serial.id, serial_number: serial.serial_number, new_part_id: newPart!.id, new_part_number: newPart!.part_number, new_part_name: newPart!.part_name, reason: reason.trim() },
      });
      if (err) { setError(err.message); setSubmitting(false); return; }
      onDone(`Part reassignment submitted: ${serial.serial_number} → ${newPart!.part_number}`);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 500, boxShadow: "0 32px 80px rgba(0,0,0,.22)" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${BORDER}`, borderTop: "3px solid #d97706", borderRadius: "12px 12px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <ClipboardCheck size={13} color={MUTED} />
            <div style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: "-0.01em" }}>Correct Record</div>
          </div>
          <div style={{ fontSize: 12, color: MUTED }}>
            <code style={{ fontFamily: "monospace", fontWeight: 700, color: INK, marginRight: 8 }}>{serial.serial_number}</code>
            {serial.part?.part_number && <code style={{ fontFamily: "monospace", color: MUTED, marginRight: 6 }}>{serial.part.part_number}</code>}
            {serial.part?.part_name}
          </div>
          <div style={{ display: "flex", gap: 0, marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
            {(["serial", "part"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                style={{ border: "none", padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: mode === m ? INK : "#fff", color: mode === m ? "#fff" : MUTED }}>
                {m === "serial" ? "Wrong serial number" : "Wrong part number"}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ padding: 24 }}>

          {mode === "serial" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", marginBottom: 12 }}>
                <div style={{ padding: "12px 14px", background: serialChanged ? "#fef2f2" : FAINT, borderRadius: "8px 0 0 8px", border: `1px solid ${serialChanged ? "#fecaca" : BORDER}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Current serial</div>
                  <code style={{ fontSize: 13, fontWeight: 700, color: RED, textDecoration: serialChanged ? "line-through" : "none", opacity: serialChanged ? 0.5 : 1, wordBreak: "break-all" }}>{serial.serial_number}</code>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: FAINT, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
                  <ArrowRight size={12} color={serialChanged ? BLUE : "#cbd5e1"} />
                </div>
                <div style={{ padding: "12px 14px", background: isBlocked ? "#fef2f2" : conflictChecked && !conflict ? "#f0fdf4" : FAINT, borderRadius: "0 8px 8px 0", border: `1px solid ${isBlocked ? "#fecaca" : conflictChecked && !conflict ? "#bbf7d0" : BORDER}`, transition: "all .15s" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Correct serial</div>
                  <input ref={inputRef} value={newSerial} onChange={(e) => setNewSerial(e.target.value)} placeholder="Type correct serial…"
                    style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: isBlocked ? RED : conflictChecked && !conflict ? GREEN : serialChanged ? INK : MUTED, background: "transparent", border: "none", outline: "none", width: "100%", padding: 0 }} />
                </div>
              </div>
              {serialChanged && (
                <div style={{ marginBottom: 16, fontSize: 12, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  {checking && <span style={{ color: MUTED }}>Checking…</span>}
                  {!checking && conflictChecked && !conflict && <><Check size={12} color={GREEN} /><span style={{ color: GREEN }}>Available — not in system.</span></>}
                  {!checking && conflict?.status === "voided" && <><AlertTriangle size={12} color={AMBER} /><span style={{ color: "#92400e" }}>Previously voided — will be reactivated on approval.</span></>}
                  {!checking && isBlocked && <><AlertTriangle size={12} color={RED} /><span style={{ color: RED }}>Already {conflict!.status === "in_stock" ? "in stock" : `on ${conflict!.transfer_no}`} · <code style={{ fontFamily: "monospace" }}>{conflict!.part_number}</code>{conflict!.part_name ? ` ${conflict!.part_name}` : ""}. Cannot use an active serial.</span></>}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", marginBottom: 12 }}>
                <div style={{ padding: "12px 14px", background: newPart ? "#fef2f2" : FAINT, borderRadius: "8px 0 0 8px", border: `1px solid ${newPart ? "#fecaca" : BORDER}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Current part</div>
                  <code style={{ fontSize: 12, fontWeight: 700, color: RED, textDecoration: newPart ? "line-through" : "none", opacity: newPart ? 0.5 : 1 }}>{serial.part?.part_number ?? "—"}</code>
                  {serial.part?.part_name && <div style={{ fontSize: 11, color: MUTED, marginTop: 2, textDecoration: newPart ? "line-through" : "none", opacity: newPart ? 0.5 : 1 }}>{serial.part.part_name}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: FAINT, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
                  <ArrowRight size={12} color={newPart ? BLUE : "#cbd5e1"} />
                </div>
                <div style={{ padding: "12px 14px", background: newPart ? "#f0fdf4" : FAINT, borderRadius: "0 8px 8px 0", border: `1px solid ${newPart ? "#bbf7d0" : BORDER}`, transition: "all .15s" }}>
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
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
                  {partSearching && <div style={{ padding: "10px 14px", fontSize: 12, color: MUTED }}>Searching…</div>}
                  {!partSearching && !partResults.length && <div style={{ padding: "10px 14px", fontSize: 12, color: MUTED }}>No parts found.</div>}
                  {partResults.map((p) => (
                    <button key={p.id} type="button" onClick={() => { setNewPart(p); setPartQuery(""); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 14px", border: "none", borderBottom: `1px solid ${FAINT}`, background: "#fff", cursor: "pointer", textAlign: "left" }}>
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
              Reason <span style={{ color: RED }}>*</span>
              <span style={{ color: "#94a3b8", fontWeight: 400, textTransform: "none", marginLeft: 4 }}>required for audit trail</span>
            </label>
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={mode === "serial" ? "e.g. Wrong serial scanned during packing — physical unit confirmed correct" : "e.g. Unit stocked under wrong part — physical label confirmed correct part number"}
              rows={2}
              style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "none", boxSizing: "border-box", color: INK }} />
          </div>

          {error && <div style={{ marginBottom: 12, fontSize: 12, color: RED }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose}
                style={{ border: `1px solid ${BORDER}`, background: "#fff", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", color: MUTED }}>
                Cancel
              </button>
              <button type="submit" disabled={!canSubmit || submitting}
                style={{ border: "none", background: canSubmit ? BLUE : "#e2e8f0", borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", color: canSubmit ? "#fff" : "#94a3b8" }}>
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
  const actorId = authState.status === "authenticated" ? authState.user.id : null;

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
    const client = getSupabaseClient(); if (!client) return;
    const { data } = await client.from("workflow_requests")
      .select("id,type,payload,requested_at,requester:profiles!requested_by(full_name,username)")
      .in("type", ["serial_correction", "part_reassignment"]).eq("status", "pending")
      .order("requested_at", { ascending: false });
    setPending((data ?? []).map((r: any) => ({ ...r, requester: Array.isArray(r.requester) ? r.requester[0] : r.requester })));
  }

  async function loadHistory() {
    const client = getSupabaseClient(); if (!client) return;
    const { data } = await client.from("serial_corrections")
      .select("id,old_serial_number,new_serial_number,reason,corrected_at,corrected_by_profile:profiles!corrected_by(full_name,username),transfer:transfers(transfer_no)")
      .order("corrected_at", { ascending: false }).limit(50);
    setHistory((data ?? []).map((r: any) => ({
      ...r,
      corrected_by_profile: Array.isArray(r.corrected_by_profile) ? r.corrected_by_profile[0] ?? null : r.corrected_by_profile,
      transfer: Array.isArray(r.transfer) ? r.transfer[0] ?? null : r.transfer,
    })));
    setHistoryLoading(false);
  }

  useEffect(() => { void loadHistory(); void loadPending(); }, []);

  useEffect(() => {
    const client = getSupabaseClient(); if (!client) return;
    const ch = client.channel("corrections-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "workflow_requests" }, () => void loadPending())
      .subscribe();
    return () => { void client.removeChannel(ch); };
  }, []);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setResult(null); setNotFound(false); setSuccessMsg(null);
    const client = getSupabaseClient(); if (!client) { setSearching(false); return; }
    const { data } = await client.from("serial_numbers")
      .select("id,serial_number,status,part:parts(part_number,part_name),transfer_items(transfer:transfers(transfer_no,id))")
      .eq("serial_number", query.trim()).maybeSingle();
    if (!data) { setNotFound(true); setSearching(false); return; }
    const d = data as any;
    const ti = (d.transfer_items ?? [])[0];
    const transfer = ti ? (Array.isArray(ti.transfer) ? ti.transfer[0] : ti.transfer) : null;
    setResult({ id: d.id, serial_number: d.serial_number, status: d.status, part: Array.isArray(d.part) ? d.part[0] ?? null : d.part, transfer });
    setSearching(false);
  }

  async function handleApprove(req: any) {
    if (!actorId) return;
    setApprovingId(req.id); setApproveError(null);
    const client = getSupabaseClient(); if (!client) { setApprovingId(null); return; }
    const p = req.payload;
    let error: any = null;
    if (req.type === "part_reassignment") {
      ({ error } = await client.rpc("apply_part_reassignment", {
        p_serial_id: p.serial_id, p_new_part_id: p.new_part_id,
        p_reason: p.reason, p_actor_id: actorId,
      }));
    } else {
      ({ error } = await client.rpc("apply_serial_correction", {
        p_old_serial_id: p.old_serial_id, p_new_serial_number: p.new_serial_number,
        p_reason: p.reason, p_actor_id: actorId, p_transfer_id: p.transfer_id ?? null,
      }));
    }
    if (error) {
      setApproveError(`RPC error: ${error.message}`);
    } else {
      const { error: updateErr } = await client.from("workflow_requests")
        .update({ status: "approved", reviewed_by: actorId, reviewed_at: new Date().toISOString() })
        .eq("id", req.id);
      if (updateErr) {
        setApproveError(`Update error: ${updateErr.message}`);
      } else {
        await loadPending(); void loadHistory();
      }
    }
    setApprovingId(null);
  }

  async function handleReject(id: string) {
    if (!actorId) return;
    const client = getSupabaseClient(); if (!client) return;
    await client.from("workflow_requests").update({ status: "rejected", reviewed_by: actorId, reviewed_at: new Date().toISOString() }).eq("id", id);
    await loadPending();
  }

  const statusColor = (s: string) => s === "in_stock" ? GREEN : s === "transferred" ? BLUE : MUTED;
  const { widths: hw, onResizeStart: hResize } = useResizableColumns([150, 150, 110, null, 130, 150]);
  const histTableRef = useTableResize();

  return (
    <AppLayout>
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>

        {/* Page header */}
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ClipboardCheck size={16} color={INK} />
            <span style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Serial Corrections</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 4, padding: "1px 7px" }}>DC Admin only</span>
          </div>
          <span style={{ fontSize: 11, color: MUTED }}>All changes are audited and require peer approval.</span>
        </div>

        {/* Search bar — full width, prominent */}
        <form onSubmit={(e) => void handleSearch(e)} style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 0, border: `1px solid ${result ? BLUE : BORDER}`, borderRadius: 8, overflow: "hidden", boxShadow: result ? `0 0 0 3px rgba(37,99,235,.1)` : "none", transition: "box-shadow .15s" }}>
            <div style={{ display: "flex", alignItems: "center", paddingLeft: 14 }}>
              <Search size={15} color={MUTED} />
            </div>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setResult(null); setNotFound(false); }}
              placeholder="Search serial number to correct…"
              style={{ flex: 1, border: "none", outline: "none", padding: "11px 12px", fontSize: 14, fontFamily: "monospace", color: INK, background: "#fff" }}
            />
            <button type="submit" disabled={searching || !query.trim()}
              style={{ border: "none", background: BLUE, color: "#fff", padding: "0 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              {searching ? "Searching…" : "Find"}
            </button>
          </div>
          {notFound && <div style={{ marginTop: 8, fontSize: 12, color: RED }}>Serial "{query.trim()}" not found in inventory.</div>}
        </form>

        {/* Result card — inline, no nested boxes */}
        {result && !successMsg && (
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "16px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 20 }}>
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
              style={{ border: "none", background: BLUE, color: "#fff", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
              Correct serial
            </button>
          </div>
        )}

        {successMsg && (
          <div style={{ background: "#f0fdf4", border: `1px solid #bbf7d0`, borderRadius: 10, padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: GREEN }}>
            <Check size={15} /> {successMsg}
          </div>
        )}

        {/* Pending approvals */}
        {pending.length > 0 && (
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 20, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Clock size={13} color={AMBER} />
              <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Pending approval</span>
              <span style={{ fontSize: 11, fontWeight: 600, background: FAINT, color: MUTED, border: `1px solid ${BORDER}`, padding: "1px 8px", borderRadius: 4 }}>{pending.length}</span>
            </div>
            {approveError && (
              <div style={{ padding: "10px 20px", background: "#fef2f2", borderBottom: `1px solid #fecaca`, fontSize: 12, color: RED }}>
                {approveError}
              </div>
            )}
            {pending.map((req) => (
              <div key={req.id} style={{ padding: "12px 20px", borderBottom: `1px solid ${FAINT}`, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
                    {req.type === "part_reassignment" ? "Part" : "Serial"}
                  </span>
                  {req.type === "part_reassignment" ? (
                    <><code style={{ fontSize: 12, fontWeight: 700, color: RED }}>{req.payload.serial_number}</code>
                    <ArrowRight size={12} color={MUTED} />
                    <code style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{req.payload.new_part_number}</code></>
                  ) : (
                    <><code style={{ fontSize: 12, fontWeight: 700, color: RED }}>{req.payload.old_serial_number}</code>
                    <ArrowRight size={12} color={MUTED} />
                    <code style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{req.payload.new_serial_number}</code></>
                  )}
                  <span style={{ fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.payload.reason}</span>
                </div>
                <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>by {req.requester?.full_name ?? req.requester?.username ?? "—"}</span>
                <button type="button" onClick={() => void handleApprove(req)} disabled={approvingId === req.id}
                  style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: "none", background: BLUE, color: "#fff", cursor: approvingId === req.id ? "not-allowed" : "pointer", opacity: approvingId === req.id ? 0.5 : 1, flexShrink: 0 }}>
                  {approvingId === req.id ? "…" : "Approve"}
                </button>
                <button type="button" onClick={() => void handleReject(req.id)}
                  style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#fff", color: MUTED, cursor: "pointer", flexShrink: 0 }}>
                  Reject
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Correction history */}
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Correction history</span>
          </div>
          <div className="table-scroll">
            <table ref={histTableRef} style={{ tableLayout: "fixed", minWidth: 760 }}>
              <thead>
                <tr>
                  <ResizableTh width={hw[0]} onResizeStart={hResize(0)}>Old serial</ResizableTh>
                  <ResizableTh width={hw[1]} onResizeStart={hResize(1)}>New serial</ResizableTh>
                  <ResizableTh width={hw[2]} onResizeStart={hResize(2)}>Transfer</ResizableTh>
                  <ResizableTh width={hw[3]} onResizeStart={hResize(3)}>Reason</ResizableTh>
                  <ResizableTh width={hw[4]} onResizeStart={hResize(4)}>By</ResizableTh>
                  <ResizableTh width={hw[5]} onResizeStart={hResize(5)}>Date</ResizableTh>
                </tr>
              </thead>
              <tbody>
                {historyLoading && <tr><td colSpan={6} className="empty-row">Loading…</td></tr>}
                {!historyLoading && !history.length && <tr><td colSpan={6} className="empty-row">No corrections yet.</td></tr>}
                {history.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontFamily: "monospace", color: RED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.old_serial_number}>{row.old_serial_number}</td>
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
