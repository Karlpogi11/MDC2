import { useExportInventory } from "@/hooks/useExportInventory";
import { useEffect, useMemo, useState, useCallback, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTableResize } from "@/components/ResizableColumns";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { SerialDrawer } from "@/components/SerialDrawer";
import { ReservedSerialDrawer } from "@/components/ReservedSerialDrawer";
import { ImportHistoryTab } from "@/components/ImportHistoryTab";
import { SerialNumbersTab } from "@/components/SerialNumbersTab";
import {
  ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Download, CheckSquare, ChevronLeft, ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useFeatureFlag } from "@/lib/useFeatureFlag";
import { toCapitalized } from "@/lib/format";
import {
  fetchInventoryRowsCached,
  INVENTORY_PAGE_SIZE,
  inventoryRowsQueryKey,
  NAVIGATION_CACHE_GC_TIME,
  NAVIGATION_CACHE_STALE_TIME,
} from "@/services/navigationCache";

type SortKey =
  | "partName" | "partNumber" | "category"
  | "inStock" | "stockedOut" | "reserved" | "available"
  | "lastStockInAt" | "lastStockOutAt";

type SortState = { key: SortKey; direction: "asc" | "desc" };

type SegmentFilter = "all" | "in_stock" | "stocked_out";

function formatQty(value: number): string { return String(value); }

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function normalizeDateValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function InventoryTab() {
  const inventoryTableRef = useTableResize();
  const exportCSV = useExportInventory();
  const { state: authState } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isDCAdmin = authState.status === "authenticated" && authState.profile.role === "dc_admin";

  // URL-persisted filter state — survives navigation and browser back/forward
  const segment = (searchParams.get("seg") as SegmentFilter) ?? "all";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10) || 0);
  const PAGE_SIZE = INVENTORY_PAGE_SIZE;

  const setSegment = (v: SegmentFilter) => setSearchParams((p) => { p.set("seg", v); p.delete("page"); return p; }, { replace: true });
  const setSearch = (v: string) => setSearchParams((p) => { if (v) p.set("q", v); else p.delete("q"); p.delete("page"); return p; }, { replace: true });
  const setPage = (fn: (p: number) => number) => setSearchParams((p) => { const next = fn(page); if (next > 0) p.set("page", String(next)); else p.delete("page"); return p; }, { replace: true });
  const [debouncedSearch, setDebouncedSearch] = useState(search.trim());
  const [sortState, setSortState] = useState<SortState>({ key: "partName", direction: "asc" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [drawerPart, setDrawerPart] = useState<{ id: string; name: string; number: string; status?: string } | null>(null);
  const [serialLookup, setSerialLookup] = useState<string | null>(null);
  const [reservedDrawerPart, setReservedDrawerPart] = useState<{ id: string; name: string; number: string; reserved: number } | null>(null);
  const closeDrawer = useCallback(() => setDrawerPart(null), []);
  const closeReservedDrawer = useCallback(() => setReservedDrawerPart(null), []);

  const realtimeEnabled = useFeatureFlag("enable_realtime");
  const refreshInventoryCache = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["inventoryRows"] });
  }, [queryClient]);
  const realtimeStatus = useRealtimeTable(["serial_numbers", "transfers", "transfer_items"], refreshInventoryCache, realtimeEnabled);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, search.trim() ? 300 : 0);
    return () => window.clearTimeout(handle);
  }, [search]);

  const inventoryQuery = useQuery({
    queryKey: inventoryRowsQueryKey(page, segment, debouncedSearch),
    queryFn: () => fetchInventoryRowsCached(page, PAGE_SIZE, { segment, search: debouncedSearch }),
    staleTime: NAVIGATION_CACHE_STALE_TIME,
    gcTime: NAVIGATION_CACHE_GC_TIME,
  });

  const state = useMemo(() => {
    const data = inventoryQuery.data;
    return {
      rows: data?.rows ?? [],
      source: data?.source ?? "demo",
      loading: inventoryQuery.isLoading && !data,
      error: data?.errorMessage ?? null,
      total: data?.total ?? (data ? data.rows.length : null),
    };
  }, [inventoryQuery.data, inventoryQuery.isLoading]);

  useEffect(() => {
    const rows = inventoryQuery.data?.rows;
    if (!rows) return;
    if (debouncedSearch.length >= 6 && !debouncedSearch.includes(" ") && rows.length <= 2) {
      setSerialLookup(debouncedSearch);
    } else if (!debouncedSearch) {
      setSerialLookup(null);
    }
  }, [debouncedSearch, inventoryQuery.data]);

  const sortedRows = useMemo(() => {
    const rows = [...state.rows];
    rows.sort((left, right) => {
      let result = 0;
      if (sortState.key === "partName") result = compareString(left.partName, right.partName);
      else if (sortState.key === "partNumber") result = compareString(left.partNumber, right.partNumber);
      else if (sortState.key === "category") result = compareString(left.category, right.category);
      else if (sortState.key === "inStock") result = left.inStock - right.inStock;
      else if (sortState.key === "stockedOut") result = left.stockedOut - right.stockedOut;
      else if (sortState.key === "reserved") result = left.reserved - right.reserved;
      else if (sortState.key === "available") result = left.available - right.available;
      else if (sortState.key === "lastStockInAt") result = (normalizeDateValue(left.lastStockInAt) ?? 0) - (normalizeDateValue(right.lastStockInAt) ?? 0);
      else if (sortState.key === "lastStockOutAt") result = (normalizeDateValue(left.lastStockOutAt) ?? 0) - (normalizeDateValue(right.lastStockOutAt) ?? 0);
      return sortState.direction === "asc" ? result : -result;
    });
    return rows;
  }, [state.rows, sortState]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => sortedRows.some((row) => row.partId === id)));
  }, [sortedRows]);

  useEffect(() => {
    if (focusedRowId && !sortedRows.some((row) => row.partId === focusedRowId)) setFocusedRowId(null);
  }, [focusedRowId, sortedRows]);

  const totals = useMemo(() => sortedRows.reduce(
    (acc, row) => {
      acc.inStock += row.inStock;
      acc.stockedOut += row.stockedOut;
      acc.reserved += row.reserved;
      acc.available += row.available;
      return acc;
    },
    { inStock: 0, stockedOut: 0, reserved: 0, available: 0 }
  ), [sortedRows]);

  const showStockInColumns = segment !== "stocked_out";
  const showStockOutColumns = segment !== "in_stock";
  const visibleColumnCount =
    4 +
    (showStockInColumns ? 4 : 0) +
    (showStockOutColumns ? 2 : 0);

  const focusedRow = useMemo(() => sortedRows.find((row) => row.partId === focusedRowId) ?? null, [focusedRowId, sortedRows]);
  const visibleIds = sortedRows.map((row) => row.partId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedCount = selectedIds.length;

  const toggleSort = (key: SortKey) => setSortState((prev) =>
    prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
  );

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) { setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id))); return; }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const toggleRowSelection = (partId: string) =>
    setSelectedIds((prev) => prev.includes(partId) ? prev.filter((id) => id !== partId) : [...prev, partId]);

  const runTransfer = (partIds: string[]) => {
    const parts = sortedRows.filter((r) => partIds.includes(r.partId)).map((r) => ({ part_number: r.partNumber, part_name: r.partName }));
    navigate("/transfers/new", { state: { prefill: parts } });
  };

  const runBulkAction = (actionLabel: string) => {
    if (selectedCount === 0) return;
    if (actionLabel === "Transfer") { runTransfer(selectedIds); return; }
    setActionFeedback(`${actionLabel} — ${selectedCount} ${selectedCount === 1 ? "item" : "items"} selected.`);
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortState.key !== key) return <ArrowUpDown size={14} aria-hidden="true" />;
    return sortState.direction === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />;
  };

  const renderHeaderButton = (label: string, key: SortKey) => (
    <button className={sortState.key === key ? "col-sort active" : "col-sort"} type="button" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`}>
      <span>{label}</span>{renderSortIcon(key)}
    </button>
  );

  // Dummy serials array for export (InventoryTab doesn't load serials — pass empty, export hook handles gracefully)

  return (
    <main className="inventory-shell">
      {serialLookup && (
        <SerialLookupDrawer serialNumber={serialLookup} onClose={() => setSerialLookup(null)} />
      )}
      {drawerPart && (
        <SerialDrawer
          partId={drawerPart.id}
          partName={drawerPart.name}
          partNumber={drawerPart.number}
          initialStatusFilter={drawerPart.status}
          onClose={closeDrawer}
        />
      )}
      {reservedDrawerPart && (
        <ReservedSerialDrawer
          partId={reservedDrawerPart.id}
          partName={reservedDrawerPart.name}
          partNumber={reservedDrawerPart.number}
          reservedCount={reservedDrawerPart.reserved}
          onClose={closeReservedDrawer}
        />
      )}

      <section className="selector-row">
        <div className="segment-tabs" role="group" aria-label="Inventory segment">
          {(["all", "in_stock", "stocked_out"] as SegmentFilter[]).map((seg) => (
            <button key={seg} type="button" className={segment === seg ? "segment" : "segment ghost"} onClick={() => setSegment(seg)}>
              {seg === "all" ? "All" : seg === "in_stock" ? "In Stock" : "Stocked Out"}
            </button>
          ))}
        </div>
      </section>

      <div className="blue-rule" />

      <section className="action-row">
        <div className="action-left">
              <input
                aria-label="Search inventory"
                placeholder="Search part, category, or serial…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); if (!e.target.value) { setSerialLookup(null); setPage(() => 0); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && search.trim()) setSerialLookup(search.trim()); }}
                className="search-input"
                style={{ fontSize: 13, width: 280, color: "var(--text)" }}
              />
            {search && (
              <button type="button" className="clear-btn" onClick={() => { setSearch(""); setSerialLookup(null); }}
                aria-label="Clear search">
                ×
              </button>
            )}
          <strong style={{ fontSize: 13, color: "var(--muted)" }}>{sortedRows.length} items</strong>
        </div>
        <div className="action-right">
          <button className="icon-btn blue" type="button" aria-label="Export inventory CSV" title="Export all inventory with serials"
            onClick={() => void exportCSV(sortedRows)}>
            <Download aria-hidden="true" />
          </button>
          <button className="icon-btn blue" type="button" aria-label="Refresh inventory" title="Refresh" onClick={() => void inventoryQuery.refetch()}>
            <RefreshCw aria-hidden="true" />
          </button>
          {realtimeEnabled && (
            <span className="circle" title={realtimeStatus === "live" ? "Live" : "Connecting…"} style={{
              width: 8, height: 8, flexShrink: 0, alignSelf: "center",
              background: realtimeStatus === "live" ? "#16a34a" : "#9ca3af",
              animation: realtimeStatus === "live" ? "dot-pulse 2s ease-in-out infinite" : "none",
            }} />
          )}
        </div>
      </section>

      {selectedCount > 0 && (
        <section className="bulk-row" aria-label="Bulk actions">
          <div className="bulk-left"><CheckSquare size={16} aria-hidden="true" /><span>{selectedCount} selected</span></div>
          <div className="bulk-actions">
            <button type="button" className="bulk-btn" onClick={() => runBulkAction("Transfer")}>Transfer selected</button>
            <button type="button" className="bulk-btn" onClick={() => runBulkAction("Export")}>Export selected</button>
            <button type="button" className="bulk-btn ghost" onClick={() => { setSelectedIds([]); setActionFeedback("Selection cleared."); }}>Clear selection</button>
          </div>
        </section>
      )}

      {actionFeedback && (
        <section className="action-feedback" role="status">
          <span>{actionFeedback}</span>
          <button type="button" onClick={() => setActionFeedback(null)} aria-label="Dismiss action status">Dismiss</button>
        </section>
      )}

      {focusedRow && (
        <section className="row-focus-card" aria-label="Part details">
          <div>
            <h3>{focusedRow.partName}</h3>
            <p>Part no: <strong>{focusedRow.partNumber}</strong> | Category: <strong>{focusedRow.category}</strong></p>
          </div>
          <div className="row-focus-actions">
            <button type="button" className="bulk-btn" onClick={() => runTransfer([focusedRow.partId])}>Create transfer</button>
            <button type="button" className="bulk-btn ghost" onClick={() => setFocusedRowId(null)}>Close</button>
          </div>
        </section>
      )}

      {state.error && <section className="error-banner" role="alert">{state.error}</section>}

      <section className="table-card">
        <div className="table-scroll">
          <table ref={inventoryTableRef}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface)" }}>
              <tr>
                <th className="cell-check">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} aria-label="Select all visible rows" />
                </th>
                <th>{renderHeaderButton("Part name", "partName")}</th>
                <th>{renderHeaderButton("Part no.", "partNumber")}</th>
                <th>{renderHeaderButton("Category", "category")}</th>
                {showStockInColumns && <th className="num">{renderHeaderButton("In stock", "inStock")}</th>}
                {showStockInColumns && <th className="num">{renderHeaderButton("Reserved", "reserved")}</th>}
                {showStockInColumns && <th className="num">{renderHeaderButton("Available", "available")}</th>}
                {showStockInColumns && <th>{renderHeaderButton("Last stock-in date", "lastStockInAt")}</th>}
                {showStockOutColumns && <th className="num">{renderHeaderButton("Stocked out", "stockedOut")}</th>}
                {showStockOutColumns && <th>{renderHeaderButton("Last stock-out date", "lastStockOutAt")}</th>}
              </tr>
            </thead>
            <tbody>
              {state.loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="skeleton-row"><td /><td colSpan={visibleColumnCount - 1}><div className="skeleton-line" /></td></tr>
              ))}
              {!state.loading && sortedRows.map((row) => {
                const isSelected = selectedIds.includes(row.partId);
                return (
                  <tr key={row.partId} className={isSelected ? "selected-row" : undefined}>
                    <td className="cell-check">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelection(row.partId)} aria-label={`Select ${row.partName}`} />
                    </td>
                    <td>
                      <button type="button" className="row-link-btn"
                        onClick={() => setDrawerPart({ id: row.partId, name: row.partName, number: row.partNumber })}>
                        {row.partName}
                      </button>
                    </td>
                    <td>{row.partNumber}</td>
                    <td className="capitalize">{toCapitalized(row.category)}</td>
                    {showStockInColumns && (
                      <td className="num">
                        <button type="button" className="row-link-btn num-link-btn"
                          onClick={() => setDrawerPart({ id: row.partId, name: row.partName, number: row.partNumber, status: "in_stock" })}>
                          {formatQty(row.inStock)}
                        </button>
                      </td>
                    )}
                    {showStockInColumns && (
                      <td className="num">
                        <button
                          type="button"
                          className="row-link-btn num-link-btn"
                          onClick={() => setReservedDrawerPart({ id: row.partId, name: row.partName, number: row.partNumber, reserved: row.reserved })}
                        >
                          {formatQty(row.reserved)}
                        </button>
                      </td>
                    )}
                    {showStockInColumns && (
                      <td className={row.available < 0 ? "num negative" : "num"}>
                        <button type="button" className="row-link-btn num-link-btn" onClick={() => setFocusedRowId(row.partId)}>
                          {formatQty(row.available)}
                        </button>
                      </td>
                    )}
                    {showStockInColumns && <td>{formatDate(row.lastStockInAt)}</td>}
                    {showStockOutColumns && (
                      <td className="num">
                        <button type="button" className="row-link-btn num-link-btn"
                          onClick={() => setDrawerPart({ id: row.partId, name: row.partName, number: row.partNumber, status: "transferred" })}>
                          {formatQty(row.stockedOut)}
                        </button>
                      </td>
                    )}
                    {showStockOutColumns && <td>{formatDate(row.lastStockOutAt)}</td>}
                  </tr>
                );
              })}
              {!state.loading && sortedRows.length === 0 && (
                <tr><td colSpan={visibleColumnCount} className="empty-row">No project inventory data found for current filters.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1px solid var(--line)" }}>
                <td />
                <td colSpan={3} style={{ padding: "5px 8px", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                  {sortedRows.length} items
                </td>
                {showStockInColumns && <td className="num" style={{ padding: "5px 8px", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{totals.inStock.toLocaleString()}</td>}
                {showStockInColumns && <td className="num" style={{ padding: "5px 8px", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{totals.reserved.toLocaleString()}</td>}
                {showStockInColumns && <td className="num" style={{ padding: "5px 8px", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{totals.available.toLocaleString()}</td>}
                {showStockInColumns && <td />}
                {showStockOutColumns && <td className="num" style={{ padding: "5px 8px", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{totals.stockedOut.toLocaleString()}</td>}
                {showStockOutColumns && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {state.source === "demo" && (
        <p className="footer-note">Real values require Supabase data in `parts`, `serial_numbers`, `transfers`, and `transfer_items`.</p>
      )}

      {/* Pagination controls */}
      {state.source !== "demo" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 0" }}>
          <button type="button" disabled={page === 0 || state.loading} onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: page === 0 || state.loading ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
            <ChevronLeft size={14} /> Prev
          </button>
          {state.total != null && (
            <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
              Page {page + 1} of {Math.ceil(state.total / PAGE_SIZE).toLocaleString()}
            </span>
          )}
          <button type="button" disabled={state.total != null ? (page + 1) * PAGE_SIZE >= state.total : sortedRows.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: state.total != null && (page + 1) * PAGE_SIZE >= state.total ? "not-allowed" : "pointer", opacity: state.total != null && (page + 1) * PAGE_SIZE >= state.total ? 0.4 : 1 }}>
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </main>
  );
}

// ─── Serial Lookup Drawer ─────────────────────────────────────────────────────

function DrawerRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", width: 100, flexShrink: 0, paddingTop: 1 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", fontFamily: mono ? "monospace" : "inherit", flex: 1, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

function SerialLookupDrawer({ serialNumber, onClose }: { serialNumber: string; onClose: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void load();
  }, [serialNumber]);

  async function load() {
    setLoading(true); setNotFound(false);

    try {
      const row = await api.get(`/serials/${encodeURIComponent(serialNumber)}`);
      if (!row) { setNotFound(true); setLoading(false); return; }

      const items = await api.get(`/serials/${(row as any).id}/transfer-history`);
      setData({ ...row, transfer_items: items ?? [] });
    } catch {
      setNotFound(true);
    }
    setLoading(false);
  }

  const part = data ? (Array.isArray(data.parts) ? data.parts[0] : data.parts) : null;
  const site = data ? (Array.isArray(data.sites) ? data.sites[0] : data.sites) : null;
  const transfers = data ? (data.transfer_items ?? []).map((ti: any) => {
    const t = Array.isArray(ti.transfers) ? ti.transfers[0] : ti.transfers;
    const dest = t ? (Array.isArray(t.sites) ? t.sites[0] : t.sites) : null;
    return { ...t, dest_name: dest?.site_name ?? "—" };
  }) : [];

  const STATUS_COLOR: Record<string, string> = {
    in_stock: "var(--text)", transferred: "var(--muted)", transit: "var(--muted)", in_transit: "var(--muted)", void: "var(--negative)",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200 }} />
      <aside style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 360,
        background: "var(--bg-surface)", borderLeft: "1px solid var(--line)",
        zIndex: 201, display: "flex", flexDirection: "column", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Serial Lookup</div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div className="blue-rule" style={{ margin: 0 }} />

        <div style={{ padding: "16px 20px", flex: 1 }}>
          {loading && <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>}
          {notFound && <div style={{ fontSize: 13, color: "var(--muted)" }}>Serial not found in inventory.</div>}
          {data && (
            <div>
              <DrawerRow label="Serial" value={serialNumber} mono />
              <DrawerRow label="Status" value={data.status?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} />
              {part && <DrawerRow label="Part Name" value={part.part_name} />}
              {part && <DrawerRow label="Part #" value={part.part_number} mono />}
              <DrawerRow label="Location" value={site ? `${site.site_name}${site.site_code ? ` (${site.site_code})` : ""}` : "DC"} />
              <DrawerRow label="Stocked In" value={data.stock_in_at ? new Date(data.stock_in_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" }) : "—"} />
            </div>
          )}
          {transfers.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Transfer History</div>
              {transfers.map((t: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t.transfer_no}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>→ {t.dest_name} · {t.status}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.created_at ? new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export function InventoryPage(): ReactElement {
  const [activeTab, setActiveTab] = useState("Inventory");

  return (
    <AppLayout>
      <nav className="sub-nav" aria-label="Inventory pages">
        {["Inventory", "By Site", "Import History", "Serial numbers"].map((item) => (
          <button key={item} className={item === activeTab ? "sub-tab active" : "sub-tab"} type="button" onClick={() => setActiveTab(item)}>
            {item}
          </button>
        ))}
      </nav>

      {activeTab === "Inventory" && <InventoryTab />}
      {activeTab === "By Site" && <SiteInventoryTab />}
      {activeTab === "Import History" && <main className="inventory-shell"><ImportHistoryTab /></main>}
      {activeTab === "Serial numbers" && <SerialNumbersTab />}
    </AppLayout>
  );
}

// ─── Site Inventory Tab ───────────────────────────────────────────────────────

type SiteRow = {
  site_id: string;
  site_name: string;
  site_code: string;
  part_name: string;
  part_number: string;
  qty: number;
};

function SiteInventoryTab() {
  const [sites, setSites] = useState<{ id: string; site_name: string; site_code: string }[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tableRef = useTableResize();

  useEffect(() => {
    void loadSites();
  }, []);

  useEffect(() => {
    void loadSiteInventory(selectedSite);
  }, [selectedSite]);

  async function loadSites() {
    const data = await api.get("/sites");
    setSites(data ?? []);
  }

  async function loadSiteInventory(siteId: string) {
    setLoading(true); setError(null);
    try {
      const url = siteId !== "all" ? `/inventory/site/${siteId}` : "/inventory/site";
      const data = await api.get(url);

      // Aggregate by site + part
      const map = new Map<string, SiteRow>();
      for (const r of (data ?? []) as any[]) {
        const site = Array.isArray(r.sites) ? r.sites[0] : r.sites;
        const part = Array.isArray(r.parts) ? r.parts[0] : r.parts;
        if (!site || !part) continue;
        const key = `${r.current_site_id}::${part.part_number}`;
        if (!map.has(key)) {
          map.set(key, { site_id: r.current_site_id, site_name: site.site_name, site_code: site.site_code, part_name: part.part_name, part_number: part.part_number, qty: 0 });
        }
        map.get(key)!.qty++;
      }
      setRows(Array.from(map.values()).sort((a, b) => a.site_name.localeCompare(b.site_name) || a.part_name.localeCompare(b.part_name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load site inventory");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="inventory-shell">
      <section className="selector-row">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Site:</label>
          <select
            value={selectedSite}
            onChange={(e) => setSelectedSite(e.target.value)}
            style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "6px 10px", fontSize: 13, background: "var(--bg-surface)", color: "var(--text)" }}
          >
            <option value="all">All Sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.site_name} ({s.site_code})</option>
            ))}
          </select>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{rows.length} part types</span>
        </div>
      </section>
      <div className="blue-rule" />
      {error && <section className="error-banner" role="alert">{error}</section>}
      <section className="table-card">
        <div className="table-scroll">
          <table ref={tableRef}>
            <thead>
              <tr>
                <th>Site</th>
                <th>Code</th>
                <th>Part Name</th>
                <th>Part #</th>
                <th className="num">Qty at Site</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="empty-row">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="empty-row">No transferred inventory found for this site.</td></tr>}
              {!loading && rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{r.site_name}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{r.site_code}</td>
                  <td>{r.part_name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.part_number}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
