import { useEffect, useState } from "react";
import { BarChart3, Download, FileDown } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
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
    const client = getSupabaseClient();
    if (!client) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();
      const { data, error: err } = await client
        .from("transfers")
        .select("status, destination_site_id, sites!destination_site_id(site_name, site_code), transfer_items(id)")
        .in("status", ["received", "in_transit"])
        .gte("created_at", since);
      if (err) throw new Error(err.message);

      const map = new Map<string, TransferBySiteRow>();
      for (const t of (data ?? []) as any[]) {
        const site = Array.isArray(t.sites) ? t.sites[0] : t.sites;
        if (!site) continue;
        const key = site.site_code ?? t.destination_site_id;
        if (!map.has(key)) map.set(key, { site_name: site.site_name, site_code: site.site_code, count: 0, item_count: 0 });
        const row = map.get(key)!;
        row.count++;
        row.item_count += Array.isArray(t.transfer_items) ? t.transfer_items.length : 0;
      }
      setRows(Array.from(map.values()).sort((a, b) => b.count - a.count));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
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
    const client = getSupabaseClient();
    if (!client) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error: err } = await client
        .from("stock_in_batches")
        .select("id, imported_at, total_rows, operator:profiles!imported_by(full_name, username)")
        .gte("imported_at", since)
        .order("imported_at", { ascending: false })
        .limit(100);
      if (err) throw new Error(err.message);
      setRows((data ?? []).map((b: any) => {
        const p = Array.isArray(b.operator) ? b.operator[0] : b.operator;
        return { id: b.id, batch_date: b.imported_at, operator: p?.full_name ?? p?.username ?? "—", row_count: b.total_rows ?? 0 };
      }));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  const total = rows.reduce((s, r) => s + r.row_count, 0);

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id); setLoadingSerials(true); setSerials([]);
    const client = getSupabaseClient();
    if (!client) { setLoadingSerials(false); return; }
    const { data } = await client
      .from("serial_numbers")
      .select("serial_number, parts(part_number)")
      .eq("stock_in_batch_id", id)
      .order("serial_number")
      .limit(500);
    setSerials((data ?? []).map((r: any) => {
      const p = Array.isArray(r.parts) ? r.parts[0] : r.parts;
      return { serial_number: r.serial_number, part_number: p?.part_number ?? "—" };
    }));
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
    const client = getSupabaseClient();
    if (!client) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();
      const { data, error: err } = await client
        .from("transfer_items")
        .select("part_id, parts(part_name, part_number), transfers!inner(status, created_at)")
        .in("transfers.status", ["in_transit", "received"])
        .gte("transfers.created_at", since)
        .limit(5000);
      if (err) throw new Error(err.message);

      const map = new Map<string, TopPartRow>();
      for (const item of (data ?? []) as any[]) {
        const part = Array.isArray(item.parts) ? item.parts[0] : item.parts;
        if (!part) continue;
        const key = part.part_number;
        if (!map.has(key)) map.set(key, { part_name: part.part_name, part_number: part.part_number, transferred_qty: 0 });
        map.get(key)!.transferred_qty++;
      }
      setRows(Array.from(map.values()).sort((a, b) => b.transferred_qty - a.transferred_qty).slice(0, 20));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
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

// ─── Exports (inline, no AppLayout wrapper) ──────────────────────────────────

type Site = { id: string; site_name: string; site_code: string };

function toCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers.map(escape), ...rows.map((r) => r.map(escape))].join("\n");
}
function dlCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function ExportsInline() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siFrom, setSiFrom] = useState(""); const [siTo, setSiTo] = useState("");
  const [siExporting, setSiExporting] = useState(false); const [siCount, setSiCount] = useState<number | null>(null);
  const [trFrom, setTrFrom] = useState(""); const [trTo, setTrTo] = useState("");
  const [trSite, setTrSite] = useState(""); const [trStatus, setTrStatus] = useState("");
  const [trExporting, setTrExporting] = useState(false); const [trCount, setTrCount] = useState<number | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    client.from("sites").select("id,site_name,site_code").eq("is_active", true).eq("is_dc", false).order("site_name")
      .then(({ data }) => setSites((data ?? []) as Site[]));
  }, []);

  async function exportStockedIn() {
    setSiExporting(true); setSiCount(null);
    const client = getSupabaseClient(); if (!client) { setSiExporting(false); return; }
    let q = client.from("serial_numbers").select("serial_number,status,stock_in_at,part:parts(part_number,part_name,category),site:sites!current_site_id(site_name),batch:stock_in_batches(source_type)").order("stock_in_at",{ascending:false}).limit(10000);
    if (siFrom) q = q.gte("stock_in_at", siFrom);
    if (siTo)   q = q.lte("stock_in_at", siTo + "T23:59:59");
    const { data } = await q;
    const rows = (data ?? []) as any[];
    setSiCount(rows.length);
    dlCSV(`mdc-stocked-in-${new Date().toISOString().slice(0,10)}.csv`, toCSV(
      ["Serial Number","Part Number","Part Name","Category","Status","Site","Stock-In Date","Import Type"],
      rows.map((r) => { const p=Array.isArray(r.part)?r.part[0]:r.part; const s=Array.isArray(r.site)?r.site[0]:r.site; const b=Array.isArray(r.batch)?r.batch[0]:r.batch; return [r.serial_number??"",p?.part_number??"",p?.part_name??"",p?.category??"",r.status??"",s?.site_name??"",fmtDate(r.stock_in_at),b?.source_type??""]; })
    ));
    setSiExporting(false);
  }

  async function exportTransferred() {
    setTrExporting(true); setTrCount(null);
    const client = getSupabaseClient(); if (!client) { setTrExporting(false); return; }
    const { data } = await client.from("transfer_items").select("qty,part:parts(part_number,part_name,category),serial:serial_numbers(serial_number),transfer:transfers(transfer_no,status,created_at,packed_at,destination:sites!destination_site_id(site_name,site_code,id),requester:profiles!requested_by(full_name,username))").limit(10000);
    let rows = (data ?? []) as any[];
    rows = rows.filter((r) => { const t=Array.isArray(r.transfer)?r.transfer[0]:r.transfer; if(!t) return false; if(trStatus&&t.status!==trStatus) return false; if(trFrom&&t.created_at<trFrom) return false; if(trTo&&t.created_at>trTo+"T23:59:59") return false; if(trSite){const d=Array.isArray(t.destination)?t.destination[0]:t.destination; if(d?.id!==trSite) return false;} return true; });
    setTrCount(rows.length);
    dlCSV(`mdc-transferred-${new Date().toISOString().slice(0,10)}.csv`, toCSV(
      ["Transfer #","Serial Number","Part Number","Part Name","Category","Qty","Destination","Status","Created Date","Packed Date","Requested By"],
      rows.map((r) => { const p=Array.isArray(r.part)?r.part[0]:r.part; const sn=Array.isArray(r.serial)?r.serial[0]:r.serial; const t=Array.isArray(r.transfer)?r.transfer[0]:r.transfer; const d=Array.isArray(t?.destination)?t.destination[0]:t?.destination; const rq=Array.isArray(t?.requester)?t.requester[0]:t?.requester; return [t?.transfer_no??"",sn?.serial_number??"",p?.part_number??"",p?.part_name??"",p?.category??"",String(r.qty??1),d?.site_name??"",t?.status??"",fmtDate(t?.created_at),fmtDate(t?.packed_at),rq?.full_name??rq?.username??""]; })
    ));
    setTrExporting(false);
  }

  const cardStyle: React.CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" };
  const headStyle: React.CSSProperties = { padding: "14px 20px", borderBottom: "1px solid var(--line)", background: "var(--bg-surface-elevated)" };
  const selStyle: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, background: "var(--bg-surface-elevated)", color: "var(--text)", cursor: "pointer" };

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <FileDown size={20} color="var(--blue)" />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Exports</h1>
      </div>
      <div style={{ display: "grid", gap: 20 }}>
        {/* Stocked-in */}
        <div style={cardStyle}>
          <div style={headStyle}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Stocked-In Records</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>All serials imported into DC inventory</p>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <DatePicker label="From date" value={siFrom} onChange={setSiFrom} />
              <DatePicker label="To date" value={siTo} onChange={setSiTo} />
              <button type="button" onClick={() => void exportStockedIn()} disabled={siExporting}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: siExporting ? "not-allowed" : "pointer", opacity: siExporting ? 0.7 : 1 }}>
                <Download size={14} /> {siExporting ? "Exporting…" : "Download CSV"}
              </button>
              {siCount !== null && <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>✓ {siCount} rows</span>}
            </div>
          </div>
        </div>
        {/* Transferred */}
        <div style={cardStyle}>
          <div style={headStyle}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Stocked-Out Records</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>All items sent to destination sites</p>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <DatePicker label="From date" value={trFrom} onChange={setTrFrom} />
              <DatePicker label="To date" value={trTo} onChange={setTrTo} />
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Site</label>
                <select value={trSite} onChange={(e) => setTrSite(e.target.value)} style={selStyle}>
                  <option value="">All sites</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.site_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</label>
                <select value={trStatus} onChange={(e) => setTrStatus(e.target.value)} style={selStyle}>
                  <option value="">All</option>
                  {["draft","packed","in_transit","received","cancelled"].map((s) => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => void exportTransferred()} disabled={trExporting}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: trExporting ? "not-allowed" : "pointer", opacity: trExporting ? 0.7 : 1 }}>
                <Download size={14} /> {trExporting ? "Exporting…" : "Download CSV"}
              </button>
              {trCount !== null && <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>✓ {trCount} rows</span>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const REPORTS: { id: ReportId; label: string; description: string }[] = [
  { id: "transfers_by_site",  label: "Transfers by Site",    description: "In-transit and received transfers by destination" },
  { id: "stock_in_this_week", label: "Stock-In This Week",   description: "Batches imported in the last 7 days" },
  { id: "top_moved_parts",    label: "Top Moved Parts",      description: "Most transferred parts by volume" },
];

export function ReportsPage() {
  const [tab, setTab] = useState<"reports" | "exports">("reports");
  const [active, setActive] = useState<ReportId>("transfers_by_site");

  return (
    <AppLayout activeModule="/reports">
      {/* Top tab bar */}
      <nav className="sub-nav" aria-label="Reports pages">
        {(["reports", "exports"] as const).map((t) => (
          <button key={t} type="button"
            className={tab === t ? "sub-tab active" : "sub-tab"}
            onClick={() => setTab(t)}
            style={{ textTransform: "capitalize" }}>
            {t === "reports" ? "Reports" : "Exports"}
          </button>
        ))}
      </nav>

      {tab === "exports" ? (
        <ExportsInline />
      ) : (
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
      )}
    </AppLayout>
  );
}






