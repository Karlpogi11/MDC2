import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTableResize } from "@/components/ResizableColumns";
import { friendlyError } from "@/lib/friendlyError";
import { BarChart3, Upload, RefreshCw, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useSites } from "@/hooks/useSites";
import { normalizeCsvHeader, parseCSV, parseDelimitedRows } from "@/lib/csv";

import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { CSVDropZone } from "@/components/CSVDropZone";
import { ImportResult } from "@/components/ImportResult";
import { DatePicker } from "@/components/DatePicker";

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadRecord = { id: string; sourceType: string; fileName: string; uploadedAt: string; rowCount: number; status: string };
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
    <div style={{ minWidth: 0, background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
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

function formatCompactNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

/** Area + line chart — compact, responsive, and label-safe */
function AreaChart({ data, keys, height = 190 }: {
  data: Record<string, string | number>[];
  keys: { key: string; label: string; color: string }[];
  height?: number;
}) {
  if (!data.length) return <Empty />;
  // Single data point — render stat card instead of empty chart
  if (data.length === 1) {
    const month = String(data[0].month ?? data[0].site ?? "");
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, alignItems: "stretch", minHeight: height }}>
        {keys.map((k) => (
          <div key={k.key} style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: height - 24, padding: "14px 16px", background: "var(--bg-surface-elevated)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)" }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: INK, letterSpacing: "-0.04em", lineHeight: 1 }}>{Number(data[0][k.key] ?? 0).toLocaleString()}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>{k.label} · {month}</div>
          </div>
        ))}
      </div>
    );
  }
  const pad = { t: 18, r: 20, b: 34, l: 46 };
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
  const dense = data.length > 10;
  const labelStep = data.length > 24 ? 4 : data.length > 12 ? 3 : 2;
  const showPeak = keys.length === 1 && data.length <= 8;

  // Peak index for annotation
  const peakIdx = showPeak ? data.reduce((best, d, i) => {
    const v = Number(d[keys[0].key] ?? 0);
    const bv = Number(data[best][keys[0].key] ?? 0);
    return v > bv ? i : best;
  }, 0) : 0;
  const peakVal = showPeak ? Number(data[peakIdx][keys[0].key] ?? 0) : 0;
  const peakLabel = showPeak ? formatCompactNumber(peakVal) : "";
  const peakX = showPeak ? px(peakIdx) : 0;
  const peakY = showPeak ? py(peakVal) : 0;
  const flipPeak = showPeak ? peakX > W * 0.68 : false;

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
        const lbl = formatCompactNumber(Math.round(v));
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y}
              stroke="currentColor" strokeOpacity={i === ticks ? 0.15 : 0.07} strokeWidth={i === ticks ? 1 : 0.75} />
            {/* Y labels: 9px, 70% opacity — supporting info */}
            <text x={pad.l - 8} y={y + 3} textAnchor="end" fontSize={8} fill="currentColor" opacity={0.4} fontFamily="system-ui">{lbl}</text>
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

      {showPeak && (
        <>
          {/* Peak annotation only on sparse, single-series charts to avoid clutter */}
          <circle cx={peakX} cy={peakY} r={4} fill={keys[0].color} stroke="currentColor" strokeOpacity={0.3} strokeWidth={2} />
          <text x={peakX + (flipPeak ? -10 : 10)} y={peakY - 10} textAnchor={flipPeak ? "end" : "start"}
            fontSize={14} fontWeight="800" fill="currentColor" fontFamily="system-ui" letterSpacing="-0.4">{peakLabel}</text>
          <text x={peakX + (flipPeak ? -10 : 10)} y={peakY + 4} textAnchor={flipPeak ? "end" : "start"}
            fontSize={9} fill={MUTED} opacity={0.6} fontFamily="system-ui">peak</text>
        </>
      )}

      {/* Last point dot */}
      {keys.map((k) => {
        const val = Number(data[data.length-1]?.[k.key] ?? 0);
        return <circle key={k.key} cx={px(data.length-1)} cy={py(val)} r={3} fill={k.color} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />;
      })}

      {/* X labels — month names, year at Jan */}
      {data.map((d, i) => {
        const lbl = String(d.month ?? d.site ?? "").slice(0, 7); // "2025-07"
        const [yr, mo] = lbl.split("-");
        const monthIndex = Number.parseInt(mo, 10);
        if (!yr || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) return null;
        const isJan = monthIndex === 1;
        const isFirst = i === 0;
        const isLast = i === data.length - 1;
        const show = dense
          ? (isJan || isFirst || isLast || i % labelStep === 0)
          : true;
        if (!show) return null;
        const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][monthIndex - 1] ?? mo;
        const display = (isJan || isFirst) ? `${monthName} ${yr}` : monthName;
        return (
          <g key={i}>
            {(isJan && !isFirst) && <line x1={px(i)} x2={px(i)} y1={pad.t + ch} y2={pad.t + ch + 4} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} />}
            <text x={px(i)} y={height - pad.b + 15} textAnchor="middle"
              fontSize={(isJan || isFirst) ? 9.5 : 8.5}
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

/** Ranked list — clear volume ranking without implying progress */
function RankedBar({ data }: { data: { name: string; value: number; label?: string }[]; height?: number }) {
  if (!data.length) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px minmax(0, 1fr) auto auto",
          gap: 10,
          alignItems: "center",
          padding: "0 0 2px",
          color: MUTED,
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        <div />
        <div />
        <div style={{ textAlign: "right" }}>Count</div>
        <div style={{ textAlign: "right" }}>%</div>
      </div>
      {data.map((d, i) => {
        const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
        const desc = d.label && d.label !== d.name ? d.label : null;
        const displayName = desc ?? d.name;
        return (
          <div
            key={`${d.name}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "32px minmax(0, 1fr) auto auto",
              gap: 10,
              alignItems: "center",
              padding: "8px 0",
              borderBottom: i < data.length - 1 ? `1px solid ${BORDER}` : "none",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: "var(--bg-surface)",
                border: `1px solid ${BORDER}`,
                color: MUTED,
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              #{i + 1}
            </div>

            <div style={{ minWidth: 0 }}>
              {desc && (
                <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace", lineHeight: 1.3, overflowWrap: "anywhere" }}>
                  {d.name}
                </div>
              )}
              <div
                style={{
                  fontSize: 11,
                  fontWeight: i < 3 ? 700 : 600,
                  color: INK,
                  lineHeight: 1.35,
                  overflowWrap: "anywhere",
                }}
                title={displayName}
              >
                {displayName}
              </div>
            </div>

            <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>
              {d.value.toLocaleString()}
            </div>

            <div style={{ textAlign: "right", fontSize: 10, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
              {pct}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SiteBar({ data }: { data: { name: string; value: number }[] }) {
  if (!data.length) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  const maxRows = 10;
  const top = data.length > maxRows
    ? [...data.slice(0, maxRows - 1), { name: "Other", value: data.slice(maxRows - 1).reduce((s, d) => s + d.value, 0) }]
    : data;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto auto",
          gap: 10,
          alignItems: "center",
          padding: "0 0 2px",
          color: MUTED,
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        <div />
        <div style={{ textAlign: "right" }}>Count</div>
        <div style={{ textAlign: "right" }}>%</div>
      </div>
      {top.map((d, i) => {
        const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
        return (
          <div
            key={`${d.name}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto auto",
              gap: 10,
              alignItems: "center",
              padding: "8px 0",
              borderBottom: i < top.length - 1 ? `1px solid ${BORDER}` : "none",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: INK, lineHeight: 1.35, overflowWrap: "anywhere" }} title={d.name}>
                {d.name}
              </div>
            </div>

            <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>
              {d.value.toLocaleString()}
            </div>

            <div style={{ textAlign: "right", fontSize: 10, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
              {pct}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Donut — large center number (dominant), small label (supporting), legend with opacity */
function DonutChart({ data, centerLabel }: { data: { name: string; value: number; color: string }[]; centerLabel?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty />;
  const size = 148; const cx = size / 2; const cy = size / 2;
  const R = 60; const ri = 38;
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
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flex: "0 0 auto" }}>
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color}><title>{s.name}: {s.value.toLocaleString()}</title></path>)}
        {/* Center: LARGE number (dominant) + tiny label (supporting) */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={20} fontWeight="800" fill={INK} fontFamily="system-ui" letterSpacing="-0.8">{total.toLocaleString()}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={8.5} fill={MUTED} opacity={0.65} fontFamily="system-ui" letterSpacing="0.6">{(centerLabel ?? "total").toUpperCase()}</text>
      </svg>
      <div style={{ display: "grid", gap: 8, flex: "1 1 220px", minWidth: 220 }}>
        {data.map((d, i) => {
          const op = Math.max(0.5, 1 - i * 0.12);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "8px minmax(0, 1fr) auto auto", alignItems: "center", gap: 8, opacity: op }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
              {/* Name: small, muted */}
              <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.35, minWidth: 0, overflowWrap: "anywhere" }}>{d.name}</span>
              {/* Value: bold, dominant */}
              <span style={{ fontSize: 13, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>{d.value.toLocaleString()}</span>
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
  const actorId = authState.status === "authenticated" ? authState.profile.id : null;
  const role = authState.status === "authenticated" ? authState.profile.role : null;

  const [activeTab, setActiveTab] = useState<"dc" | "upload" | "demand" | "abc" | "velocity">("dc");
  const { data: sites = [] } = useSites();

  // Upload
  const [sourceType, setSourceType] = useState<"fixably" | "gsx">("fixably");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);
  const [mappingState, setMappingState] = useState<MappingState | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

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

  const queryClient = useQueryClient();

  const sel: React.CSSProperties = { border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, outline: "none", fontFamily: "inherit", background: "var(--bg-surface)", cursor: "pointer" };

  const uploadsQuery = useQuery<UploadRecord[]>({
    queryKey: ["analytics", "uploads"],
    queryFn: loadUploads,
    staleTime: 60_000,
  });
  const dcQuery = useQuery<DCData, Error>({
    queryKey: ["analytics", "dc-activity"],
    queryFn: loadDC,
    staleTime: 2 * 60_000,
  });
  const seriesQuery = useQuery<string[]>({
    queryKey: ["analytics", "series-list"],
    queryFn: loadSeriesList,
    staleTime: 10 * 60_000,
  });

  const uploads = uploadsQuery.data ?? [];
  const uploadsLoading = uploadsQuery.isLoading;
  const dcData = dcQuery.data ?? null;
  const dcLoading = dcQuery.isFetching;
  const dcError = dcQuery.error?.message ?? null;
  const seriesList = seriesQuery.data ?? [];

  // ── Loaders ──────────────────────────────────────────────────────────────────

  async function loadUploads(): Promise<UploadRecord[]> {
    const data = await api.get("/analytics/uploads");
    return (data ?? []) as UploadRecord[];
  }

  async function loadSeriesList(): Promise<string[]> {
    const data = await api.get("/analytics/series-list");
    return (data ?? []) as string[];
  }

  async function loadDC(): Promise<DCData> {
    const data = await api.get("/analytics/dc-activity");
    return data as DCData;
  }

  async function loadDemand() {
    setDemandLoading(true);
    try {
      const params = new URLSearchParams();
      if (demandFrom) params.set("from", demandFrom.slice(0, 7));
      if (demandTo) params.set("to", demandTo.slice(0, 7));
      if (demandSite) params.set("site_code", demandSite);
      if (demandSeries.length === 1) params.set("series", demandSeries[0]);
      else if (demandSeries.length > 1) params.set("series", demandSeries.join(","));

      const data = await api.get("/analytics/demand?" + params.toString());
      setDemandData(data);
    } finally {
      setDemandLoading(false);
    }
  }

  async function loadABC() {
    setAbcLoading(true);
    try {
      const params = new URLSearchParams();
      if (abcSeries.length === 1) params.set("series", abcSeries[0]);
      else if (abcSeries.length > 1) params.set("series", abcSeries.join(","));
      const data = await api.get("/analytics/abc?" + params.toString());
      setAbcData(data);
    } finally {
      setAbcLoading(false);
    }
  }

  async function loadVelocity() {
    setVelLoading(true);
    try {
      const params = new URLSearchParams();
      if (velSeries.length === 1) params.set("series", velSeries[0]);
      else if (velSeries.length > 1) params.set("series", velSeries.join(","));
      const data = await api.get("/analytics/velocity?" + params.toString());
      setVelData(data);
    } finally {
      setVelLoading(false);
    }
  }

  useEffect(() => {
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
    const rawHeaders = parseDelimitedRows(text)[0] ?? [];
    const headers = rawHeaders.map(normalizeCsvHeader);
    setMappingState({ file, rawHeaders, headers, preview: rows.slice(0, 3), mapping: autoDetectMapping(headers, rows), totalRows: rows.length });
  }

  async function deleteUpload(id: string) {
    if (!confirm("Delete this upload and all its data? This cannot be undone.")) return;
    setDeletingUploadId(id);
    await api.delete(`/analytics/uploads/${id}`);
    await queryClient.invalidateQueries({ queryKey: ["analytics", "uploads"] });
    setDeletingUploadId(null);
    setDemandData(null);
  }

  async function confirmImport(mapping: ColumnMapping) {
    if (!actorId || !mappingState) return;
    setImporting(true);
    const text = await mappingState.file.text();
    const rows = parseCSV(text);
    try {
      const result = await api.post("/analytics/uploads", {
        source_type: sourceType,
        file_name: mappingState.file.name,
        uploaded_by: actorId,
        mapping: {
          part_number: mapping.part_number,
          qty: mapping.qty,
          site_code: mapping.site_code,
          used_at: mapping.used_at,
          description: mapping.description,
        },
        rows,
      });
      setImportResult({ added: result.added ?? 0, skipped: result.skipped ?? 0, errors: result.errors ?? [] });
    } catch (e: any) {
      setImportResult({ added: 0, skipped: 0, errors: [e?.message ?? "Import failed."] });
    }
    setImporting(false); setMappingState(null);
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
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
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 40px" }}>

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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "stretch" }}>
              <Panel title="Most Transferred Parts" subtitle="Parts with highest outbound volume" action={<RefreshBtn onClick={() => void dcQuery.refetch()} loading={dcLoading} />}>
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
                <AreaChart data={dcData.monthly} keys={[{ key: "stockIn", label: "Stocked In", color: BLUE }, { key: "stockOut", label: "Dispatched", color: SLATE }]} height={200} />
              </Panel>
            )}
          </div>
        )}

        {/* ── Upload ───────────────────────────────────────────────────────── */}
        {activeTab === "upload" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
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
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.fileName}>{u.fileName}</div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{fmtDate(u.uploadedAt)} · {u.rowCount.toLocaleString()} rows</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--bg-surface-elevated)", color: "var(--muted)", border: "1px solid var(--line)" }}>{u.sourceType}</span>
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
                  {sites.map((s) => <option key={s.id} value={s.shipToCode ?? s.siteCode}>{s.siteName}</option>)}
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                <KpiCard label="Total Parts Used" value={demandData.kpi.totalRepairs.toLocaleString()} sub="across all uploaded data" />
                <KpiCard label="Unique Parts" value={demandData.kpi.uniqueParts.toLocaleString()} sub="distinct part numbers" />
                <KpiCard label="Top Site" value={demandData.kpi.topSite ?? "—"} sub="highest repair volume" />
              </div>
            )}

            <Panel title="Monthly Repair Volume" subtitle="Parts consumed per month">
              {demandLoading ? <Spinner /> : !demandData ? <Empty msg="Select filters and click Run Analysis." /> : !demandData.monthly.length ? <Empty msg="No data for selected filters." /> : (
                <AreaChart data={demandData.monthly.map((d) => ({ month: d.month, qty: d.qty }))} keys={[{ key: "qty", label: "Parts used", color: BLUE }]} height={200} />
              )}
            </Panel>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "stretch" }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "stretch" }}>
              <Panel title="ABC Distribution" subtitle="Part count by tier — based on repair demand" action={<RefreshBtn onClick={() => void loadABC()} loading={abcLoading} />}>
                {abcLoading ? <Spinner /> : !abcData ? <Empty /> : <DonutChart data={abcData.donut} centerLabel="parts" />}
              </Panel>
              {abcData && (
                <Panel title="Tier Summary" subtitle="A = top 80% of repair volume · B = next 15% · C = bottom 5%">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "stretch" }}>
              <Panel title="Velocity Breakdown" subtitle="Parts classified by recency of last repair use" action={<RefreshBtn onClick={() => void loadVelocity()} loading={velLoading} />}>
                {velLoading ? <Spinner /> : !velData ? <Empty /> : <DonutChart data={velData.donut} centerLabel="parts" />}
              </Panel>
              {velData && (
                <Panel title="Movement Summary" subtitle="Fast ≤30d · Slow 31–90d · Dead 90d+">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
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
