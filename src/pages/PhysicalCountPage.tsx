import { useTableResize } from "@/components/ResizableColumns";
import { useState, useEffect } from "react";
import { ClipboardCheck, Download, Upload, CheckCircle, AlertTriangle } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";

type VarianceRow = {
  serial_number: string;
  part_number: string;
  part_name: string;
  expected_status: string;
  actual_status: string;
  variance: "match" | "missing" | "surplus" | "status_mismatch";
};

type CountRecord = {
  id: string;
  status: string;
  created_at: string;
  notes: string | null;
  item_count: number;
};

function downloadCountSheet(rows: { serial_number: string; part_number: string; part_name: string; status: string }[]) {
  const header = "serial_number,part_number,part_name,expected_status,actual_status\n";
  const body = rows.map((r) => `${r.serial_number},${r.part_number},"${r.part_name}",${r.status},`).join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `count-sheet-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCountCSV(text: string): { serial_number: string; actual_status: string }[] {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
  const snIdx = header.findIndex((h) => h.includes("serial"));
  const actualIdx = header.findIndex((h) => h.includes("actual"));
  if (snIdx < 0 || actualIdx < 0) return [];
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim().replace(/"/g, ""));
    return { serial_number: cols[snIdx] ?? "", actual_status: cols[actualIdx] ?? "" };
  }).filter((r) => r.serial_number);
}

export function PhysicalCountPage() {
  const tableRef = useTableResize();
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.user.id : null;

  const [counts, setCounts] = useState<CountRecord[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [variance, setVariance] = useState<VarianceRow[] | null>(null);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  async function loadCounts() {
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client
      .from("physical_counts")
      .select("id,status,created_at,notes,physical_count_items(id)")
      .order("created_at", { ascending: false })
      .limit(20);
    setCounts((data ?? []).map((c: any) => ({
      id: c.id, status: c.status, created_at: c.created_at, notes: c.notes,
      item_count: Array.isArray(c.physical_count_items) ? c.physical_count_items.length : 0,
    })));
    setLoadingCounts(false);
  }

  useEffect(() => { void loadCounts(); }, []);

  async function handleExportSheet() {
    setExportingSheet(true);
    const client = getSupabaseClient();
    if (!client) { setExportingSheet(false); return; }
    const { data } = await client
      .from("serial_numbers")
      .select("serial_number, status, parts(part_number, part_name)")
      .eq("status", "in_stock")
      .order("serial_number")
      .limit(5000);
    const rows = (data ?? []).map((r: any) => {
      const part = Array.isArray(r.parts) ? r.parts[0] : r.parts;
      return { serial_number: r.serial_number, part_number: part?.part_number ?? "", part_name: part?.part_name ?? "", status: r.status };
    });
    downloadCountSheet(rows);
    setExportingSheet(false);
  }

  async function handleUploadCount(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !actorId) return;
    setUploading(true); setSubmitError(null); setVariance(null);

    const client = getSupabaseClient();
    if (!client) { setUploading(false); return; }

    const text = await file.text();
    const uploaded = parseCountCSV(text);
    if (uploaded.length === 0) {
      setSubmitError("No valid rows found. Ensure columns: serial_number, actual_status.");
      setUploading(false); return;
    }

    // Fetch current inventory for comparison
    const serials = uploaded.map((r) => r.serial_number);
    const { data: existing } = await client
      .from("serial_numbers")
      .select("serial_number, status, parts(part_number, part_name)")
      .in("serial_number", serials);

    const existingMap = new Map((existing ?? []).map((r: any) => {
      const part = Array.isArray(r.parts) ? r.parts[0] : r.parts;
      return [r.serial_number, { status: r.status, part_number: part?.part_number ?? "", part_name: part?.part_name ?? "" }];
    }));

    // Build variance
    const rows: VarianceRow[] = uploaded.map((u) => {
      const sys = existingMap.get(u.serial_number);
      if (!sys) return { serial_number: u.serial_number, part_number: "", part_name: "", expected_status: "not_in_system", actual_status: u.actual_status, variance: "surplus" as const };
      const v = sys.status === u.actual_status ? "match" : u.actual_status === "" ? "missing" : "status_mismatch";
      return { serial_number: u.serial_number, part_number: sys.part_number, part_name: sys.part_name, expected_status: sys.status, actual_status: u.actual_status, variance: v as VarianceRow["variance"] };
    });

    // Create count record + items
    const { data: count, error: countErr } = await client
      .from("physical_counts")
      .insert({ created_by: actorId, status: "submitted", notes: file.name })
      .select("id").single();

    if (countErr || !count) { setSubmitError(countErr?.message ?? "Failed to create count."); setUploading(false); return; }

    const items = rows.map((r) => ({
      count_id: count.id,
      serial_number: r.serial_number,
      part_id: null, // enriched separately if needed
      expected_status: r.expected_status,
      actual_status: r.actual_status,
      variance: r.variance,
    }));

    // Insert in chunks
    for (let i = 0; i < items.length; i += 500) {
      await client.from("physical_count_items").insert(items.slice(i, i + 500));
    }

    setVariance(rows);
    setActiveCountId(count.id);
    setSubmitSuccess(`Count submitted: ${rows.filter((r) => r.variance === "match").length} matched, ${rows.filter((r) => r.variance !== "match").length} discrepancies.`);
    setUploading(false);
    void loadCounts();
    e.target.value = "";
  }

  const VARIANCE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
    match:            { bg: "#dcfce7", color: "#15803d", label: "Match" },
    missing:          { bg: "#fee2e2", color: "#b91c1c", label: "Missing" },
    surplus:          { bg: "#fef9c3", color: "#a16207", label: "Surplus" },
    status_mismatch:  { bg: "#dbeafe", color: "#1d4ed8", label: "Status diff" },
  };

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ClipboardCheck size={20} color="var(--blue)" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>Physical Count</h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => void handleExportSheet()} disabled={exportingSheet}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
              <Download size={14} /> {exportingSheet ? "Exporting…" : "Export count sheet"}
            </button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <Upload size={14} /> {uploading ? "Processing…" : "Upload count"}
              <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => void handleUploadCount(e)} disabled={uploading} />
            </label>
          </div>
        </div>

        <div style={{ marginBottom: 16, padding: "12px 16px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 13, color: "#0369a1" }}>
          <strong>How it works:</strong> Export the count sheet → operators fill in <code>actual_status</code> column → upload the completed CSV → review variance report → submit for admin approval.
        </div>

        {submitError && (
          <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>
            {submitError}
          </div>
        )}
        {submitSuccess && (
          <div role="status" style={{ marginBottom: 16, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", color: "#15803d", fontSize: 13, display: "flex", gap: 8 }}>
            <CheckCircle size={16} /> {submitSuccess}
          </div>
        )}

        {/* Variance report */}
        {variance && (
          <section className="table-card" style={{ marginBottom: 20 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Variance Report</span>
              <span style={{ fontSize: 12, color: "#6b7a8d" }}>{variance.length} items · {variance.filter((r) => r.variance !== "match").length} discrepancies</span>
            </div>
            <div className="table-scroll" style={{ maxHeight: 400 }}>
              <table ref={tableRef} style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>Serial</th>
                    <th>Part #</th>
                    <th>Expected</th>
                    <th>Actual</th>
                    <th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.map((r, i) => {
                    const vs = VARIANCE_STYLE[r.variance];
                    return (
                      <tr key={i} style={{ background: r.variance !== "match" ? "#fffbeb" : undefined }}>
                        <td style={{ fontFamily: "monospace" }}>{r.serial_number}</td>
                        <td>{r.part_number || "—"}</td>
                        <td style={{ color: "#6b7a8d" }}>{r.expected_status}</td>
                        <td style={{ color: "#6b7a8d" }}>{r.actual_status || "—"}</td>
                        <td>
                          <span className="status-badge" style={{ background: vs.bg, color: vs.color }}>{vs.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Count history */}
        <section className="table-card">
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Count history</span>
          </div>
          <div className="table-scroll">
          <table style={{ minWidth: 500 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Items</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loadingCounts && <tr><td colSpan={4} className="empty-row">Loading…</td></tr>}
              {!loadingCounts && counts.length === 0 && <tr><td colSpan={4} className="empty-row">No counts yet.</td></tr>}
              {counts.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })}</td>
                  <td className="num">{c.item_count}</td>
                  <td>
                    <span className="status-badge" style={{
                      background: c.status === "approved" ? "#dcfce7" : c.status === "submitted" ? "#dbeafe" : "#f3f4f6",
                      color: c.status === "approved" ? "#15803d" : c.status === "submitted" ? "#1d4ed8" : "#6b7a8d",
                    }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ color: "#6b7a8d" }}>{c.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      </main>
    </AppLayout>
  );
}
