import { useState, useEffect } from "react";
import { BarChart3, Upload } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { CSVDropZone } from "@/components/CSVDropZone";
import { ImportResult } from "@/components/ImportResult";
import { DatePicker } from "@/components/DatePicker";

type UploadRecord = {
  id: string;
  source_type: string;
  file_name: string;
  uploaded_at: string;
  row_count: number;
  status: string;
};

type TrendRow = {
  part_number: string;
  part_name: string | null;
  site_code: string | null;
  total_qty: number;
  last_used: string | null;
};

// ── CSV parsers ───────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const firstLine = lines[0];
  const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  function splitLine(line: string): string[] {
    const result: string[] = []; let cur = ""; let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === delim && !inQuote) { result.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    result.push(cur.trim()); return result;
  }
  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

// Normalize Fixably row → analytics_rows insert shape
function normalizeFixably(row: Record<string, string>, uploadId: string) {
  return {
    upload_id: uploadId,
    source_type: "fixably",
    part_number: row.part_number || row.part_no || row.partno || row.sku || "",
    serial_number: row.serial_number || row.serial || row.imei || null,
    site_code: row.location || row.site || row.store || null,
    used_at: row.date || row.repair_date || row.created_at?.slice(0, 10) || null,
    qty: parseInt(row.qty || row.quantity || "1") || 1,
  };
}

