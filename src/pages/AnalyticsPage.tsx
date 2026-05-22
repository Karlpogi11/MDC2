import { useState, useEffect, useRef } from "react";
import { useTableResize } from "@/components/ResizableColumns";
import { friendlyError } from "@/lib/friendlyError";
import { BarChart3, Upload, RefreshCw, TrendingUp } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useSites } from "@/hooks/useSites";

// Module-level cache — survives tab switches, cleared after TTL
const _cache: Record<string, { data: any; ts: number }> = {};
function getCached<T>(key: string, ttlMs: number): T | null {
  const entry = _cache[key];
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data as T;
  return null;
}
function setCached(key: string, data: any) {
  _cache[key] = { data, ts: Date.now() };
}
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { CSVDropZone } from "@/components/CSVDropZone";
import { ImportResult } from "@/components/ImportResult";
import { DatePicker } from "@/components/DatePicker";

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadRecord = { id: string; source_type: string; file_name: string; uploaded_at: string; row_count: number; status: string };
type RawRow = { part_number: string; site_code: string | null; used_at: string | null; qty: number };
type DCData = {
  kpi: { totalStockedIn: number; totalStockedOut: number; totalTransfers: number; receivedRate: number; totalAvailable: number; totalCommitted: number };
  monthly: { month: string; stockIn: number; stockOut: number }[];
  topParts: { part_number: string; part_name: string | null; qty: number }[];
  bySite: { site: string; qty: number }[];
  statusBreakdown: { name: string; value: number; pct: number; color: string }[];
};
type ColumnMapping = {
  part_number: string; qty: string; site_code: string; used_at: string;
  description: string;
};
type MappingState = {
  file: File; rawHeaders: string[]; headers: string[];
  preview: Record<string, string>[]; mapping: ColumnMapping; totalRows: number;
};

// ── Design tokens ─────────────────────────────────────────────────────────────

