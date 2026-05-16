import { useState, useEffect } from "react";
import { Download, FileDown } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";

type Site = { id: string; site_name: string; site_code: string };

function toCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers.map(escape), ...rows.map((r) => r.map(escape))].join("\n");
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export function ExportsPage() {
  const [sites, setSites] = useState<Site[]>([]);

  // Stocked-in filters
  const [siFrom, setSiFrom] = useState("");
  const [siTo, setSiTo] = useState("");
  const [siExporting, setSiExporting] = useState(false);
  const [siCount, setSiCount] = useState<number | null>(null);

  // Transferred filters
  const [trFrom, setTrFrom] = useState("");
  const [trTo, setTrTo] = useState("");
  const [trSite, setTrSite] = useState("");
  const [trStatus, setTrStatus] = useState("");
  const [trExporting, setTrExporting] = useState(false);
  const [trCount, setTrCount] = useState<number | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    client.from("sites").select("id,site_name,site_code").eq("is_active", true).eq("is_dc", false).order("site_name")
      .then(({ data }) => setSites((data ?? []) as Site[]));
  }, []);

  async function exportStockedIn() {
    setSiExporting(true); setSiCount(null);
    const client = getSupabaseClient();
    if (!client) { setSiExporting(false); return; }

    let q = client
      .from("serial_numbers")
      .select(`
        serial_number, status, stock_in_at,
        part:parts(part_number, part_name, category),
        site:sites!current_site_id(site_name, site_code),
        batch:stock_in_batches(source_type, imported_at)
      `)
      .order("stock_in_at", { ascending: false })
      .limit(10000);

    if (siFrom) q = q.gte("stock_in_at", siFrom);
    if (siTo)   q = q.lte("stock_in_at", siTo + "T23:59:59");

    const { data } = await q;
    const rows = (data ?? []) as any[];
    setSiCount(rows.length);

    const csv = toCSV(
      ["Serial Number", "Part Number", "Part Name", "Category", "Status", "Site", "Stock-In Date", "Import Type"],
      rows.map((r) => {
        const part = Array.isArray(r.part) ? r.part[0] : r.part;
        const site = Array.isArray(r.site) ? r.site[0] : r.site;
        const batch = Array.isArray(r.batch) ? r.batch[0] : r.batch;
        return [
          r.serial_number ?? "",
          part?.part_number ?? "",
          part?.part_name ?? "",
          part?.category ?? "",
          r.status ?? "",
          site?.site_name ?? "",
          formatDate(r.stock_in_at),
          batch?.source_type ?? "",
        ];
      })
    );

    downloadCSV(`mdc-stocked-in-${new Date().toISOString().slice(0,10)}.csv`, csv);
    setSiExporting(false);
  }

  async function exportStockedOut() {
    setTrExporting(true); setTrCount(null);
    const client = getSupabaseClient();
    if (!client) { setTrExporting(false); return; }

    let q = client
      .from("transfer_items")
      .select(`
        qty,
        part:parts(part_number, part_name, category),
        serial:serial_numbers(serial_number),
        transfer:transfers(
          transfer_no, status, created_at, packed_at,
          destination:sites!destination_site_id(site_name, site_code),
          requester:profiles!requested_by(full_name, username)
        )
      `)
      .limit(10000);

    const { data } = await q;
    let rows = (data ?? []) as any[];

    // Apply all filters in a single clean pass
    rows = rows.filter((r) => {
      const t = Array.isArray(r.transfer) ? r.transfer[0] : r.transfer;
      if (!t) return false;
      if (trStatus && t.status !== trStatus) return false;
      if (trFrom && t.created_at < trFrom) return false;
      if (trTo && t.created_at > trTo + "T23:59:59") return false;
      if (trSite) {
        const dest = Array.isArray(t.destination) ? t.destination[0] : t.destination;
        if (dest?.id !== trSite) return false;
      }
      return true;
    });

    setTrCount(rows.length);

    const csv = toCSV(
      ["Transfer #", "Serial Number", "Part Number", "Part Name", "Category", "Qty", "Destination", "Status", "Created Date", "Packed Date", "Requested By"],
      rows.map((r) => {
        const part = Array.isArray(r.part) ? r.part[0] : r.part;
        const serial = Array.isArray(r.serial) ? r.serial[0] : r.serial;
        const t = Array.isArray(r.transfer) ? r.transfer[0] : r.transfer;
        const dest = Array.isArray(t?.destination) ? t.destination[0] : t?.destination;
        const req = Array.isArray(t?.requester) ? t.requester[0] : t?.requester;
        return [
          t?.transfer_no ?? "",
          serial?.serial_number ?? "",
          part?.part_number ?? "",
          part?.part_name ?? "",
          part?.category ?? "",
          String(r.qty ?? 1),
          dest?.site_name ?? "",
          t?.status ?? "",
          formatDate(t?.created_at),
          formatDate(t?.packed_at),
          req?.full_name ?? req?.username ?? "",
        ];
      })
    );

    downloadCSV(`mdc-stocked-out-${new Date().toISOString().slice(0,10)}.csv`, csv);
    setTrExporting(false);
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "8px 10px",
    fontSize: 13, outline: "none", fontFamily: "inherit", background: "#fff",
  };

  return (
    <AppLayout>
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <FileDown size={20} color="var(--blue)" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>Exports</h1>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          {/* Stocked-in export */}
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2d2d" }}>Stocked-In Records</h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>All serials imported into DC inventory</p>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>From date</label>
                  <input type="date" value={siFrom} onChange={(e) => setSiFrom(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>To date</label>
                  <input type="date" value={siTo} onChange={(e) => setSiTo(e.target.value)} style={inputStyle} />
                </div>
                <button type="button" onClick={() => void exportStockedIn()} disabled={siExporting}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: siExporting ? "#6b8fc4" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: siExporting ? "not-allowed" : "pointer" }}>
                  <Download size={14} /> {siExporting ? "Exporting…" : "Download CSV"}
                </button>
                {siCount !== null && (
                  <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ {siCount} rows exported</span>
                )}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#9ca3af" }}>
                Columns: Serial Number, Part Number, Part Name, Category, Status, Site, Stock-In Date, Import Type
              </p>
            </div>
          </div>

          {/* Transferred export */}
          <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", background: "#f7f7f7" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2d2d" }}>Stocked Out Records</h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>All items sent to destination sites</p>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>From date</label>
                  <input type="date" value={trFrom} onChange={(e) => setTrFrom(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>To date</label>
                  <input type="date" value={trTo} onChange={(e) => setTrTo(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Destination site</label>
                  <select value={trSite} onChange={(e) => setTrSite(e.target.value)} style={{ ...inputStyle, cursor: "pointer", minWidth: 160 }}>
                    <option value="">All sites</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.site_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</label>
                  <select value={trStatus} onChange={(e) => setTrStatus(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="">All statuses</option>
                    {["draft","packed","in_transit","received","cancelled"].map((s) => (
                      <option key={s} value={s}>{s.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>
                <button type="button" onClick={() => void exportStockedOut()} disabled={trExporting}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: trExporting ? "#6b8fc4" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: trExporting ? "not-allowed" : "pointer" }}>
                  <Download size={14} /> {trExporting ? "Exporting…" : "Download CSV"}
                </button>
                {trCount !== null && (
                  <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ {trCount} rows exported</span>
                )}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#9ca3af" }}>
                Columns: Transfer #, Serial, Part Number, Part Name, Category, Qty, Destination, Status, Created Date, Packed Date, Requested By
              </p>
            </div>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
