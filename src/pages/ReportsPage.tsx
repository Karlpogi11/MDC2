import { useEffect, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/AppLayout";
import { useTableResize } from "@/components/ResizableColumns";
import { DatePicker } from "@/components/DatePicker";

// ─── Types ────────────────────────────────────────────────────────────────────

type TransferBySiteRow = { site_name: string; site_code: string; count: number; item_count: number };
type StockInRow = { id: string; batch_date: string; operator: string; row_count: number };
type TopPartRow = { part_name: string; part_number: string; transferred_qty: number };

type ReportId = "transfers_by_site" | "stock_in_this_week" | "top_moved_parts";

// ─── CSV helper ───────────────────────────────────────────────────────────────

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
  const blob = new Blob([lines], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-reports ──────────────────────────────────────────────────────────────

function TransfersBySiteReport() {
  const tableRef = useTableResize();
  const [rows, setRows] = useState<TransferBySiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<"7" | "30" | "90">("30");

  useEffect(() => { void load(); }, [range]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();
      const data = await api.get(`/reports/transfers-by-site?since=${since}&range=${range}`);
      setRows((data ?? []) as TransferBySiteRow[]);
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {(["7", "30", "90"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setRange(d)}
              style={{ border: "none", borderRight: `1px solid ${range === d ? "var(--blue)" : "var(--line)"}`, borderRadius: 0, background: range === d ? "var(--blue)" : "var(--bg-surface)", color: range === d ? "#fff" : "var(--text)", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Last {d}d
            </button>
          ))}
        </div>
        <button type="button" onClick={() => downloadCSV(`transfers-by-site-${range}d.csv`, ["Site", "Code", "Transfers", "Items"],
          rows.map((r) => [r.site_name, r.site_code, r.count, r.item_count]))}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--text)" }}>
          <Download size={13} /> Export
        </button>
      </div>
      {error && <div style={{ color: "var(--negative)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <section className="table-card">
        <div className="table-scroll">
          <table ref={tableRef}>
            <thead><tr><th>Site</th><th>Code</th><th className="num">Transfers</th><th className="num">Items Sent</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="empty-row">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={4} className="empty-row">No received transfers in this period.</td></tr>}
              {!loading && rows.map((r) => (
                <tr key={r.site_code}>
                  <td style={{ fontWeight: 600 }}>{r.site_name}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{r.site_code}</td>
                  <td className="num">{r.count}</td>
                  <td className="num">{r.item_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StockInThisWeekReport() {
  const tableRef = useTableResize();
  const [rows, setRows] = useState<StockInRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [serials, setSerials] = useState<{ serial_number: string; part_number: string }[]>([]);
  const [loadingSerials, setLoadingSerials] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true); setError(null);
    try {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const data = await api.get(`/reports/stock-in-this-week?since=${since}`);
      setRows((data ?? []) as StockInRow[]);
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setLoading(false); }
  }

  const total = rows.reduce((s, r) => s + r.row_count, 0);

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id); setLoadingSerials(true); setSerials([]);
    const data = await api.get(`/reports/batch-serials/${id}`);
    setSerials((data ?? []) as { serial_number: string; part_number: string }[]);
    setLoadingSerials(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Last 7 days · <strong style={{ color: "var(--text)" }}>{total} serials</strong> stocked in across {rows.length} batches</span>
        <button type="button" onClick={() => downloadCSV("stock-in-this-week.csv", ["Date", "Operator", "Serials"],
          rows.map((r) => [new Date(r.batch_date).toLocaleDateString(), r.operator, r.row_count]))}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--text)" }}>
          <Download size={13} /> Export
        </button>
      </div>
      {error && <div style={{ color: "var(--negative)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <section className="table-card">
        <div className="table-scroll">
          <table ref={tableRef}>
            <thead><tr><th>Date</th><th>Operator</th><th className="num">Serials</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={3} className="empty-row">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={3} className="empty-row">No stock-in batches this week.</td></tr>}
              {!loading && rows.map((r) => (
                <>
                  <tr key={r.id}>
                    <td>{new Date(r.batch_date).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{r.operator}</td>
                    <td className="num">
                      <button type="button" onClick={() => void toggleExpand(r.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontSize: 13, padding: 0 }}>
                        {r.row_count}
                      </button>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr key={`${r.id}-serials`}>
                      <td colSpan={3} style={{ padding: 0, background: "var(--bg-surface-elevated)" }}>
                        {loadingSerials ? (
                          <div style={{ padding: "5px 12px", fontSize: 12, color: "var(--muted)" }}>Loading serials…</div>
                        ) : (
                          <div style={{ maxHeight: 260, overflowY: "auto", padding: "5px 12px" }}>
                            {serials.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>No serials found.</span>}
                            {serials.map((s) => (
                              <div key={s.serial_number} style={{ fontSize: 12, padding: "3px 0", display: "flex", gap: 16 }}>
                                <span style={{ fontFamily: "monospace", color: "var(--text)", minWidth: 160 }}>{s.serial_number}</span>
                                <span style={{ color: "var(--muted)" }}>{s.part_number}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TopMovedPartsReport() {
  const tableRef = useTableResize();
  const [rows, setRows] = useState<TopPartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<"7" | "30" | "90">("30");

  useEffect(() => { void load(); }, [range]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();
      const data = await api.get(`/reports/top-moved-parts?since=${since}&range=${range}`);
      setRows((data ?? []) as TopPartRow[]);
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {(["7", "30", "90"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setRange(d)}
              style={{ border: "none", borderRight: `1px solid ${range === d ? "var(--blue)" : "var(--line)"}`, borderRadius: 0, background: range === d ? "var(--blue)" : "var(--bg-surface)", color: range === d ? "#fff" : "var(--text)", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Last {d}d
            </button>
          ))}
        </div>
        <button type="button" onClick={() => downloadCSV(`top-parts-${range}d.csv`, ["Part Name", "Part #", "Qty Transferred"],
          rows.map((r) => [r.part_name, r.part_number, r.transferred_qty]))}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--text)" }}>
          <Download size={13} /> Export
        </button>
      </div>
      {error && <div style={{ color: "var(--negative)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <section className="table-card">
        <div className="table-scroll">
          <table ref={tableRef}>
            <thead><tr><th>#</th><th>Part Name</th><th>Part #</th><th className="num">Qty Transferred</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="empty-row">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={4} className="empty-row">No transfer data in this period.</td></tr>}
              {!loading && rows.map((r, i) => (
                <tr key={r.part_number}>
                  <td style={{ color: "var(--muted)", fontWeight: 700, width: 32 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{r.part_name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.part_number}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{r.transferred_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const REPORTS: { id: ReportId; label: string; description: string }[] = [
  { id: "transfers_by_site",  label: "Transfers by Site",    description: "In-transit and received transfers by destination" },
  { id: "stock_in_this_week", label: "Stock-In This Week",   description: "Batches imported in the last 7 days" },
  { id: "top_moved_parts",    label: "Top Moved Parts",      description: "Most transferred parts by volume" },
];

export function ReportsPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState<ReportId>("transfers_by_site");

  return (
    <AppLayout activeModule="/reports">
      {/* Top tab bar */}
      <nav className="sub-nav" aria-label="Reports pages">
        <button type="button" className="sub-tab active">Reports</button>
        <button type="button" className="sub-tab" onClick={() => navigate("/exports")}>Exports</button>
      </nav>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <BarChart3 size={20} color="var(--blue)" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Reports</h1>
          </div>

          {/* Report selector */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--line)", marginBottom: 24 }}>
            {REPORTS.map((r) => (
              <button key={r.id} type="button" onClick={() => setActive(r.id)}
                style={{
                  textAlign: "left", padding: "5px 12px", cursor: "pointer",
                  border: "none",
                  borderRadius: 0,
                  borderBottom: `2px solid ${active === r.id ? "var(--blue)" : "transparent"}`,
                  marginBottom: -1,
                  background: "transparent",
                  color: active === r.id ? "var(--text)" : "var(--muted)",
                  fontWeight: active === r.id ? 600 : 400,
                  fontSize: 13,
                }}>
                {r.label}
              </button>
            ))}
          </div>

          {/* Active report */}
          <div>
            <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {REPORTS.find((r) => r.id === active)?.label}
            </h2>
            {active === "transfers_by_site"  && <TransfersBySiteReport />}
            {active === "stock_in_this_week" && <StockInThisWeekReport />}
            {active === "top_moved_parts"    && <TopMovedPartsReport />}
          </div>
        </main>
    </AppLayout>
  );
}






