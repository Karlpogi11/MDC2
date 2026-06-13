import { useCallback, useEffect, useRef, useState } from "react";
import { useTableResize } from "@/components/ResizableColumns";
import { api } from "@/lib/api";

type SerialRow = {
  id: string;
  serial_number: string;
  status: string;
  stock_in_at: string | null;
  parts: { partNumber: string; partName: string } | null;
  sites: { siteName: string } | null;
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const cursorRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPage = useCallback(async (reset = false, searchVal = search, statusVal = statusFilter) => {
    setLoading(true);
    if (reset) cursorRef.current = null;

    const params = new URLSearchParams();
    if (searchVal.trim()) params.set("q", searchVal.trim());
    if (statusVal) params.set("status", statusVal);
    params.set("page", cursorRef.current ?? "0");
    params.set("limit", String(PAGE_SIZE));

    const data = await api.get("/serials?" + params.toString());
    const rows = (data ?? []) as unknown as SerialRow[];

    setSerials(prev => reset ? rows : [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    const curPage = parseInt(cursorRef.current ?? "0", 10);
    cursorRef.current = String(curPage + 1);
    setLoading(false);
  }, [search, statusFilter]);

  // Debounced search — reset cursor and reload on change
  function handleSearch(val: string) {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      cursorRef.current = null;
      void loadPage(true, val, statusFilter);
    }, 300);
  }

  function handleStatusFilter(val: string) {
    setStatusFilter(val);
    cursorRef.current = null;
    void loadPage(true, search, val);
  }

  useEffect(() => {
    cursorRef.current = null;
    void loadPage(true);
  }, []);

  return (
    <main className="inventory-shell">
      <section className="action-row" style={{ marginBottom: 12 }}>
        <div className="action-left">
          <input
            aria-label="Search serials"
            placeholder="Search serial number…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, width: 260, outline: "none" }}
          />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
            style={{ border: "1px solid var(--line)", padding: "5px 8px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", cursor: "pointer" }}
          >
            <option value="">All statuses</option>
            <option value="in_stock">In Stock</option>
            <option value="in_transit">In Transit</option>
            <option value="transferred">Transferred</option>
          </select>
          <strong style={{ marginLeft: 8, fontSize: 13, color: "var(--muted)" }}>
            {loading && serials.length === 0 ? "Loading…" : `${serials.length} serials`}
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
              {serials.map(r => {
                const part = Array.isArray(r.parts) ? r.parts[0] : r.parts;
                const site = Array.isArray(r.sites) ? r.sites[0] : r.sites;
                return (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>{r.serial_number}</td>
                    <td>{part?.partNumber ?? "—"}</td>
                    <td>{part?.partName ?? "—"}</td>
                    <td>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 600,
                        background: "var(--bg-surface-elevated)",
                        color: r.status === "in_stock" ? "var(--link)" : r.status === "transferred" ? "var(--muted)" : (r.status === "in_transit" || r.status === "transit") ? "var(--muted)" : "var(--muted)",
                      }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td>{site?.siteName ?? "—"}</td>
                    <td>{r.stock_in_at ? new Date(r.stock_in_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" }) : "—"}</td>
                  </tr>
                );
              })}
              {!loading && serials.length === 0 && (
                <tr><td colSpan={6} className="empty-row">No serials found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e7eb" }}>
            <button
              type="button"
              onClick={() => void loadPage(false)}
              disabled={loading}
              style={{ fontSize: 13, fontWeight: 600, color: "var(--blue)", background: "none", border: "1px solid var(--blue)", padding: "4px 10px", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Loading…" : `Load more (${serials.length} loaded)`}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}



