import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTableResize } from "@/components/ResizableColumns";
import { getSupabaseClient } from "@/lib/supabase";

type SerialRow = {
  id: string;
  serial_number: string;
  status: string;
  stock_in_at: string | null;
  parts: { part_number: string; part_name: string } | null;
  sites: { site_name: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In Stock", in_transit: "In Transit", transit: "In Transit",
  transferred: "Stocked Out", consumed: "Consumed", void: "Void",
};

const PAGE_SIZE = 100;

export function SerialNumbersTab() {
  const tableRef = useTableResize();
  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [serialSearch, setSerialSearch] = useState("");
  const [serialStatusFilter, setSerialStatusFilter] = useState("");
  const cursorRef = useRef<string | null>(null);

  const loadPage = useCallback(async (reset = false) => {
    const client = getSupabaseClient();
    if (!client) return;
    setLoading(true);

    let query = client
      .from("serial_numbers")
      .select("id,serial_number,status,stock_in_at,parts(part_number,part_name),sites:current_site_id(site_name)")
      .order("stock_in_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);

    if (!reset && cursorRef.current) {
      query = query.lt("stock_in_at", cursorRef.current);
    }

    const { data } = await query;
    const rows = (data ?? []) as unknown as SerialRow[];

    setSerials(prev => reset ? rows : [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    if (rows.length > 0) {
      cursorRef.current = rows[rows.length - 1].stock_in_at;
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    cursorRef.current = null;
    void loadPage(true);
  }, [loadPage]);

  // Realtime refresh
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    const channel = client
      .channel("serial-list-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "serial_numbers" }, () => {
        cursorRef.current = null;
        void loadPage(true);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loadPage]);

  const filteredSerials = useMemo(() => {
    const q = serialSearch.trim().toLowerCase();
    return serials.filter(r => {
      if (serialStatusFilter && r.status !== serialStatusFilter) return false;
      if (!q) return true;
      return (
        r.serial_number.toLowerCase().includes(q) ||
        r.parts?.part_number.toLowerCase().includes(q) ||
        r.parts?.part_name.toLowerCase().includes(q)
      );
    });
  }, [serials, serialSearch, serialStatusFilter]);

  return (
    <main className="inventory-shell">
      <section className="action-row" style={{ marginBottom: 12 }}>
        <div className="action-left">
          <input
            aria-label="Search serials"
            placeholder="Search serial or part…"
            value={serialSearch}
            onChange={(e) => setSerialSearch(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "7px 12px", fontSize: 13, width: 260, outline: "none" }}
          />
          <select
            value={serialStatusFilter}
            onChange={(e) => setSerialStatusFilter(e.target.value)}
            style={{ border: "1px solid #d1d5db", padding: "7px 10px", fontSize: 13, color: "#374151", background: "#fff", cursor: "pointer" }}
          >
            <option value="">All statuses</option>
            <option value="in_stock">In Stock</option>
            <option value="in_transit">In Transit</option>
            <option value="transferred">Transferred</option>
          </select>
          <strong style={{ marginLeft: 8, fontSize: 13, color: "#6b7a8d" }}>
            {loading && serials.length === 0 ? "Loading…" : `${filteredSerials.length} serials`}
          </strong>
        </div>
      </section>
      <section className="table-card">
        <div className="table-scroll">
          <table ref={tableRef}>
            <thead>
              <tr>
                <th>Serial number</th>
                <th>Part number</th>
                <th>Part name</th>
                <th>Status</th>
                <th>Site</th>
                <th>Stocked in</th>
              </tr>
            </thead>
            <tbody>
              {loading && serials.length === 0 && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="skeleton-row"><td /><td colSpan={5}><div className="skeleton-line" /></td></tr>
              ))}
              {filteredSerials.map(r => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{r.serial_number}</td>
                  <td>{r.parts?.part_number ?? "—"}</td>
                  <td>{r.parts?.part_name ?? "—"}</td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 600,
                      background: r.status === "in_stock" ? "#dcfce7" : r.status === "transferred" ? "#dbeafe" : (r.status === "in_transit" || r.status === "transit") ? "#fef9c3" : "#f3f4f6",
                      color: r.status === "in_stock" ? "#15803d" : r.status === "transferred" ? "#1d4ed8" : (r.status === "in_transit" || r.status === "transit") ? "#a16207" : "#374151",
                    }}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td>{r.sites?.site_name ?? "—"}</td>
                  <td>{r.stock_in_at ? new Date(r.stock_in_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" }) : "—"}</td>
                </tr>
              ))}
              {!loading && filteredSerials.length === 0 && (
                <tr><td colSpan={6} className="empty-row">{serials.length === 0 ? "No serials found." : "No serials match your search."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e7eb" }}>
            <button
              type="button"
              onClick={() => void loadPage()}
              disabled={loading}
              style={{ fontSize: 13, fontWeight: 600, color: "var(--blue)", background: "none", border: "1px solid var(--blue)", padding: "6px 16px", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Loading…" : `Load more (${serials.length} loaded)`}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