const INK        = "var(--text)";
const MUTED      = "var(--muted)";
const FAINT      = "var(--bg-surface-elevated)";
const BORDER     = "var(--line)";
const BLUE       = "var(--blue)";
const BLUE_LIGHT = "var(--bg-surface-elevated)";
const BLUE_MID   = "#3b82f6";
const SLATE      = "var(--muted)";
const GREEN      = "var(--text)";
const AMBER      = "var(--muted)";

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  function split(line: string): string[] {
    const r: string[] = []; let cur = ""; let q = false;
    for (const ch of line) {
      if (ch === '"') { q = !q; continue; }
      if (ch === delim && !q) { r.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    r.push(cur.trim()); return r;
  }
  const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

function normalizeFixably(row: Record<string, string>, uploadId: string) {
  return {
    upload_id: uploadId, source_type: "fixably",
    part_number: row.product_code || row.part_number || row.part_no || row.partno || row.sku || "",
    serial_number: row.serial_number || row.serial || row.imei || null,
    site_code: row.stock_name || row.location || row.site || row.store || null,
    used_at: row.date || row.repair_date || row.created_at?.slice(0, 10) || null,
    qty: parseInt(row.quantity || row.qty || row.count || "1") || 1,
  };
}
function normalizeGSX(row: Record<string, string>, uploadId: string) {
  return {
    upload_id: uploadId, source_type: "gsx",
    part_number: row.part_number || row.part_no || row.component_code || "",
    serial_number: row.device_serial || row.serial_number || row.serial || null,
    site_code: row.ship_to || row.location || row.service_provider || null,
    used_at: row.repair_date || row.date || row.completion_date?.slice(0, 10) || null,
    qty: parseInt(row.qty || row.quantity || "1") || 1,
  };
}

const TEMPLATE_FIXABLY = "part_number,serial_number,site_code,date,qty\n661-21000,F2LWX2QC4J9N,PODIUM,2026-05-01,1";
const TEMPLATE_GSX = "part_number,device_serial,ship_to,repair_date,qty\n661-21000,F2LWX2QC4J9N,PODIUM,2026-05-01,1";

function downloadTemplate(type: "fixably" | "gsx") {
  const blob = new Blob([type === "fixably" ? TEMPLATE_FIXABLY : TEMPLATE_GSX], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `mdc-${type}-template.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Auto-detect column mapping ────────────────────────────────────────────────

const PART_NUMBER_PATTERN = /^(PP|ZP|ZM|ZG)?[0-9]{3}-[0-9]+/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/;

function scoreColumn(key: string, values: string[]): Record<string, number> {
  const sample = values.filter(Boolean).slice(0, 20);
  const scores: Record<string, number> = { part_number: 0, qty: 0, site_code: 0, used_at: 0, description: 0 };
  const k = key.toLowerCase();
  if (/product_code|part_number|part_no|partno|sku|component_code|item_code|^part$/.test(k)) scores.part_number += 10;
  if (/quantity|qty|count|units|amount/.test(k)) scores.qty += 10;
  if (/stock_name|location|site|store|branch|ship_to|shipto|service_provider/.test(k)) scores.site_code += 10;
  if (/date|repair_date|created|completed|used_at|received/.test(k)) scores.used_at += 10;
  if (/description|product_description|part_name|part_desc|item_name|component_name/.test(k)) scores.description += 10;
  const partMatches = sample.filter((v) => PART_NUMBER_PATTERN.test(v.trim())).length;
  const dateMatches = sample.filter((v) => DATE_PATTERN.test(v.trim())).length;
  const avgLen = sample.reduce((s, v) => s + v.length, 0) / (sample.length || 1);
  scores.part_number += partMatches * 3;
  scores.used_at += dateMatches * 3;
  if (/quantity|qty|count|units|amount/.test(k)) scores.qty += sample.filter((v) => /^\d+$/.test(v.trim())).length * 2;
  if (avgLen > 10 && avgLen < 80 && partMatches === 0 && dateMatches === 0) scores.description += 2;
  return scores;
}

function autoDetectMapping(headers: string[], rows: Record<string, string>[]): ColumnMapping {
  const NONE = "__none__";
  const fieldScores: Record<string, Record<string, number>> = {};
  for (const h of headers) {
    const values = rows.map((r) => r[h] ?? "");
    fieldScores[h] = scoreColumn(h, values);
    const k = h.toLowerCase();
    if (/description|product_description|part_name|item_name|component_name/.test(k)) fieldScores[h].description = 10;
    const sample = rows.map((r) => r[h] ?? "").filter(Boolean).slice(0, 10);
    const avgLen = sample.reduce((s, v) => s + v.length, 0) / (sample.length || 1);
    if (avgLen > 15 && avgLen < 100) fieldScores[h].description = (fieldScores[h].description ?? 0) + 3;
  }
  const fields: (keyof ColumnMapping)[] = ["part_number", "qty", "used_at", "site_code", "description"];
  const assigned: ColumnMapping = { part_number: NONE, qty: NONE, site_code: NONE, used_at: NONE, description: NONE };
  const used = new Set<string>();
  for (const field of fields) {
    let best = NONE; let bestScore = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      const s = fieldScores[h][field] ?? 0;
      if (s > bestScore) { bestScore = s; best = h; }
    }
    if (bestScore > 0) { assigned[field] = best; used.add(best); }
  }
  return assigned;
}

function normalizeSiteCode(raw: string): string {
  const v = raw.trim();
  // Numeric codes: strip leading zeros so "0001272226" → "1272226" matches sites.ship_to_code
  if (/^\d+$/.test(v)) return v.replace(/^0+/, "") || "0";
  // Preserve full string — site name matching happens later via shipToSiteMap
  return v.toUpperCase();
}

function applyMapping(rows: Record<string, string>[], mapping: ColumnMapping, uploadId: string, sourceType: string, descLookup: Map<string, string>) {
  const NONE = "__none__";
  return rows.map((row) => {
    let part_number = (mapping.part_number !== NONE ? row[mapping.part_number] : "").trim();
    if (!part_number && mapping.description !== NONE) {
      const desc = (row[mapping.description] ?? "").trim().toLowerCase();
      if (desc) part_number = descLookup.get(desc) ?? desc;
    }
    if (!part_number) return null;
    const rawQty = mapping.qty !== NONE ? row[mapping.qty] : "1";
    const parsedQty = parseInt(rawQty);
    const qty = parsedQty > 0 ? parsedQty : 1;
    const rawSite = mapping.site_code !== NONE ? row[mapping.site_code] : "";
    const site_code = rawSite ? normalizeSiteCode(rawSite) : null;
    const rawDate = mapping.used_at !== NONE ? row[mapping.used_at] : "";
    // No date → null (excluded from analytics_summary which filters used_at is not null)
    // Reject clearly invalid years (future or before 2010)
    let used_at: string | null = rawDate ? rawDate.slice(0, 10) : null;
    if (used_at) {
      const yr = parseInt(used_at.slice(0, 4));
      const currentYr = new Date().getFullYear();
      if (yr > currentYr || yr < 2010) used_at = null;
    }
    return { upload_id: uploadId, source_type: sourceType, part_number, serial_number: null, site_code, used_at, qty };
  }).filter(Boolean) as { upload_id: string; source_type: string; part_number: string; serial_number: null; site_code: string | null; used_at: string | null; qty: number }[];
}

// ── Mapping Modal ─────────────────────────────────────────────────────────────

function MappingModal({ state, onConfirm, onCancel, importing }: { state: MappingState; onConfirm: (m: ColumnMapping) => void; onCancel: () => void; importing: boolean }) {
  const [mapping, setMapping] = useState<ColumnMapping>(state.mapping);
  const NONE = "__none__";
  const FIELDS: { key: keyof ColumnMapping; label: string; hint: string }[] = [
    { key: "part_number", label: "Part Number", hint: "e.g. 661-21991, product code" },
    { key: "description", label: "Description", hint: "Part name — used to look up part number" },
    { key: "qty",         label: "Quantity",    hint: "Leave unmapped if each row = 1 repair (most GSX/Fixably exports)" },
    { key: "site_code",   label: "Site",        hint: "Store, branch, or Ship-To number" },
    { key: "used_at",     label: "Date",        hint: "Repair or usage date" },
  ];
  const canConfirm = mapping.part_number !== NONE || mapping.description !== NONE;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", width: "100%", maxWidth: 660, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Map CSV Columns</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{state.file.name} · {state.totalRows.toLocaleString()} rows · Auto-detected below — review and correct if needed</div>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</label>
                <select value={mapping[f.key]} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  style={{ width: "100%", border: `1px solid ${mapping[f.key] !== NONE ? BLUE : BORDER}`, borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "inherit", background: "var(--bg-surface)", cursor: "pointer" }}>
                  <option value={NONE}>— not mapped —</option>
                  {state.rawHeaders.map((h, i) => <option key={i} value={state.headers[i]}>{h}</option>)}
                </select>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{f.hint}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Preview — first 3 rows</div>
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: FAINT }}>
                  {(["part_number","qty","site_code","used_at"] as const).map((f) => (
                    <th key={f} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                      {FIELDS.find((x) => x.key === f)?.label}
                      {mapping[f] !== NONE && <span style={{ color: "var(--muted)", fontWeight: 400 }}> ({mapping[f]})</span>}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {state.preview.map((row, i) => {
                    const pn   = mapping.part_number !== NONE ? row[mapping.part_number] : "";
                    const desc = mapping.description !== NONE ? row[mapping.description] : "";
                    const displayPn = pn || (desc ? `→ "${desc.slice(0, 28)}"` : "—");
                    const qty  = mapping.qty !== NONE ? row[mapping.qty] : "1 (default)";
                    const site = mapping.site_code !== NONE ? (row[mapping.site_code] ?? "—") : "—";
                    const date = mapping.used_at !== NONE ? (row[mapping.used_at]?.slice(0, 10) || "today") : "today";
                    return (
                      <tr key={i} style={{ borderBottom: i < 2 ? `1px solid ${FAINT}` : "none" }}>
                        <td style={{ padding: "5px 8px", fontFamily: pn ? "monospace" : "inherit", color: pn ? INK : MUTED, fontSize: pn ? 12 : 11 }}>{displayPn}</td>
                        <td style={{ padding: "5px 8px", color: INK }}>{qty}</td>
                        <td style={{ padding: "5px 8px", color: MUTED }}>{site}</td>
                        <td style={{ padding: "5px 8px", color: MUTED }}>{date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} disabled={importing}
              style={{ border: `1px solid ${BORDER}`, background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: MUTED }}>Cancel</button>
            <button type="button" onClick={() => onConfirm(mapping)} disabled={!canConfirm || importing}
              style={{ border: "none", background: canConfirm ? BLUE : "#e2e8f0", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: canConfirm ? "pointer" : "not-allowed", color: canConfirm ? "#fff" : "#94a3b8" }}>
              {importing ? "Importing…" : `Import ${state.totalRows.toLocaleString()} rows`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Panel({ title, subtitle, action, children, noPad }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; noPad?: boolean }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, letterSpacing: "-0.01em" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      <div style={noPad ? {} : { padding: 20 }}>{children}</div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent, delta }: { label: string; value: string; sub: string; accent?: boolean; delta?: string }) {
  return (
    <div style={{ background: accent ? "var(--blue)" : "var(--bg-surface)", border: `1px solid ${accent ? "var(--blue)" : "var(--line)"}`, borderRadius: "var(--radius)", padding: "16px 18px" }}>
      <div style={{ fontSize: 11, color: accent ? "rgba(255,255,255,.7)" : "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent ? "#fff" : "var(--text)", marginTop: 6, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 11, color: accent ? "rgba(255,255,255,.6)" : "var(--muted)", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      {children}
    </div>
  );
}

function Empty({ msg = "No data yet." }: { msg?: string }) {
  return <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>{msg}</div>;
}
function Spinner() {
  return <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontSize: 13 }}>Loading…</div>;
}
function RefreshBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={loading}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", color: loading ? "var(--muted)" : "var(--text)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1 }}>
      <RefreshCw size={11} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
      {loading ? "Loading…" : "Refresh"}
    </button>
  );
}

function SeriesChips({ list, selected, onChange }: {
  list: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]);
  const label = selected.length === 0 ? "All series" : selected.length === 1 ? selected[0] : `${selected.length} series`;
  const hasFilter = selected.length > 0;
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${hasFilter ? BLUE : BORDER}`, borderRadius: "var(--radius)", padding: "0 12px", fontSize: 13, fontWeight: 500, cursor: "pointer", background: hasFilter ? BLUE : "#fff", color: hasFilter ? "#fff" : INK, height: 34, minWidth: 140, justifyContent: "space-between" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{label}</span>
        <span style={{ fontSize: 10, color: hasFilter ? "rgba(255,255,255,.7)" : SLATE, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100, background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", boxShadow: "0 8px 24px rgba(0,0,0,.1)", minWidth: 220, maxHeight: 320, overflowY: "auto", padding: "6px 0" }}>
            {selected.length < list.length && (
              <button type="button" onClick={() => { onChange([...list]); setOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 10px", fontSize: 12, color: BLUE, background: "transparent", border: "none", cursor: "pointer", borderBottom: `1px solid ${BORDER}`, marginBottom: 4 }}>
                Select all
              </button>
            )}
            {selected.length > 0 && (
              <button type="button" onClick={() => { onChange([]); setOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 10px", fontSize: 12, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", borderBottom: `1px solid ${BORDER}`, marginBottom: 4 }}>
                Clear selection
              </button>
            )}
            {list.map((s) => {
              const active = selected.includes(s);
              return (
                <button key={s} type="button" onClick={() => toggle(s)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "4px 10px", fontSize: 13, background: active ? BLUE_LIGHT : "transparent", border: "none", cursor: "pointer", color: active ? BLUE : INK, fontWeight: active ? 600 : 400 }}>
                  <span style={{ width: 14, height: 14, border: `1.5px solid ${active ? BLUE : BORDER}`, borderRadius: "var(--radius-sm)", background: active ? BLUE : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {active && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>}
                  </span>
                  {s}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Enterprise SVG Charts ─────────────────────────────────────────────────────

const W = 600;
/** Area + line chart — enterprise time series with typography hierarchy */
function AreaChart({ data, keys, height = 200 }: {
  data: Record<string, string | number>[];
  keys: { key: string; label: string; color: string }[];
  height?: number;
}) {
  if (!data.length) return <Empty />;
  // Single data point — render stat card instead of empty chart
  if (data.length === 1) {
    const month = String(data[0].month ?? data[0].site ?? "");
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height, gap: 8 }}>
        {keys.map((k) => (
          <div key={k.key} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: INK, letterSpacing: "-1px" }}>{Number(data[0][k.key] ?? 0).toLocaleString()}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{k.label} · {month}</div>
          </div>
        ))}
      </div>
    );
  }
  const pad = { t: 24, r: 24, b: 44, l: 52 };
  const cw = W - pad.l - pad.r;
  const ch = height - pad.t - pad.b;
  const maxVal = Math.max(...data.flatMap((d) => keys.map((k) => Number(d[k.key] ?? 0))), 1);
  const niceMax = (() => {
    const mag = Math.pow(10, Math.floor(Math.log10(maxVal)));
    const norm = maxVal / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  })();
  const ticks = 4;
  const px = (i: number) => pad.l + (i / (data.length - 1 || 1)) * cw;
  const py = (v: number) => pad.t + ch - (v / niceMax) * ch;

  // Peak index for annotation
  const peakIdx = data.reduce((best, d, i) => {
    const v = keys.reduce((s, k) => s + Number(d[k.key] ?? 0), 0);
    const bv = keys.reduce((s, k) => s + Number(data[best][k.key] ?? 0), 0);
    return v > bv ? i : best;
  }, 0);
  const peakVal = keys.reduce((s, k) => s + Number(data[peakIdx][k.key] ?? 0), 0);
  const peakLabel = peakVal >= 1000000 ? `${(peakVal/1000000).toFixed(1)}M` : peakVal >= 1000 ? `${(peakVal/1000).toFixed(1)}k` : peakVal.toLocaleString();
  const peakX = px(peakIdx); const peakY = py(peakVal);
  const flipPeak = peakX > W * 0.65;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", display: "block" }}>
      <defs>
        {keys.map((k) => (
          <linearGradient key={k.key} id={`grad-${k.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={k.color} stopOpacity="0.16" />
            <stop offset="60%" stopColor={k.color} stopOpacity="0.04" />
            <stop offset="100%" stopColor={k.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {/* Y grid — ultra-light, data is the hero */}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (niceMax / ticks) * (ticks - i);
        const y = pad.t + (ch / ticks) * i;
        const lbl = v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(v%1000===0?0:1)}k` : String(Math.round(v));
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y}
              stroke="currentColor" strokeOpacity={i === ticks ? 0.15 : 0.07} strokeWidth={i === ticks ? 1 : 0.75} />
            {/* Y labels: 9px, 70% opacity — supporting info */}
            <text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.4} fontFamily="system-ui">{lbl}</text>
          </g>
        );
      })}

      {/* Area gradient fill */}
      {keys.map((k) => {
        if (data.length < 2) return null;
        const pts = data.map((d, i) => `${px(i)},${py(Number(d[k.key]??0))}`);
        const area = `M${pts[0]} ${pts.slice(1).map(p=>`L${p}`).join(" ")} L${px(data.length-1)},${pad.t+ch} L${px(0)},${pad.t+ch} Z`;
        return <path key={k.key} d={area} fill={`url(#grad-${k.key})`} />;
      })}

      {/* Line — 2px, crisp */}
      {keys.map((k) => {
        if (data.length < 2) return null;
        const d = data.map((row, i) => `${i===0?"M":"L"}${px(i)},${py(Number(row[k.key]??0))}`).join(" ");
        return <path key={k.key} d={d} fill="none" stroke={k.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
      })}

      {/* Peak annotation — LARGE value (dominant), tiny "peak" label (supporting) */}
      <circle cx={peakX} cy={peakY} r={4} fill={keys[0].color} stroke="currentColor" strokeOpacity={0.3} strokeWidth={2} />
      <text x={peakX + (flipPeak ? -10 : 10)} y={peakY - 10} textAnchor={flipPeak ? "end" : "start"}
        fontSize={15} fontWeight="800" fill="currentColor" fontFamily="system-ui" letterSpacing="-0.5">{peakLabel}</text>
      <text x={peakX + (flipPeak ? -10 : 10)} y={peakY + 4} textAnchor={flipPeak ? "end" : "start"}
        fontSize={9} fill={MUTED} opacity={0.6} fontFamily="system-ui">peak</text>

      {/* Last point dot */}
      {keys.map((k) => {
        const val = Number(data[data.length-1]?.[k.key] ?? 0);
        return <circle key={k.key} cx={px(data.length-1)} cy={py(val)} r={3} fill={k.color} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />;
      })}

      {/* X labels — month names, year at Jan */}
      {data.map((d, i) => {
        const lbl = String(d.month ?? d.site ?? "").slice(0, 7); // "2025-07"
        const [yr, mo] = lbl.split("-");
        const isJan = mo === "01";
        const isFirst = i === 0;
        const isLast = i === data.length - 1;
        const dense = data.length > 14;
        const show = dense
          ? (isJan || isFirst || isLast || i % 3 === 0)
          : true;
        if (!show) return null;
        const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(mo, 10) - 1] ?? mo;
        const display = (isJan || isFirst) ? `${monthName} ${yr}` : monthName;
        return (
          <g key={i}>
            {(isJan && !isFirst) && <line x1={px(i)} x2={px(i)} y1={pad.t + ch} y2={pad.t + ch + 4} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} />}
            <text x={px(i)} y={height - pad.b + 15} textAnchor="middle"
              fontSize={(isJan || isFirst) ? 10 : 9}
              fontWeight={(isJan || isFirst) ? "600" : "400"}
              fill="currentColor"
              opacity={(isJan || isFirst) ? 0.6 : 0.4}
              fontFamily="system-ui">{display}</text>
          </g>
        );
      })}

      {/* Legend — top-right, small, muted */}
      {keys.length > 1 && (
        <g transform={`translate(${W - pad.r}, ${pad.t - 8})`}>
          {keys.map((k, i) => (
            <g key={i} transform={`translate(${-i * 110}, 0)`}>
              <line x1={-18} x2={-6} y1={0} y2={0} stroke={k.color} strokeWidth={2} opacity={0.8} />
              <text x={-22} y={4} textAnchor="end" fontSize={9} fill={MUTED} opacity={0.7} fontFamily="system-ui">{k.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/** Ranked horizontal bar — two-line label: part# + description */
function RankedBar({ data, height: _height }: { data: { name: string; value: number; label?: string }[]; height?: number }) {
  if (!data.length) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const rowH = 50;
  const labelW = 188;
  const valW = 52;
  const svgW = 520;
  const barW = svgW - labelW - valW - 8;
  const H = data.length * rowH + 4;

  return (
    <svg viewBox={`0 0 ${svgW} ${H}`} style={{ width: "100%", display: "block" }}>
      {data.map((d, i) => {
        const y = i * rowH;
        const bw = Math.max(3, (d.value / maxVal) * barW);
        const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
        const desc = d.label && d.label !== d.name ? d.label : null;
        const displayName = desc ?? d.name;
        const truncated = displayName.length > 26 ? displayName.slice(0, 26) + "…" : displayName;
        return (
          <g key={i}>
            {/* rank */}
            <text x={0} y={y + 30} fontSize={10} fontWeight="700" fill="#94a3b8" fontFamily="system-ui">#{i + 1}</text>
            {/* part number (if has desc) */}
            {desc && <text x={18} y={y + 17} fontSize={9} fill="#94a3b8" fontFamily="monospace">{d.name}</text>}
            {/* name */}
            <text x={18} y={desc ? y + 31 : y + 30} fontSize={11} fontWeight={i < 3 ? "600" : "400"} fill={INK} fontFamily="system-ui">{truncated}</text>
            {/* track */}
            <rect x={labelW} y={y + 20} width={barW} height={10} fill="#f1f5f9" rx={3} />
            {/* bar */}
            <rect x={labelW} y={y + 20} width={bw} height={10} fill={BLUE} rx={3} />
            {/* value */}
            <text x={labelW + barW + 6} y={y + 30} fontSize={11} fontWeight="600" fill={INK} fontFamily="system-ui">{d.value.toLocaleString()}</text>
            {/* pct */}
            <text x={svgW} y={y + 30} textAnchor="end" fontSize={9} fill={MUTED} fontFamily="system-ui">{pct}%</text>
          </g>
        );
      })}
    </svg>
  );
}

function SiteBar({ data }: { data: { name: string; value: number }[] }) {
  if (!data.length) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const rowH = 38;
  const labelW = 160;
  const valW = 52;
  const svgW = 520;
  const barW = svgW - labelW - valW - 8;
  const H = data.length * rowH + 4;

  return (
    <svg viewBox={`0 0 ${svgW} ${H}`} style={{ width: "100%", display: "block" }}>
      {data.map((d, i) => {
        const y = i * rowH;
        const bw = Math.max(3, (d.value / maxVal) * barW);
        const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
        const name = d.name.length > 22 ? d.name.slice(0, 22) + "…" : d.name;
        return (
          <g key={i}>
            <text x={0} y={y + 24} fontSize={11} fontWeight={i === 0 ? "600" : "400"} fill={INK} fontFamily="system-ui">{name}</text>
            <rect x={labelW} y={y + 13} width={barW} height={10} fill="#f1f5f9" rx={3} />
            <rect x={labelW} y={y + 13} width={bw} height={10} fill={BLUE} rx={3} />
            <text x={labelW + barW + 6} y={y + 23} fontSize={11} fontWeight="600" fill={INK} fontFamily="system-ui">{d.value.toLocaleString()}</text>
            <text x={svgW} y={y + 23} textAnchor="end" fontSize={9} fill={MUTED} fontFamily="system-ui">{pct}%</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Donut — large center number (dominant), small label (supporting), legend with opacity */
function DonutChart({ data, centerLabel }: { data: { name: string; value: number; color: string }[]; centerLabel?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty />;
  const size = 160; const cx = size / 2; const cy = size / 2;
  const R = 64; const ri = 40;
  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const sweep = (d.value / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle); const y1 = cy + R * Math.sin(angle);
    angle += sweep;
    const x2 = cx + R * Math.cos(angle); const y2 = cy + R * Math.sin(angle);
    const xi1 = cx + ri * Math.cos(angle - sweep); const yi1 = cy + ri * Math.sin(angle - sweep);
    const xi2 = cx + ri * Math.cos(angle); const yi2 = cy + ri * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return { ...d, path: `M${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} L${xi2},${yi2} A${ri},${ri} 0 ${large},0 ${xi1},${yi1} Z` };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }}>
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color}><title>{s.name}: {s.value.toLocaleString()}</title></path>)}
        {/* Center: LARGE number (dominant) + tiny label (supporting) */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={22} fontWeight="800" fill={INK} fontFamily="system-ui" letterSpacing="-1">{total.toLocaleString()}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9} fill={MUTED} opacity={0.65} fontFamily="system-ui" letterSpacing="0.5">{(centerLabel ?? "total").toUpperCase()}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {data.map((d, i) => {
          const op = Math.max(0.5, 1 - i * 0.12);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, opacity: op }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
              {/* Name: small, muted */}
              <span style={{ fontSize: 11, color: MUTED, flex: 1, lineHeight: 1.3 }}>{d.name}</span>
              {/* Value: bold, dominant */}
              <span style={{ fontSize: 14, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>{d.value.toLocaleString()}</span>
              {/* Pct: small, very muted */}
              <span style={{ fontSize: 10, color: MUTED, width: 36, textAlign: "right", opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{Math.round(d.value / total * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const abcTableRef = useTableResize();
  const velTableRef = useTableResize();
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.user.id : null;
  const role = authState.status === "authenticated" ? authState.profile.role : null;

  const [activeTab, setActiveTab] = useState<"dc" | "upload" | "demand" | "abc" | "velocity">("dc");
  const { data: sites = [] } = useSites();

  // Upload
  const [sourceType, setSourceType] = useState<"fixably" | "gsx">("fixably");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [mappingState, setMappingState] = useState<MappingState | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

  // DC Activity
  const [dcData, setDcData] = useState<DCData | null>(null);
  const [dcLoading, setDcLoading] = useState(false);
  const [dcError, setDcError] = useState<string | null>(null);

  // Demand
  const [demandFrom, setDemandFrom] = useState("");
  const [demandTo, setDemandTo] = useState("");
  const [demandSite, setDemandSite] = useState("");
  const [demandSeries, setDemandSeries] = useState<string[]>([]);
  const [demandData, setDemandData] = useState<{
    kpi: { totalRepairs: number; uniqueParts: number; topSite: string | null };
    monthly: { month: string; qty: number }[];
    topParts: { name: string; value: number; label: string }[];
    bySite: { name: string; value: number }[];
    isFiltered: boolean;
  } | null>(null);
  const [demandLoading, setDemandLoading] = useState(false);

  // ABC
  const [abcSeries, setAbcSeries] = useState<string[]>([]);
  const [abcData, setAbcData] = useState<{
    donut: { name: string; value: number; color: string }[];
    rows: { part_number: string; part_name: string | null; total_qty: number; tier: "A" | "B" | "C" }[];
  } | null>(null);
  const [abcLoading, setAbcLoading] = useState(false);

  // Velocity
  const [velSeries, setVelSeries] = useState<string[]>([]);
  const [velData, setVelData] = useState<{
    donut: { name: string; value: number; color: string }[];
    rows: { part_number: string; part_name: string | null; total_qty: number; days_since_last: number | null; category: "fast" | "slow" | "dead" }[];
  } | null>(null);
  const [velLoading, setVelLoading] = useState(false);

  // Auto-detected device series list
  const [seriesList, setSeriesList] = useState<string[]>([]);

  const sel: React.CSSProperties = { border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, outline: "none", fontFamily: "inherit", background: "var(--bg-surface)", cursor: "pointer" };

  // ── Loaders ──────────────────────────────────────────────────────────────────

  async function loadUploads() {
    const cached = getCached<UploadRecord[]>("uploads", 60_000);
    if (cached) { setUploads(cached); setUploadsLoading(false); return; }
    const client = getSupabaseClient(); if (!client) return;
    const { data } = await client.from("analytics_uploads").select("id,source_type,file_name,uploaded_at,row_count,status").order("uploaded_at", { ascending: false }).limit(20);
    const rows = (data ?? []) as UploadRecord[];
    setCached("uploads", rows);
    setUploads(rows);
    setUploadsLoading(false);
  }

  async function loadSeriesList() {
    const cached = getCached<string[]>("seriesList", 10 * 60_000);
    if (cached) { setSeriesList(cached); return; }
    const client = getSupabaseClient(); if (!client) return;
    // Get distinct part names from analytics_summary, extract device series
    const { data } = await client.from("analytics_summary").select("part_name").limit(2000);
    const names = (data ?? []).map((r: any) => r.part_name ?? "").filter(Boolean) as string[];
    // Known Apple device series patterns — ordered by specificity
    const PATTERNS = [
      "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16 Plus", "iPhone 16",
      "iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15 Plus", "iPhone 15",
      "iPhone 14 Pro Max", "iPhone 14 Pro", "iPhone 14 Plus", "iPhone 14",
      "iPhone 13 Pro Max", "iPhone 13 Pro", "iPhone 13 mini", "iPhone 13",
      "iPhone 12 Pro Max", "iPhone 12 Pro", "iPhone 12 mini", "iPhone 12",
      "iPhone 11 Pro Max", "iPhone 11 Pro", "iPhone 11",
      "iPhone XS Max", "iPhone XS", "iPhone XR", "iPhone X",
      "iPhone SE",
      "iPad Pro", "iPad Air", "iPad mini", "iPad",
      "MacBook Pro", "MacBook Air", "MacBook",
      "Apple Watch",
    ];
    const found = new Set<string>();
    for (const name of names) {
      for (const p of PATTERNS) {
        if (name.toLowerCase().includes(p.toLowerCase())) { found.add(p); break; }
      }
    }
    // Sort by PATTERNS order
    const sorted = PATTERNS.filter((p) => found.has(p));
    setSeriesList(sorted);
    setCached("seriesList", sorted);
  }

  async function loadDC() {
    const cached = getCached<any>("dcData", 2 * 60_000);
    if (cached) { setDcData(cached); setDcLoading(false); return; }
    setDcLoading(true); setDcError(null);
    const client = getSupabaseClient(); if (!client) { setDcLoading(false); return; }
    const [siRes, trRes, tiRes, snapRes] = await Promise.all([
      client.from("serial_numbers").select("stock_in_at").order("stock_in_at", { ascending: true }).limit(50000),
      client.from("transfers").select("id,status,created_at,destination_site:sites!destination_site_id(site_name)").neq("status", "cancelled").limit(10000),
      client.from("transfer_items").select("qty,part:parts(part_number,part_name),transfer:transfers(status,created_at)").limit(50000),
      client.from("inventory_snapshot").select("in_stock,committed,available"),
    ]);
    if (siRes.error || trRes.error || tiRes.error) {
      setDcError((siRes.error ?? trRes.error ?? tiRes.error)!.message);
      setDcLoading(false); return;
    }
    const serials   = (siRes.data ?? []) as { stock_in_at: string }[];
    const transfers = (trRes.data ?? []) as { id: string; status: string; created_at: string; destination_site: any }[];
    const items     = (tiRes.data ?? []) as { qty: number; part: any; transfer: any }[];
    const snap      = (snapRes.data ?? []) as { in_stock: number; committed: number; available: number }[];
    const totalInStock  = snap.reduce((s, r) => s + (r.in_stock ?? 0), 0);
    const totalCommitted = snap.reduce((s, r) => s + (r.committed ?? 0), 0);
    const totalAvailable = snap.reduce((s, r) => s + (r.available ?? 0), 0);

    const siByMonth = new Map<string, number>();
    for (const s of serials) { const m = s.stock_in_at?.slice(0, 7) ?? "?"; siByMonth.set(m, (siByMonth.get(m) ?? 0) + 1); }
    const soByMonth = new Map<string, number>();
    for (const item of items) {
      const t = Array.isArray(item.transfer) ? item.transfer[0] : item.transfer;
      if (!t || t.status === "cancelled") continue;
      const m = t.created_at?.slice(0, 7) ?? "?";
      soByMonth.set(m, (soByMonth.get(m) ?? 0) + (item.qty ?? 1));
    }
    const allMonths = [...new Set([...siByMonth.keys(), ...soByMonth.keys()])].sort();
    const monthly = allMonths.map((month) => ({ month, stockIn: siByMonth.get(month) ?? 0, stockOut: soByMonth.get(month) ?? 0 }));

    const partMap = new Map<string, { part_name: string | null; qty: number }>();
    for (const item of items) {
      const t = Array.isArray(item.transfer) ? item.transfer[0] : item.transfer;
      if (!t || t.status === "cancelled") continue;
      const part = Array.isArray(item.part) ? item.part[0] : item.part;
      if (!part?.part_number) continue;
      const ex = partMap.get(part.part_number);
      if (ex) ex.qty += item.qty ?? 1;
      else partMap.set(part.part_number, { part_name: part.part_name ?? null, qty: item.qty ?? 1 });
    }
    const topParts = [...partMap.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10).map(([pn, v]) => ({ part_number: pn, part_name: v.part_name, qty: v.qty }));

    const siteMap = new Map<string, number>();
    for (const t of transfers) {
      const dest = Array.isArray(t.destination_site) ? t.destination_site[0] : t.destination_site;
      const name = dest?.site_name ?? "Unknown";
      siteMap.set(name, (siteMap.get(name) ?? 0) + 1);
    }
    const bySite = [...siteMap.entries()].sort((a, b) => b[1] - a[1]).map(([site, qty]) => ({ site, qty }));

    const sc = { draft: 0, packed: 0, in_transit: 0, received: 0 };
    for (const t of transfers) { if (t.status in sc) sc[t.status as keyof typeof sc]++; }
    const total = transfers.length;
    const statusBreakdown = [
      { name: "Received",   value: sc.received,   color: GREEN,   pct: total ? Math.round(sc.received / total * 100) : 0 },
      { name: "In Transit", value: sc.in_transit,  color: BLUE,    pct: total ? Math.round(sc.in_transit / total * 100) : 0 },
      { name: "Packed",     value: sc.packed,      color: "var(--muted)", pct: total ? Math.round(sc.packed / total * 100) : 0 },
      { name: "Draft",      value: sc.draft,       color: SLATE,   pct: total ? Math.round(sc.draft / total * 100) : 0 },
    ].filter((s) => s.value > 0);

    const received = transfers.filter((t) => t.status === "received").length;
    const dcResult = {
      kpi: { totalStockedIn: serials.length, totalStockedOut: items.reduce((s, i) => s + (i.qty ?? 1), 0), totalTransfers: total, receivedRate: total ? Math.round(received / total * 100) : 0, totalAvailable, totalCommitted },
      monthly, topParts, bySite, statusBreakdown,
    };
    setCached("dcData", dcResult);
    setDcData(dcResult);
    setDcLoading(false);
  }

  async function loadDemand() {
    setDemandLoading(true);
    const client = getSupabaseClient(); if (!client) { setDemandLoading(false); return; }

    // Build site_code → site_name lookup (also covers ship_to_code as fallback for old data)
    const { data: siteRows } = await client.from("sites").select("site_name, site_code, ship_to_code");
    const siteNameMap = new Map<string, string>();
    for (const s of (siteRows ?? []) as { site_name: string; site_code: string; ship_to_code: string | null }[]) {
      siteNameMap.set(s.site_code, s.site_name);
      if (s.ship_to_code) siteNameMap.set(s.ship_to_code, s.site_name); // fallback for old numeric codes
    }

    let q = client.from("analytics_summary").select("part_number,part_name,site_code,month,total_qty");
    if (demandFrom) q = q.gte("month", `${demandFrom.slice(0, 7)}-01`);
    if (demandTo)   q = q.lte("month", `${demandTo.slice(0, 7)}-01`);
    if (!demandTo) {
      const now = new Date();
      const cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      q = q.lt("month", cutoff);
    }
    if (demandSite)   q = q.eq("site_code", demandSite);
    if (demandSeries.length === 1) q = q.ilike("part_name", `%${demandSeries[0]}%`);
    else if (demandSeries.length > 1) q = q.or(demandSeries.map((s) => `part_name.ilike.%${s}%`).join(","));

    const { data } = await q.limit(100000);
    const rows = (data ?? []) as { part_number: string; part_name: string | null; site_code: string | null; month: string; total_qty: number }[];

    const isFiltered = !!(demandFrom || demandTo);
    const monthMap = new Map<string, number>();
    const partMap  = new Map<string, { name: string; qty: number }>();
    const siteMap  = new Map<string, number>();

    for (const r of rows) {
      // Always group by month for the chart
      const m = r.month?.slice(0, 7) ?? "?";
      monthMap.set(m, (monthMap.get(m) ?? 0) + r.total_qty);
      const ex = partMap.get(r.part_number);
      if (ex) ex.qty += r.total_qty;
      else partMap.set(r.part_number, { name: r.part_name ?? r.part_number, qty: r.total_qty });
      if (r.site_code) {
        const siteName = siteNameMap.get(r.site_code) ?? r.site_code;
        siteMap.set(siteName, (siteMap.get(siteName) ?? 0) + r.total_qty);
      }
    }

    const monthly  = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, qty]) => ({ month, qty }));
    const topParts = [...partMap.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10).map(([pn, v]) => ({ name: pn, value: v.qty, label: v.name !== pn ? v.name : pn }));
    const bySite   = [...siteMap.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
    const topSite  = bySite[0]?.name ?? null;

    setDemandData({ kpi: { totalRepairs: rows.reduce((s, r) => s + r.total_qty, 0), uniqueParts: partMap.size, topSite }, monthly, topParts, bySite, isFiltered });
    setDemandLoading(false);
  }

  async function loadABC() {
    setAbcLoading(true);
    const client = getSupabaseClient(); if (!client) { setAbcLoading(false); return; }
    let q = client.from("analytics_by_part").select("part_number,part_name,total_qty").order("total_qty", { ascending: false }).limit(2000);
    if (abcSeries.length === 1) q = q.ilike("part_name", `%${abcSeries[0]}%`);
    else if (abcSeries.length > 1) q = q.or(abcSeries.map((s) => `part_name.ilike.%${s}%`).join(","));
    const { data } = await q;
    const rows = (data ?? []) as { part_number: string; part_name: string | null; total_qty: number }[];
    const total = rows.reduce((s, r) => s + r.total_qty, 0);
    let cum = 0;
    const classified = rows.map((r) => {
      cum += r.total_qty;
      const pct = total > 0 ? cum / total : 0;
      const tier: "A" | "B" | "C" = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
      return { ...r, tier };
    });
    const tc = { A: 0, B: 0, C: 0 };
    for (const r of classified) tc[r.tier]++;
    setAbcData({
      donut: [
        { name: "A — Critical (top 80%)", value: tc.A, color: GREEN },
        { name: "B — Important (next 15%)", value: tc.B, color: BLUE },
        { name: "C — Low (bottom 5%)", value: tc.C, color: SLATE },
      ],
      rows: classified,
    });
    setAbcLoading(false);
  }

  async function loadVelocity() {
    setVelLoading(true);
    const client = getSupabaseClient(); if (!client) { setVelLoading(false); return; }
    let q = client.from("analytics_by_part").select("part_number,part_name,total_qty,last_used").order("last_used", { ascending: false, nullsFirst: false }).limit(2000);
    if (velSeries.length === 1) q = q.ilike("part_name", `%${velSeries[0]}%`);
    else if (velSeries.length > 1) q = q.or(velSeries.map((s) => `part_name.ilike.%${s}%`).join(","));
    const { data } = await q;
    const now = Date.now();
    const rows = (data ?? []).map((r: any) => {
      const daysSince = r.last_used ? Math.floor((now - new Date(r.last_used).getTime()) / 86400000) : null;
      const category: "fast" | "slow" | "dead" = daysSince === null ? "dead" : daysSince <= 30 ? "fast" : daysSince <= 90 ? "slow" : "dead";
      return { part_number: r.part_number, part_name: r.part_name, total_qty: r.total_qty, days_since_last: daysSince, category };
    });
    const vc = { fast: 0, slow: 0, dead: 0 };
    for (const r of rows) vc[r.category]++;
    setVelData({
      donut: [
        { name: "Fast — used ≤30 days ago", value: vc.fast, color: GREEN },
        { name: "Slow — used 31–90 days ago", value: vc.slow, color: AMBER },
        { name: "Dead — 90+ days or never", value: vc.dead, color: SLATE },
      ],
      rows,
    });
    setVelLoading(false);
  }

  useEffect(() => {
    void loadUploads();
    void loadDC();
    void loadSeriesList();
    setDemandData(null);
  }, []);

  useEffect(() => {
    if (activeTab === "abc"      && !abcLoading)  void loadABC();
    if (activeTab === "velocity" && !velLoading)  void loadVelocity();
  }, [activeTab, abcSeries, velSeries]);

  // ── Upload handlers ───────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    if (!actorId) return;
    if (file.size > 20 * 1024 * 1024) { setImportResult({ added: 0, skipped: 0, errors: ["File must be under 20MB."] }); return; }
    setImportResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) { setImportResult({ added: 0, skipped: 0, errors: ["No rows found in file."] }); return; }
    const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const firstLine = clean.trim().split("\n")[0];
    const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
    const rawHeaders = firstLine.split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));
    const headers = rawHeaders.map((h) => h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
    setMappingState({ file, rawHeaders, headers, preview: rows.slice(0, 3), mapping: autoDetectMapping(headers, rows), totalRows: rows.length });
  }

  async function deleteUpload(id: string) {
    if (!confirm("Delete this upload and all its data? This cannot be undone.")) return;
    setDeletingUploadId(id);
    const client = getSupabaseClient(); if (!client) { setDeletingUploadId(null); return; }
    await client.from("analytics_uploads").delete().eq("id", id);
    setUploads((prev) => prev.filter((u) => u.id !== id));
    setDeletingUploadId(null);
    setDemandData(null);
  }

  async function confirmImport(mapping: ColumnMapping) {
    if (!actorId || !mappingState) return;
    setImporting(true);
    const client = getSupabaseClient(); if (!client) { setImporting(false); return; }
    const text = await mappingState.file.text();
    const rows = parseCSV(text);
    const NONE = "__none__";

    // Build ship_to_code → site_code lookup so we store site_code, not raw ship-to numbers
    const { data: siteRows } = await client.from("sites").select("site_code, site_name, ship_to_code");
    const shipToSiteMap = new Map<string, string>();
    for (const s of (siteRows ?? []) as { site_code: string; site_name: string; ship_to_code: string | null }[]) {
      // Exact site_code match
      shipToSiteMap.set(s.site_code.toUpperCase(), s.site_code);
      // ship_to numeric code
      if (s.ship_to_code) shipToSiteMap.set(s.ship_to_code.replace(/^0+/, "") || "0", s.site_code);
      // Full site_name match (e.g. "MOBILECARE - THE PODIUM")
      shipToSiteMap.set(s.site_name.toUpperCase().trim(), s.site_code);
      // Partial: last segment after " - " (e.g. "THE PODIUM")
      const parts = s.site_name.split(/\s*-\s*/);
      if (parts.length > 1) shipToSiteMap.set(parts[parts.length - 1].toUpperCase().trim(), s.site_code);
    }

    const descLookup = new Map<string, string>();
    if (mapping.description !== NONE) {
      const descs = [...new Set(rows.map((r) => (r[mapping.description] ?? "").trim()).filter(Boolean))];
      const chunks = Array.from({ length: Math.ceil(descs.length / 100) }, (_, i) => descs.slice(i * 100, i * 100 + 100));
      const results = await Promise.all(chunks.map((chunk) => client.from("parts").select("part_number,part_name").in("part_name", chunk)));
      for (const { data: parts } of results)
        for (const p of (parts ?? []) as { part_number: string; part_name: string }[]) descLookup.set(p.part_name.toLowerCase(), p.part_number);
    }
    const { data: upload, error: ue } = await client.from("analytics_uploads").insert({ source_type: sourceType, file_name: mappingState.file.name, file_path: "", uploaded_by: actorId, row_count: rows.length, status: "processing" }).select("id").single();
    if (ue || !upload) { setImportResult({ added: 0, skipped: 0, errors: [ue?.message ?? "Upload failed."] }); setImporting(false); setMappingState(null); return; }

    const normalized = applyMapping(rows, mapping, upload.id, sourceType, descLookup)
      .map((r) => ({
        ...r,
        // Resolve location name / ship_to number → site_code
        // Try: exact full string → last segment after " - " → numeric strip → raw
        site_code: r.site_code ? (() => {
          const raw = r.site_code.trim();
          const upper = raw.toUpperCase();
          if (shipToSiteMap.has(upper)) return shipToSiteMap.get(upper)!;
          const lastSeg = upper.split(/\s*-\s*/).pop()?.trim() ?? "";
          if (lastSeg && shipToSiteMap.has(lastSeg)) return shipToSiteMap.get(lastSeg)!;
          const stripped = raw.replace(/^0+/, "") || "0";
          return shipToSiteMap.get(stripped) ?? shipToSiteMap.get(raw) ?? raw;
        })() : null,
      }));
    const errors: string[] = []; let added = 0;
    // Insert all chunks in parallel (max 5 concurrent to avoid overwhelming the DB)
    const chunks = Array.from({ length: Math.ceil(normalized.length / 500) }, (_, i) => normalized.slice(i * 500, i * 500 + 500));
    const CONCURRENCY = 5;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((chunk) => client.from("analytics_rows").insert(chunk)));
      for (const { error } of results) {
        if (error) errors.push(friendlyError(error));
        else added += 500;
      }
      if (errors.length) break;
    }
    added = Math.min(added, normalized.length);
    await client.from("analytics_uploads").update({ status: errors.length ? "error" : "done", row_count: added, error_message: errors[0] ?? null }).eq("id", upload.id);
    setImportResult({ added, skipped: rows.length - normalized.length, errors });

    // Delete all previous uploads (cascade deletes their analytics_rows)
    // Only keep the one we just created
    if (!errors.length) {
      await client.from("analytics_uploads").delete().neq("id", upload.id);
      // Refresh analytics_summary via RPC
      await client.rpc("refresh_analytics_summary");
    }

    setImporting(false); setMappingState(null);
    void loadUploads();
    setDemandData(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const TABS = [
    { key: "dc",       label: "DC Activity" },
    { key: "upload",   label: "Upload" },
    { key: "demand",   label: "Repair Demand" },
    { key: "abc",      label: "ABC Analysis" },
    { key: "velocity", label: "Stock Velocity" },
  ] as const;

  return (
    <AppLayout>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <BarChart3 size={18} color={BLUE} />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Analytics</h1>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, marginBottom: 28 }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
              style={{ border: "none", borderRadius: 0, background: "transparent", padding: "5px 12px", fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", color: activeTab === t.key ? "var(--blue)" : "var(--muted)", borderBottom: activeTab === t.key ? "2px solid var(--blue)" : "2px solid transparent", marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── DC Activity ──────────────────────────────────────────────────── */}
        {activeTab === "dc" && (
          <div style={{ display: "grid", gap: 20 }}>
            {dcError && <div style={{ background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 16px", color: "var(--muted)", fontSize: 13 }}>Error: {dcError}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              {dcLoading
                ? [1,2,3,4].map((i) => <div key={i} style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", height: 100 }} />)
                : dcData ? [
                    { label: "Available Now",    value: dcData.kpi.totalAvailable.toLocaleString(),  sub: "units ready to dispatch",       accent: false },
                    { label: "In Transit",       value: dcData.kpi.totalCommitted.toLocaleString(),  sub: "units in active transfers",      accent: false },
                    { label: "Transfer Orders",  value: dcData.kpi.totalTransfers.toLocaleString(),  sub: "all non-cancelled",              accent: false },
                    { label: "Receipt Rate",     value: `${dcData.kpi.receivedRate}%`,               sub: "confirmed received by sites",    accent: false },
                  ].map((k) => <KpiCard key={k.label} {...k} />) : null
              }
            </div>

            {/* Top parts + Status side by side — works with any amount of data */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <Panel title="Most Transferred Parts" subtitle="Parts with highest outbound volume" action={<RefreshBtn onClick={() => void loadDC()} loading={dcLoading} />}>
                {dcLoading ? <Spinner /> : !dcData?.topParts.length ? <Empty msg="No transfers yet." /> : (
                  <RankedBar data={dcData.topParts.map((p) => ({ name: p.part_number, value: p.qty, label: p.part_name ?? p.part_number }))} />
                )}
              </Panel>
              <Panel title="Transfer Status" subtitle="Breakdown of all non-cancelled transfers">
                {dcLoading ? <Spinner /> : !dcData?.statusBreakdown.length ? <Empty msg="No transfers yet." /> : (
                  <DonutChart data={dcData.statusBreakdown} centerLabel="transfers" />
                )}
              </Panel>
            </div>

            {/* Transfers by site */}
            <Panel title="Transfers by Destination Site" subtitle="Number of transfer orders per site">
              {dcLoading ? <Spinner /> : !dcData?.bySite.length ? <Empty msg="No transfers yet." /> : (
                <SiteBar data={dcData.bySite.map((s) => ({ name: s.site, value: s.qty }))} />
              )}
            </Panel>

            {/* Monthly trend — only shown when 2+ months of data exist */}
            {dcData && dcData.monthly.length >= 2 && (
              <Panel title="Stock-In vs Dispatched — Monthly Trend" subtitle="Serials received at DC vs units dispatched over time">
                <AreaChart data={dcData.monthly} keys={[{ key: "stockIn", label: "Stocked In", color: BLUE }, { key: "stockOut", label: "Dispatched", color: SLATE }]} height={220} />
              </Panel>
            )}
          </div>
        )}

        {/* ── Upload ───────────────────────────────────────────────────────── */}
        {activeTab === "upload" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <Panel title="Upload repair data" subtitle="Fixably or GSX export CSV — columns auto-detected">
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["fixably", "gsx"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setSourceType(t)}
                    style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", background: sourceType === t ? BLUE : "#fff", color: sourceType === t ? "#fff" : INK }}>
                    {t === "fixably" ? "Fixably" : "GSX"}
                  </button>
                ))}
              </div>
              <CSVDropZone onFile={(f) => void handleFile(f)} onTemplate={() => downloadTemplate(sourceType)} importing={importing} label={`Import ${sourceType === "fixably" ? "Fixably" : "GSX"} CSV`} />
              {importResult && <div style={{ marginTop: 12 }}><ImportResult added={importResult.added} skipped={importResult.skipped} errors={importResult.errors} /></div>}
              <div style={{ marginTop: 14, padding: "10px 14px", background: FAINT, borderRadius: "var(--radius)", fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
                <strong style={{ color: INK }}>Note:</strong> Rows with no date column are excluded from trend analysis.
                Invalid years (before 2010 or future) are also excluded.
                After upload, analytics refresh every 15 minutes automatically.
              </div>
            </Panel>

            <Panel title="Current upload" subtitle="Only the latest upload is active — importing a new file replaces this one" noPad>
              <div style={{ overflowY: "auto", maxHeight: 360 }}>
                {uploadsLoading && <div style={{ padding: 20, color: MUTED, fontSize: 13 }}>Loading…</div>}
                {!uploadsLoading && !uploads.length && <div style={{ padding: 20, color: MUTED, fontSize: 13 }}>No upload yet. Import a Fixably or GSX file to begin.</div>}
                {uploads.map((u) => (
                  <div key={u.id} style={{ padding: "12px 20px", borderBottom: `1px solid ${FAINT}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.file_name}>{u.file_name}</div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{fmtDate(u.uploaded_at)} · {u.row_count.toLocaleString()} rows</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--bg-surface-elevated)", color: "var(--muted)", border: "1px solid var(--line)" }}>{u.source_type}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: u.status === "done" ? "var(--bg-surface-elevated)" : u.status === "error" ? "var(--bg-surface-elevated)" : "var(--bg-surface-elevated)", color: u.status === "done" ? "var(--text)" : u.status === "error" ? "var(--negative)" : "var(--muted)", border: "1px solid var(--line)" }}>
                        {u.status === "done" ? "✓ active" : u.status}
                      </span>
                      <button type="button" onClick={() => void deleteUpload(u.id)} disabled={deletingUploadId === u.id} title="Delete upload and all its data"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", padding: "2px 6px", fontSize: 16, lineHeight: 1, opacity: deletingUploadId === u.id ? 0.4 : 0.5 }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {/* ── Repair Demand ─────────────────────────────────────────────────── */}
        {activeTab === "demand" && (
          <div style={{ display: "grid", gap: 20 }}>
            {/* Filters — single flat toolbar, no nested containers */}
            <div style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "16px 20px", display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <FilterField label="From">
                <DatePicker value={demandFrom} onChange={setDemandFrom} />
              </FilterField>
              <FilterField label="To">
                <DatePicker value={demandTo} onChange={setDemandTo} />
              </FilterField>
              <FilterField label="Site">
                <select value={demandSite} onChange={(e) => setDemandSite(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "0 10px", fontSize: 13, outline: "none", fontFamily: "inherit", background: "var(--bg-surface)", cursor: "pointer", height: 34, color: demandSite ? INK : MUTED, minWidth: 160 }}>
                  <option value="">All sites</option>
                  {sites.map((s) => <option key={s.id} value={s.ship_to_code ?? s.site_code}>{s.site_name}</option>)}
                </select>
              </FilterField>
              <FilterField label="Device Series">
                <SeriesChips list={seriesList} selected={demandSeries} onChange={setDemandSeries} />
              </FilterField>
              <button type="button" onClick={() => void loadDemand()} disabled={demandLoading} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, background: demandLoading ? "#f1f5f9" : BLUE, color: demandLoading ? MUTED : "#fff", border: "none", borderRadius: "var(--radius)", padding: "0 20px", fontSize: 13, fontWeight: 600, cursor: demandLoading ? "not-allowed" : "pointer", height: 34, whiteSpace: "nowrap", alignSelf: "flex-end" }}>
                <TrendingUp size={13} /> {demandLoading ? "Loading…" : "Run Analysis"}
              </button>
            </div>

            {demandData && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                <KpiCard label="Total Parts Used" value={demandData.kpi.totalRepairs.toLocaleString()} sub="across all uploaded data" />
                <KpiCard label="Unique Parts" value={demandData.kpi.uniqueParts.toLocaleString()} sub="distinct part numbers" />
                <KpiCard label="Top Site" value={demandData.kpi.topSite ?? "—"} sub="highest repair volume" />
              </div>
            )}

            <Panel title="Monthly Repair Volume" subtitle="Parts consumed per month">
              {demandLoading ? <Spinner /> : !demandData ? <Empty msg="Select filters and click Run Analysis." /> : !demandData.monthly.length ? <Empty msg="No data for selected filters." /> : (
                <AreaChart data={demandData.monthly.map((d) => ({ month: d.month, qty: d.qty }))} keys={[{ key: "qty", label: "Parts used", color: BLUE }]} height={220} />
              )}
            </Panel>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <Panel title="Top 10 Parts by Demand" subtitle="Highest consumption volume">
                {demandLoading ? <Spinner /> : !demandData?.topParts.length ? <Empty /> : (
                  <RankedBar data={demandData.topParts} />
                )}
              </Panel>
              <Panel title="Usage by Site" subtitle="Total parts consumed per site">
                {demandLoading ? <Spinner /> : !demandData?.bySite.length ? <Empty msg="No site data — ensure uploads include site/Ship-To column." /> : (
                  <SiteBar data={demandData.bySite} />
                )}
              </Panel>
            </div>
          </div>
        )}

        {/* ── ABC Analysis ──────────────────────────────────────────────────── */}
        {activeTab === "abc" && (
          <div style={{ display: "grid", gap: 20 }}>
            {/* Series filter */}
            {seriesList.length > 0 && (
              <div style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "16px 20px", display: "flex", alignItems: "flex-end", gap: 16 }}>
                <FilterField label="Device Series">
                  <SeriesChips list={seriesList} selected={abcSeries} onChange={(v) => { setAbcSeries(v); setAbcData(null); }} />
                </FilterField>
                <div style={{ marginLeft: "auto" }}><RefreshBtn onClick={() => void loadABC()} loading={abcLoading} /></div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 20 }}>
              <Panel title="ABC Distribution" subtitle="Part count by tier — based on repair demand" action={<RefreshBtn onClick={() => void loadABC()} loading={abcLoading} />}>
                {abcLoading ? <Spinner /> : !abcData ? <Empty /> : <DonutChart data={abcData.donut} centerLabel="parts" />}
              </Panel>
              {abcData && (
                <Panel title="Tier Summary" subtitle="A = top 80% of repair volume · B = next 15% · C = bottom 5%">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {(["A","B","C"] as const).map((tier) => {
                      const count = abcData.rows.filter((r) => r.tier === tier).length;
                      const vol   = abcData.rows.filter((r) => r.tier === tier).reduce((s, r) => s + r.total_qty, 0);
                      const color = tier === "A" ? GREEN : tier === "B" ? BLUE : SLATE;
                      const bg    = tier === "A" ? "var(--bg-surface-elevated)" : tier === "B" ? BLUE_LIGHT : FAINT;
                      return (
                        <div key={tier} style={{ background: bg, border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "18px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.07em" }}>Tier {tier}</div>
                          <div style={{ fontSize: 28, fontWeight: 800, color: INK, marginTop: 8, letterSpacing: "-0.02em" }}>{count}</div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>{vol.toLocaleString()} units used</div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </div>
            {abcData && (
              <Panel title="Part Classification List" noPad>
                <div className="table-scroll">
                  <table ref={abcTableRef}>
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th>Part number</th>
                        <th>Part name</th>
                        <th className="num">Total qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Map(abcData.rows.map((r) => [r.part_number, r])).values()).slice(0, 100).map((r) => {
                        const color = r.tier === "A" ? GREEN : r.tier === "B" ? BLUE : SLATE;
                        const bg    = r.tier === "A" ? "var(--bg-surface-elevated)" : r.tier === "B" ? BLUE_LIGHT : FAINT;
                        return (
                          <tr key={r.part_number}>
                            <td><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius)", background: bg, color }}>{r.tier}</span></td>
                            <td style={{ fontFamily: "monospace", fontSize: 12, color: BLUE }}>{r.part_number}</td>
                            <td style={{ overflow: "hidden", textOverflow: "ellipsis", color: MUTED }}>{r.part_name ?? "—"}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{r.total_qty.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        )}

        {/* ── Stock Velocity ────────────────────────────────────────────────── */}
        {activeTab === "velocity" && (
          <div style={{ display: "grid", gap: 20 }}>
            {seriesList.length > 0 && (
              <div style={{ background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "16px 20px", display: "flex", alignItems: "flex-end", gap: 16 }}>
                <FilterField label="Device Series">
                  <SeriesChips list={seriesList} selected={velSeries} onChange={(v) => { setVelSeries(v); setVelData(null); }} />
                </FilterField>
                <div style={{ marginLeft: "auto" }}><RefreshBtn onClick={() => void loadVelocity()} loading={velLoading} /></div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 20 }}>
              <Panel title="Velocity Breakdown" subtitle="Parts classified by recency of last repair use" action={<RefreshBtn onClick={() => void loadVelocity()} loading={velLoading} />}>
                {velLoading ? <Spinner /> : !velData ? <Empty /> : <DonutChart data={velData.donut} centerLabel="parts" />}
              </Panel>
              {velData && (
                <Panel title="Movement Summary" subtitle="Fast ≤30d · Slow 31–90d · Dead 90d+">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {velData.donut.map((d) => {
                      const bg = d.color === GREEN ? "var(--bg-surface-elevated)" : d.color === AMBER ? "var(--bg-surface-elevated)" : FAINT;
                      return (
                        <div key={d.name} style={{ background: bg, border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "18px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: d.color, textTransform: "uppercase", letterSpacing: "0.07em" }}>{d.name.split(" ")[0]}</div>
                          <div style={{ fontSize: 28, fontWeight: 800, color: INK, marginTop: 8, letterSpacing: "-0.02em" }}>{d.value}</div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>parts</div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </div>
            {velData && (
              <Panel title="Part Velocity Detail" noPad>
                <div className="table-scroll">
                  <table ref={velTableRef} style={{ tableLayout: "fixed", minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Part #</th>
                        <th>Description</th>
                        <th className="num">Qty Used</th>
                        <th className="num">Days Since Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Map(velData.rows.map((r) => [r.part_number, r])).values()).slice(0, 100).map((r) => {
                        const color = r.category === "fast" ? GREEN : r.category === "slow" ? AMBER : SLATE;
                        const bg    = r.category === "fast" ? "var(--bg-surface-elevated)" : r.category === "slow" ? "var(--bg-surface-elevated)" : FAINT;
                        return (
                          <tr key={r.part_number}>
                            <td><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius)", background: bg, color }}>{r.category}</span></td>
                            <td style={{ fontFamily: "monospace", fontSize: 12, color: BLUE }}>{r.part_number}</td>
                            <td style={{ overflow: "hidden", textOverflow: "ellipsis", color: MUTED }}>{r.part_name ?? "—"}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{r.total_qty.toLocaleString()}</td>
                            <td className="num" style={{ color: MUTED }}>{r.days_since_last ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        )}

      </main>

      {mappingState && (
        <MappingModal state={mappingState} onConfirm={(m) => void confirmImport(m)} onCancel={() => setMappingState(null)} importing={importing} />
      )}
    </AppLayout>
  );
}