// Normalize GSX row → analytics_rows insert shape
function normalizeGSX(row: Record<string, string>, uploadId: string) {
  return {
    upload_id: uploadId,
    source_type: "gsx",
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
  const content = type === "fixably" ? TEMPLATE_FIXABLY : TEMPLATE_GSX;
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `mdc-${type}-template.csv`; a.click();
  URL.revokeObjectURL(url);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export function AnalyticsPage() {
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.user.id : null;

  const [activeTab, setActiveTab] = useState<"upload" | "trend" | "abc" | "velocity">("upload");
  const [sites, setSites] = useState<{ id: string; site_name: string; site_code: string }[]>([]);

  const [sourceType, setSourceType] = useState<"fixably" | "gsx">("fixably");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);

  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);

  // Trend filters
  const [trendFrom, setTrendFrom] = useState("");
  const [trendTo, setTrendTo] = useState("");
  const [trendSite, setTrendSite] = useState("");
  const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  // ABC / velocity
  const [abcRows, setAbcRows] = useState<(TrendRow & { tier: "A" | "B" | "C" })[]>([]);
  const [abcLoading, setAbcLoading] = useState(false);
  const [velocityRows, setVelocityRows] = useState<(TrendRow & { days_since_last: number | null; category: "fast" | "slow" | "dead" })[]>([]);
  const [velocityLoading, setVelocityLoading] = useState(false);

  async function loadUploads() {
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client
      .from("analytics_uploads")
      .select("id,source_type,file_name,uploaded_at,row_count,status")
      .order("uploaded_at", { ascending: false })
      .limit(20);
    setUploads((data ?? []) as UploadRecord[]);
    setUploadsLoading(false);
  }

  useEffect(() => {
    void loadUploads();
    const client = getSupabaseClient();
    if (client) {
      client.from("sites").select("id,site_name,site_code").eq("is_active", true).eq("is_dc", false).order("site_name")
        .then(({ data }) => setSites((data ?? []) as { id: string; site_name: string; site_code: string }[]));
    }
  }, []);

  async function handleFile(file: File) {
    if (!actorId) return;
    if (file.size > 20 * 1024 * 1024) {
      setImportResult({ added: 0, skipped: 0, errors: ["File must be under 20MB. Split large files and upload in batches."] });
      return;
    }
    setImporting(true); setImportResult(null);
    const client = getSupabaseClient();
    if (!client) { setImporting(false); return; }

    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      setImportResult({ added: 0, skipped: 0, errors: ["No rows found in file."] });
      setImporting(false); return;
    }

    // Create upload record
    const { data: upload, error: uploadErr } = await client
      .from("analytics_uploads")
      .insert({ source_type: sourceType, file_name: file.name, file_path: "", uploaded_by: actorId, row_count: rows.length, status: "processing" })
      .select("id").single();

    if (uploadErr || !upload) {
      setImportResult({ added: 0, skipped: 0, errors: [uploadErr?.message ?? "Failed to create upload record."] });
      setImporting(false); return;
    }

    // Normalize rows
    const normalized = rows
      .map((r) => sourceType === "fixably" ? normalizeFixably(r, upload.id) : normalizeGSX(r, upload.id))
      .filter((r) => r.part_number.trim() !== "");

    const errors: string[] = [];
    let added = 0;

    // Batch insert in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunk = normalized.slice(i, i + CHUNK);
      const { error } = await client.from("analytics_rows").insert(chunk);
      if (error) errors.push(`Chunk ${Math.floor(i / CHUNK) + 1}: ${error.message}`);
      else added += chunk.length;
    }

    // Update upload status
    await client.from("analytics_uploads").update({
      status: errors.length > 0 ? "error" : "done",
      row_count: added,
      error_message: errors.length > 0 ? errors[0] : null,
    }).eq("id", upload.id);

    setImportResult({ added, skipped: rows.length - normalized.length, errors });
    setImporting(false);
    void loadUploads();
  }

  async function loadTrend() {
    setTrendLoading(true);
    const client = getSupabaseClient();
    if (!client) { setTrendLoading(false); return; }

    let q = client
      .from("analytics_rows")
      .select("part_number, site_code, used_at, qty");

    if (trendFrom) q = q.gte("used_at", trendFrom);
    if (trendTo)   q = q.lte("used_at", trendTo);
    if (trendSite) q = q.eq("site_code", trendSite);

    const { data } = await q.limit(50000);
    const rows = (data ?? []) as { part_number: string; site_code: string | null; used_at: string | null; qty: number }[];

    // Aggregate client-side
    const map = new Map<string, TrendRow>();
    for (const r of rows) {
      const key = `${r.part_number}|${r.site_code ?? ""}`;
      const existing = map.get(key);
      if (existing) {
        existing.total_qty += r.qty;
        if (r.used_at && (!existing.last_used || r.used_at > existing.last_used)) existing.last_used = r.used_at;
      } else {
        map.set(key, { part_number: r.part_number, part_name: null, site_code: r.site_code, total_qty: r.qty, last_used: r.used_at });
      }
    }

    // Enrich with part names
    const partNumbers = [...new Set(rows.map((r) => r.part_number))];
    if (partNumbers.length > 0) {
      const { data: parts } = await client.from("parts").select("part_number,part_name").in("part_number", partNumbers.slice(0, 500));
      const partMap = new Map((parts ?? []).map((p: any) => [p.part_number, p.part_name]));
      for (const row of map.values()) row.part_name = partMap.get(row.part_number) ?? null;
    }

    const sorted = [...map.values()].sort((a, b) => b.total_qty - a.total_qty);
    setTrendRows(sorted);
    setTrendLoading(false);
  }

  async function loadABC() {
    setAbcLoading(true);
    const client = getSupabaseClient();
    if (!client) { setAbcLoading(false); return; }

    // Try materialized view first, fall back to analytics_rows
    const { data, error } = await client
      .from("analytics_summary")
      .select("part_number, part_name, total_qty, last_used")
      .order("total_qty", { ascending: false })
      .limit(500);

    const rows: TrendRow[] = (error ? [] : data ?? []).map((r: any) => ({
      part_number: r.part_number, part_name: r.part_name, site_code: null,
      total_qty: r.total_qty, last_used: r.last_used,
    }));

    // ABC classification: A = top 80% of volume, B = next 15%, C = bottom 5%
    const total = rows.reduce((s, r) => s + r.total_qty, 0);
    let cumulative = 0;
    const classified = rows.map((r) => {
      cumulative += r.total_qty;
      const pct = total > 0 ? cumulative / total : 0;
      const tier: "A" | "B" | "C" = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
      return { ...r, tier };
    });

    setAbcRows(classified);
    setAbcLoading(false);
  }

  async function loadVelocity() {
    setVelocityLoading(true);
    const client = getSupabaseClient();
    if (!client) { setVelocityLoading(false); return; }

    const { data, error } = await client
      .from("analytics_summary")
      .select("part_number, part_name, total_qty, last_used")
      .order("last_used", { ascending: false, nullsFirst: false })
      .limit(500);

    const now = Date.now();
    const rows = (error ? [] : data ?? []).map((r: any) => {
      const daysSince = r.last_used
        ? Math.floor((now - new Date(r.last_used).getTime()) / 86400000)
        : null;
      const category: "fast" | "slow" | "dead" =
        daysSince === null ? "dead"
        : daysSince <= 30 ? "fast"
        : daysSince <= 90 ? "slow"
        : "dead";
      return { part_number: r.part_number, part_name: r.part_name, site_code: null, total_qty: r.total_qty, last_used: r.last_used, days_since_last: daysSince, category };
    });

    setVelocityRows(rows);
    setVelocityLoading(false);
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "8px 10px",
    fontSize: 13, outline: "none", fontFamily: "inherit", background: "#fff",
  };

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <BarChart3 size={20} color="var(--blue)" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>Analytics</h1>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 2, borderBottom: "2px solid #e5e7eb", marginBottom: 24 }}>
          {([
            { key: "upload",   label: "Upload" },
            { key: "trend",    label: "Usage Trend" },
            { key: "abc",      label: "ABC Analysis" },
            { key: "velocity", label: "Stock Velocity" },
          ] as const).map((t) => (
            <button key={t.key} type="button"
              onClick={() => {
                setActiveTab(t.key);
                if (t.key === "abc" && abcRows.length === 0) void loadABC();
                if (t.key === "velocity" && velocityRows.length === 0) void loadVelocity();
              }}
              style={{ border: "none", background: "transparent", padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                color: activeTab === t.key ? "var(--blue)" : "#6b7a8d",
                borderBottom: activeTab === t.key ? "2px solid var(--blue)" : "2px solid transparent", marginBottom: -2 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Upload tab */}
        {activeTab === "upload" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          {/* Upload panel */}
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2d2d" }}>Upload export file</h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>Fixably or GSX repair data CSV</p>
            </div>
            <div style={{ padding: 16 }}>
              {/* Source type selector */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["fixably", "gsx"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setSourceType(t)}
                    style={{ flex: 1, border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                      background: sourceType === t ? "var(--blue)" : "#fff",
                      color: sourceType === t ? "#fff" : "#374151" }}>
                    {t === "fixably" ? "Fixably" : "GSX"}
                  </button>
                ))}
              </div>

              <CSVDropZone
                onFile={(f) => void handleFile(f)}
                onTemplate={() => downloadTemplate(sourceType)}
                importing={importing}
                label={`Import ${sourceType === "fixably" ? "Fixably" : "GSX"} CSV`}
              />

              {importResult && (
                <div style={{ marginTop: 12 }}>
                  <ImportResult added={importResult.added} skipped={importResult.skipped} errors={importResult.errors} />
                </div>
              )}
            </div>
          </div>

          {/* Upload history */}
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2d2d" }}>Upload history</h2>
            </div>
            <div style={{ overflowY: "auto", maxHeight: 280 }}>
              {uploadsLoading && <p style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>Loading…</p>}
              {!uploadsLoading && uploads.length === 0 && <p style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>No uploads yet.</p>}
              {uploads.map((u) => (
                <div key={u.id} style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }} title={u.file_name}>
                      {u.file_name}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{formatDate(u.uploaded_at)} · {u.row_count} rows</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)", textTransform: "uppercase",
                      background: u.source_type === "fixably" ? "#ede9fe" : "#dbeafe",
                      color: u.source_type === "fixably" ? "#6d28d9" : "#1d4ed8" }}>
                      {u.source_type}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                      background: u.status === "done" ? "#dcfce7" : u.status === "error" ? "#fee2e2" : "#fef9c3",
                      color: u.status === "done" ? "#15803d" : u.status === "error" ? "#b91c1c" : "#a16207" }}>
                      {u.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )} {/* end upload tab */}

        {/* Trend tab */}
        {activeTab === "trend" && (
        <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "visible" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2d2d" }}>Part usage trend</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>Aggregated from uploaded Fixably + GSX data</p>
          </div>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f0f0f0", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <DatePicker
              label="From date"
              value={trendFrom}
              onChange={setTrendFrom}
              popperPlacement="bottom-start"
              popperClassName="analytics-trend-datepicker-popper"
            />
            <DatePicker
              label="To date"
              value={trendTo}
              onChange={setTrendTo}
              popperPlacement="bottom-start"
              popperClassName="analytics-trend-datepicker-popper"
            />
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Site</label>
              <select value={trendSite} onChange={(e) => setTrendSite(e.target.value)} style={{ ...inputStyle, cursor: "pointer", minWidth: 140 }}>
                <option value="">All sites</option>
                {sites.map((s) => <option key={s.id} value={s.site_code}>{s.site_name}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => void loadTrend()} disabled={trendLoading}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: trendLoading ? "#6b8fc4" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: trendLoading ? "not-allowed" : "pointer" }}>
              <Upload size={14} /> {trendLoading ? "Loading…" : "Run analysis"}
            </button>
          </div>

          <div className="table-scroll">
            <table style={{ tableLayout: "fixed", minWidth: 640 }}>
              <colgroup>
                <col style={{ width: 130 }} />
                <col style={{ width: "auto" }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Part number</th>
                  <th>Description</th>
                  <th>Site</th>
                  <th className="num">Total used</th>
                  <th>Last used</th>
                </tr>
              </thead>
              <tbody>
                {!trendLoading && trendRows.length === 0 && (
                  <tr><td colSpan={5} className="empty-row">Run analysis to see part usage trends.</td></tr>
                )}
                {trendLoading && (
                  <tr><td colSpan={5} className="empty-row">Analyzing…</td></tr>
                )}
                {trendRows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>{row.part_number}</td>
                    <td title={row.part_name ?? ""} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.part_name ?? <span style={{ color: "#9ca3af" }}>—</span>}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", color: "#6b7a8d" }}>{row.site_code ?? <span style={{ color: "#9ca3af" }}>All</span>}</td>
                    <td className="num" style={{ fontWeight: 700, color: "var(--blue)" }}>{row.total_qty}</td>
                    <td style={{ color: "#6b7a8d" }}>{row.last_used ? formatDate(row.last_used) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )} {/* end trend tab */}

        {/* ABC Analysis tab */}
        {activeTab === "abc" && (
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2d2d" }}>ABC Analysis</h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>A = top 80% of usage volume · B = next 15% · C = bottom 5%</p>
              </div>
              <button type="button" onClick={() => void loadABC()} disabled={abcLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {abcLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            <div className="table-scroll">
              <table style={{ tableLayout: "fixed", minWidth: 560 }}>
                <colgroup><col style={{ width: 50 }} /><col style={{ width: 130 }} /><col style={{ width: "auto" }} /><col style={{ width: 80 }} /><col style={{ width: 120 }} /></colgroup>
                <thead><tr><th>Tier</th><th>Part #</th><th>Description</th><th className="num">Total used</th><th>Last used</th></tr></thead>
                <tbody>
                  {abcLoading && <tr><td colSpan={5} className="empty-row">Analyzing…</td></tr>}
                  {!abcLoading && abcRows.length === 0 && <tr><td colSpan={5} className="empty-row">No data. Upload analytics files first.</td></tr>}
                  {abcRows.map((r, i) => (
                    <tr key={i}>
                      <td><span style={{ fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
                        background: r.tier === "A" ? "#dcfce7" : r.tier === "B" ? "#dbeafe" : "#f3f4f6",
                        color: r.tier === "A" ? "#15803d" : r.tier === "B" ? "#1d4ed8" : "#6b7a8d" }}>{r.tier}</span></td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--blue)" }}>{r.part_number}</td>
                      <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.part_name ?? "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{r.total_qty}</td>
                      <td style={{ color: "#6b7a8d" }}>{r.last_used ? formatDate(r.last_used) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stock Velocity tab */}
        {activeTab === "velocity" && (
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2d2d" }}>Stock Velocity</h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>Fast = used ≤30 days · Slow = 31–90 days · Dead = 90+ days or never</p>
              </div>
              <button type="button" onClick={() => void loadVelocity()} disabled={velocityLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {velocityLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            <div className="table-scroll">
              <table style={{ tableLayout: "fixed", minWidth: 560 }}>
                <colgroup><col style={{ width: 80 }} /><col style={{ width: 130 }} /><col style={{ width: "auto" }} /><col style={{ width: 80 }} /><col style={{ width: 100 }} /></colgroup>
                <thead><tr><th>Category</th><th>Part #</th><th>Description</th><th className="num">Total used</th><th className="num">Days since</th></tr></thead>
                <tbody>
                  {velocityLoading && <tr><td colSpan={5} className="empty-row">Analyzing…</td></tr>}
                  {!velocityLoading && velocityRows.length === 0 && <tr><td colSpan={5} className="empty-row">No data. Upload analytics files first.</td></tr>}
                  {velocityRows.map((r, i) => (
                    <tr key={i}>
                      <td><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                        background: r.category === "fast" ? "#dcfce7" : r.category === "slow" ? "#fef9c3" : "#fee2e2",
                        color: r.category === "fast" ? "#15803d" : r.category === "slow" ? "#a16207" : "#b91c1c" }}>
                        {r.category}
                      </span></td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--blue)" }}>{r.part_number}</td>
                      <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.part_name ?? "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{r.total_qty}</td>
                      <td className="num" style={{ color: "#6b7a8d" }}>{r.days_since_last ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </AppLayout>
  );
}
