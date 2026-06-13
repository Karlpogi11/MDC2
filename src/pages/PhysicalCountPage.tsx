import { useTableResize } from "@/components/ResizableColumns";
import { useState, useEffect } from "react";
import { ClipboardCheck, Download, Upload, CheckCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
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
  discrepancy_count: number;
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
  const varianceTableRef = useTableResize();
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.profile.id : null;
  const isAdmin = authState.status === "authenticated" && ["system_admin", "dc_admin"].includes(authState.profile.role);

  const [counts, setCounts] = useState<CountRecord[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [variance, setVariance] = useState<VarianceRow[] | null>(null);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [detailCountId, setDetailCountId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<VarianceRow[] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  async function loadCounts() {
    const data = await api.get("/physical-counts");
    setCounts((data ?? []) as CountRecord[]);
    setLoadingCounts(false);
  }

  useEffect(() => { void loadCounts(); }, []);

  async function handleExportSheet() {
    setExportingSheet(true);
    const data = await api.get("/serials?status=in_stock&limit=5000");
    const rows = (data ?? []).map((r: any) => ({
      serial_number: r.serial_number, part_number: r.part_number ?? "", part_name: r.part_name ?? "", status: r.status,
    }));
    downloadCountSheet(rows);
    setExportingSheet(false);
  }

  async function handleUploadCount(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !actorId) return;
    setUploading(true); setSubmitError(null); setVariance(null); setActiveCountId(null);

    try {
      const result = await api.post("/physical-counts", {
        created_by: actorId,
        file_name: file.name,
        rows: await file.text(),
      });
      setVariance(result.variance ?? null);
      setActiveCountId(result.countId ?? null);
      setSubmitSuccess(result.message ?? "Count submitted.");
    } catch (e: any) {
      setSubmitError(e?.message ?? "Upload failed.");
    }
    setUploading(false);
    void loadCounts();
    e.target.value = "";
  }

  async function handleApprove(countId: string) {
    if (!actorId || !isAdmin) return;
    setApprovingId(countId);
    try {
      const result = await api.put(`/physical-counts/${countId}/approve`, { actorId });
      setSubmitSuccess(result.message ?? "Count approved.");
    } catch (e: any) {
      setSubmitError(e?.message ?? "Approval failed.");
    }
    setApprovingId(null);
    void loadCounts();
    if (activeCountId === countId) { setVariance(null); setActiveCountId(null); }
  }

  async function handleViewDetail(countId: string) {
    if (detailCountId === countId) { setDetailCountId(null); setDetailRows(null); return; }
    setDetailCountId(countId); setLoadingDetail(true);
    const data = await api.get(`/physical-counts/${countId}/items`);
    setDetailRows((data ?? []).map((r: any) => ({
      serial_number: r.serial_number, part_number: r.part_number ?? "", part_name: r.part_name ?? "",
      expected_status: r.expected_status, actual_status: r.actual_status, variance: r.variance,
    })));
    setLoadingDetail(false);
  }

  const VARIANCE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
    match:           { bg: "var(--bg-surface-elevated)", color: "var(--link)",     label: "Match" },
    missing:         { bg: "var(--bg-surface-elevated)", color: "var(--negative)", label: "Missing" },
    surplus:         { bg: "var(--bg-surface-elevated)", color: "var(--muted)",    label: "Surplus" },
    status_mismatch: { bg: "var(--bg-surface-elevated)", color: "var(--blue)",     label: "Status diff" },
  };

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    submitted: { bg: "var(--bg-surface-elevated)", color: "var(--blue)" },
    approved:  { bg: "var(--bg-surface-elevated)", color: "var(--text)" },
    draft:     { bg: "#f3f4f6", color: "var(--muted)" },
  };

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ClipboardCheck size={20} color="var(--blue)" />
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Stock Reconciliation</h1>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Compare physical stock against system records and approve adjustments</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => void handleExportSheet()} disabled={exportingSheet}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
              <Download size={14} /> {exportingSheet ? "Exporting…" : "Export count sheet"}
            </button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer", position: "relative", overflow: "hidden" }}>
              <input type="file" accept=".csv" onChange={(e) => void handleUploadCount(e)} disabled={uploading}
                style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", zIndex: 1 }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, pointerEvents: "none", position: "relative", zIndex: 2 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {uploading ? "Processing…" : "Upload count"}
              </span>
            </label>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <button type="button" onClick={() => setShowSteps((v) => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontSize: 12, fontWeight: 600, padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
            {showSteps ? "▲" : "▼"} How it works
          </button>
          {showSteps && (
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {[
                { n: "1", label: "Export sheet", desc: "Download the count sheet CSV with all current serials" },
                { n: "2", label: "Fill actual status", desc: "Operators fill the actual_status column for each serial" },
                { n: "3", label: "Upload & review", desc: "Upload the completed CSV and review the variance report" },
                { n: "4", label: "Admin approves", desc: "DC Admin approves — system auto-adjusts serial statuses" },
              ].map((s) => (
                <div key={s.n} style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", marginBottom: 3 }}>STEP {s.n}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {submitError && (
          <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>
            {submitError}
          </div>
        )}
        {submitSuccess && (
          <div role="status" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--text)", fontSize: 13, display: "flex", gap: 8 }}>
            <CheckCircle size={16} /> {submitSuccess}
          </div>
        )}

        {/* Variance report for just-uploaded count */}
        {variance && activeCountId && (
          <section className="table-card" style={{ marginBottom: 20 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Variance Report</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{variance.length} items · {variance.filter((r) => r.variance !== "match").length} discrepancies</span>
              </div>
              {isAdmin ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <button type="button"
                    onClick={() => void handleApprove(activeCountId)}
                    disabled={approvingId === activeCountId}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    <ShieldCheck size={13} /> {approvingId === activeCountId ? "Approving…" : "Approve & Apply"}
                  </button>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>Updates status_mismatch serials only. Missing/surplus → use Corrections.</span>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: "var(--muted)", background: "var(--bg-surface-elevated)", padding: "4px 10px", borderRadius: "var(--radius)" }}>
                  ⏳ Awaiting admin approval
                </span>
              )}
            </div>
            <div className="table-scroll" style={{ maxHeight: 400 }}>
              <table ref={varianceTableRef}>
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
                      <tr key={i} style={{ background: r.variance !== "match" ? "rgba(255,159,10,0.06)" : undefined }}>
                        <td style={{ fontFamily: "monospace" }}>{r.serial_number}</td>
                        <td>{r.part_number || "—"}</td>
                        <td style={{ color: "var(--muted)" }}>{r.expected_status}</td>
                        <td style={{ color: "var(--muted)" }}>{r.actual_status || "—"}</td>
                        <td><span className="status-badge" style={{ background: vs.bg, color: vs.color }}>{vs.label}</span></td>
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
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Count history</span>
          </div>
          <div className="table-scroll">
            <table ref={tableRef}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Items</th>
                  <th className="num">Discrepancies</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loadingCounts && <tr><td colSpan={6} className="empty-row">Loading…</td></tr>}
                {!loadingCounts && counts.length === 0 && <tr><td colSpan={6} className="empty-row">No counts yet.</td></tr>}
                {counts.map((c) => {
                  const ss = STATUS_STYLE[c.status] ?? STATUS_STYLE.draft;
                  return (
                    <>
                      <tr key={c.id}>
                        <td>{new Date(c.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })}</td>
                        <td className="num">{c.item_count}</td>
                        <td className="num">
                          {c.discrepancy_count > 0
                            ? <span style={{ color: "var(--negative)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}><AlertTriangle size={12} />{c.discrepancy_count}</span>
                            : <span style={{ color: "var(--text)" }}>0</span>}
                        </td>
                        <td>
                          <span className="status-badge" style={{ background: ss.bg, color: ss.color }}>{c.status}</span>
                        </td>
                        <td style={{ color: "var(--muted)" }}>{c.notes ?? "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" onClick={() => void handleViewDetail(c.id)}
                              style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer", borderRadius: "var(--radius)" }}>
                              {detailCountId === c.id ? "Hide" : "View"}
                            </button>
                            {isAdmin && c.status === "submitted" && (
                              <button type="button" onClick={() => void handleApprove(c.id)} disabled={approvingId === c.id}
                                style={{ border: "none", background: "#15803d", color: "#fff", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: "var(--radius)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <ShieldCheck size={12} /> {approvingId === c.id ? "…" : "Approve"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {detailCountId === c.id && (
                        <tr key={`${c.id}-detail`}>
                          <td colSpan={6} style={{ padding: 0, background: "var(--bg-surface-elevated)" }}>
                            {loadingDetail ? (
                              <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted)" }}>Loading…</div>
                            ) : (
                              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                                <table style={{ width: "100%", fontSize: 12 }}>
                                  <thead>
                                    <tr style={{ background: "var(--bg-surface-elevated)" }}>
                                      <th style={{ padding: "4px 10px", textAlign: "left" }}>Serial</th>
                                      <th style={{ padding: "4px 10px", textAlign: "left" }}>Expected</th>
                                      <th style={{ padding: "4px 10px", textAlign: "left" }}>Actual</th>
                                      <th style={{ padding: "4px 10px", textAlign: "left" }}>Variance</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(detailRows ?? []).map((r, i) => {
                                      const vs = VARIANCE_STYLE[r.variance];
                                      return (
                                        <tr key={i} style={{ borderTop: "1px solid #e5e7eb" }}>
                                          <td style={{ padding: "5px 12px", fontFamily: "monospace" }}>{r.serial_number}</td>
                                          <td style={{ padding: "5px 12px", color: "var(--muted)" }}>{r.expected_status}</td>
                                          <td style={{ padding: "5px 12px", color: "var(--muted)" }}>{r.actual_status || "—"}</td>
                                          <td style={{ padding: "5px 12px" }}><span className="status-badge" style={{ background: vs.bg, color: vs.color, fontSize: 11 }}>{vs.label}</span></td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AppLayout>
  );
}





