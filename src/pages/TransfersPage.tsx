import { friendlyError } from "@/lib/friendlyError";
import { useTableResize } from "@/components/ResizableColumns";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/AppLayout";

type TransferStatus = "draft" | "packed" | "in_transit" | "received" | "cancelled";

type TransferRow = {
  id: string;
  transferNo: string;
  status: TransferStatus;
  createdAt: string;
  packedAt: string | null;
  destinationSite: { siteName: string; siteCode: string } | null;
  requestedByProfile: { fullName: string | null; username: string | null } | null;
  itemCount: number;
};

const PAGE_SIZE = 30;

function getAge(transfer: TransferRow): string | null {
  if (transfer.status === "received" || transfer.status === "cancelled") return null;
  const from = transfer.packedAt ?? transfer.createdAt;
  const ms = Date.now() - new Date(from).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

const STATUS_STYLE: Record<TransferStatus, { bg: string; color: string; label: string }> = {
  draft:      { bg: "var(--bg-surface-elevated)", color: "var(--muted)",    label: "Draft" },
  packed:     { bg: "var(--bg-surface-elevated)", color: "var(--blue)",     label: "Packed" },
  in_transit: { bg: "var(--bg-surface-elevated)", color: "var(--muted)",    label: "In Transit" },
  received:   { bg: "var(--bg-surface-elevated)", color: "var(--text)",     label: "Received" },
  cancelled:  { bg: "var(--bg-surface-elevated)", color: "var(--negative)", label: "Cancelled" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function formatRow(row: any): TransferRow {
  return {
    id: row.id,
    transferNo: row.transferNo,
    status: row.status,
    createdAt: row.createdAt,
    packedAt: row.packedAt,
    destinationSite: Array.isArray(row.destinationSite) ? row.destinationSite[0] ?? null : row.destinationSite,
    requestedByProfile: Array.isArray(row.requestedByProfile) ? row.requestedByProfile[0] ?? null : row.requestedByProfile,
    itemCount: Array.isArray(row.transfer_items) ? row.transfer_items.length : 0,
  };
}

export function TransfersPage() {
  const navigate = useNavigate();
  const tableRef = useTableResize();
  const [statusFilter, setStatusFilter] = useState<TransferStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: "transferNo" | "destination" | "items" | "date"; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  // Pagination state
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function toggleSort(key: typeof sort.key) {
    setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }
  function SortIcon({ k }: { k: typeof sort.key }) {
    if (sort.key !== k) return <ArrowUpDown size={12} style={{ opacity: 0.4 }} />;
    return sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  }

  function applySorter(rows: TransferRow[]) {
    return [...rows].sort((a, b) => {
      const mul = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "transferNo") return mul * a.transferNo.localeCompare(b.transferNo);
      if (sort.key === "destination") return mul * ((a.destinationSite?.siteName ?? "").localeCompare(b.destinationSite?.siteName ?? ""));
      if (sort.key === "items") return mul * (a.itemCount - b.itemCount);
      return mul * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
  }

  const fetchPage = useCallback(async (p: number, status: string) => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (status !== "all") params.set("status", status);
      const data = await api.get(`/transfers?${params.toString()}`);
      setTransfers(applySorter(((data as any).data ?? []).map(formatRow)));
      setTotalCount((data as any).total ?? 0);
    } catch (err) {
      setFetchError(err instanceof Error ? friendlyError(err) : "Failed to load transfers.");
    }
    setLoading(false);
  }, []);

  // Fetch on mount and when page/status changes
  useEffect(() => { fetchPage(page, statusFilter); }, [page, statusFilter, fetchPage]);

  // Client-side re-sort when sort column/direction changes
  useEffect(() => { setTransfers((prev) => applySorter(prev)); }, [sort]);

  // Client-side search filter
  const filtered = transfers.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.transferNo.toLowerCase().includes(q) ||
      (t.destinationSite?.siteName ?? "").toLowerCase().includes(q) ||
      (t.destinationSite?.siteCode ?? "").toLowerCase().includes(q)
    );
  });

  // Poll for updates every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchPage(page, statusFilter), 15000);
    return () => clearInterval(interval);
  }, [page, statusFilter, fetchPage]);

  function goToPage(p: number) { setPage(Math.max(0, Math.min(p, pageCount - 1))); }
  function handleRefresh() { fetchPage(page, statusFilter); }

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            Transfers {!loading && totalCount > 0 && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>({totalCount.toLocaleString()})</span>}
          </h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={handleRefresh}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 12, cursor: "pointer" }}>
              <RefreshCw size={12} />
            </button>
            <button
              type="button"
              onClick={() => navigate("/transfers/templates")}
              style={{ background: "var(--bg-surface)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Templates
            </button>
            <button
              type="button"
              onClick={() => navigate("/transfers/new")}
              style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              New transfer
            </button>
          </div>
        </div>

        {/* Status filter tabs + search */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
          <div style={{ display: "flex" }}>
          {(["all", "draft", "packed", "in_transit", "received", "cancelled"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatusFilter(s); setPage(0); }}
              style={{
                border: "none", borderBottom: `2px solid ${statusFilter === s ? "var(--blue)" : "transparent"}`,
                borderRadius: 0, padding: "5px 10px", fontSize: 13, fontWeight: statusFilter === s ? 600 : 400,
                cursor: "pointer", background: "transparent",
                color: statusFilter === s ? "var(--blue)" : "var(--text)",
                marginBottom: -1,
              }}
            >
              {s === "all" ? "All" : STATUS_STYLE[s].label}
            </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transfers…"
            className="search-input"
            style={{ fontSize: 13, width: 200, color: "var(--text)", marginBottom: 4 }}
          />
        </div>

        <section className="table-card">
          <div className="table-scroll" style={{ maxHeight: "80vh" }}>
          <table ref={tableRef}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface)" }}>
              <tr>
                <th><button className="col-sort" type="button" onClick={() => toggleSort("transferNo")}><span>Transfer #</span><SortIcon k="transferNo" /></button></th>
                <th><button className="col-sort" type="button" onClick={() => toggleSort("destination")}><span>Destination</span><SortIcon k="destination" /></button></th>
                <th className="num"><button className="col-sort" type="button" onClick={() => toggleSort("items")}><span>Items</span><SortIcon k="items" /></button></th>
                <th>Status</th>
                <th>Age</th>
                <th>Requested by</th>
                <th><button className="col-sort" type="button" onClick={() => toggleSort("date")}><span>Date</span><SortIcon k="date" /></button></th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="empty-row">Loading…</td></tr>
              )}
              {fetchError && (
                <tr><td colSpan={8} className="empty-row" style={{ color: "var(--negative)" }}>
                  Failed to load transfers: {fetchError}
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    <FileText size={28} color="#d1d5db" style={{ marginBottom: 8 }} />
                    <p style={{ margin: "0 0 10px", color: "var(--muted)" }}>No transfers found.</p>
                    <button type="button" onClick={() => navigate("/transfers/new")}
                      style={{ background: "var(--blue)", color: "#fff", border: "none", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Create first transfer
                    </button>
                  </td>
                </tr>
              )}
              {!loading && filtered.map((t) => {
                const s = STATUS_STYLE[t.status];
                return (
                  <tr key={t.id}>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--blue)", fontFamily: "monospace" }}>
                      {t.transferNo}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {t.destinationSite
                        ? <><span style={{ fontWeight: 600 }}>{t.destinationSite.siteName}</span> <span style={{ color: "var(--muted)", fontSize: 11 }}>{t.destinationSite.siteCode}</span></>
                        : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td className="num" style={{ padding: "10px 12px" }}>{t.itemCount}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span className="status-badge" style={{ background: s.bg, color: s.color }}>
                        {s.label}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {(() => {
                        const age = getAge(t);
                        if (age === null) return <span style={{ color: "var(--muted)" }}>—</span>;
                        const overdue = age.endsWith("d") && parseInt(age) > 3;
                        return (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: overdue ? 700 : 400, color: overdue ? "var(--negative)" : "var(--muted)" }}>
                            {overdue && <span title="Overdue — in transit more than 3 days">⚠️</span>}
                            {age}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>
                      {t.requestedByProfile?.fullName ?? t.requestedByProfile?.username ?? "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{formatDate(t.createdAt)}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <button type="button" onClick={() => navigate(`/transfers/${t.id}`)}
                        style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>

        {totalCount > PAGE_SIZE && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 0" }}>
            <button type="button" disabled={page === 0 || loading} onClick={() => goToPage(page - 1)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: page === 0 || loading ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
              <ChevronLeft size={14} /> Prev
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
              Page {page + 1} of {pageCount.toLocaleString()}
            </span>
            <button type="button" disabled={(page + 1) * PAGE_SIZE >= totalCount || loading} onClick={() => goToPage(page + 1)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: (page + 1) * PAGE_SIZE >= totalCount || loading ? "not-allowed" : "pointer", opacity: (page + 1) * PAGE_SIZE >= totalCount ? 0.4 : 1 }}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </main>
    </AppLayout>
  );
}
