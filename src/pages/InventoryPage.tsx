import { friendlyError } from "@/lib/friendlyError";
import { useExportInventory } from "@/hooks/useExportInventory";
import { useEffect, useMemo, useState, useCallback, type ReactElement } from "react";
import { useTableResize } from "@/components/ResizableColumns";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { SerialDrawer } from "@/components/SerialDrawer";
import { ImportHistoryTab } from "@/components/ImportHistoryTab";
import { SerialNumbersTab } from "@/components/SerialNumbersTab";
import {
  ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Download, CheckSquare,
} from "lucide-react";
import { demoInventoryRows } from "../data/demoInventory";
import { fetchInventoryRows } from "../services/inventory";
import type { InventoryRow, InventorySource } from "../types";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useFeatureFlag } from "@/lib/useFeatureFlag";
import { toCapitalized } from "@/lib/format";

type SortKey =
  | "partName" | "partNumber" | "category"
  | "inStock" | "committed" | "available"
  | "lastStockInAt" | "lastStockOutAt";

type SortState = { key: SortKey; direction: "asc" | "desc" };

type LoadState = {
  rows: InventoryRow[];
  source: InventorySource;
  loading: boolean;
  error: string | null;
};

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
  const isDCAdmin = authState.status === "authenticated" && authState.profile.role === "dc_admin";

  // URL-persisted filter state — survives navigation and browser back/forward
  const segment = (searchParams.get("seg") as SegmentFilter) ?? "all";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10) || 0);
  const PAGE_SIZE = 50;

  const setSegment = (v: SegmentFilter) => setSearchParams((p) => { p.set("seg", v); p.delete("page"); return p; }, { replace: true });
  const setSearch = (v: string) => setSearchParams((p) => { if (v) p.set("q", v); else p.delete("q"); p.delete("page"); return p; }, { replace: true });
  const setPage = (fn: (p: number) => number) => setSearchParams((p) => { const next = fn(page); if (next > 0) p.set("page", String(next)); else p.delete("page"); return p; }, { replace: true });
  const [state, setState] = useState<LoadState>({ rows: [], source: "demo", loading: true, error: null });
  const [sortState, setSortState] = useState<SortState>({ key: "partName", direction: "asc" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [drawerPart, setDrawerPart] = useState<{ id: string; name: string; number: string } | null>(null);
  const closeDrawer = useCallback(() => setDrawerPart(null), []);

  const realtimeEnabled = useFeatureFlag("enable_realtime");
  const realtimeStatus = useRealtimeTable(["serial_numbers", "transfers", "transfer_items"], () => void loadInventory(page), realtimeEnabled);

  const loadInventory = async (p = page) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await fetchInventoryRows(p, PAGE_SIZE);
      setState({ rows: result.rows, source: result.source, loading: false, error: null });
    } catch (error) {
      const reason = error instanceof Error ? friendlyError(error) : "Failed to load inventory";
      setState({ rows: demoInventoryRows, source: "demo", loading: false, error: `Unable to load project inventory (${reason}).` });
    }
  };

  useEffect(() => { void loadInventory(page); }, [page]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.rows.filter((row) => {
      if (segment === "in_stock" && row.available <= 0) return false;
      if (segment === "stocked_out" && row.available > 0) return false;
      if (!q) return true;
      return row.partName.toLowerCase().includes(q) || row.partNumber.toLowerCase().includes(q) || row.category.toLowerCase().includes(q);
    });
  }, [search, segment, state.rows]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((left, right) => {
      let result = 0;
      if (sortState.key === "partName") result = compareString(left.partName, right.partName);
      else if (sortState.key === "partNumber") result = compareString(left.partNumber, right.partNumber);
      else if (sortState.key === "category") result = compareString(left.category, right.category);
      else if (sortState.key === "inStock") result = left.inStock - right.inStock;
      else if (sortState.key === "committed") result = left.committed - right.committed;
      else if (sortState.key === "available") result = left.available - right.available;
      else if (sortState.key === "lastStockInAt") result = (normalizeDateValue(left.lastStockInAt) ?? 0) - (normalizeDateValue(right.lastStockInAt) ?? 0);
      else if (sortState.key === "lastStockOutAt") result = (normalizeDateValue(left.lastStockOutAt) ?? 0) - (normalizeDateValue(right.lastStockOutAt) ?? 0);
      return sortState.direction === "asc" ? result : -result;
    });
    return rows;
  }, [filteredRows, sortState]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => sortedRows.some((row) => row.partId === id)));
  }, [sortedRows]);

  useEffect(() => {
    if (focusedRowId && !sortedRows.some((row) => row.partId === focusedRowId)) setFocusedRowId(null);
  }, [focusedRowId, sortedRows]);

  const totals = useMemo(() => sortedRows.reduce(
    (acc, row) => { acc.inStock += row.inStock; acc.committed += row.committed; acc.available += row.available; return acc; },
    { inStock: 0, committed: 0, available: 0 }
  ), [sortedRows]);

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
  const emptySerials: never[] = [];

  return (
    <main className="inventory-shell">
      {drawerPart && <SerialDrawer partId={drawerPart.id} partName={drawerPart.name} partNumber={drawerPart.number} onClose={closeDrawer} />}

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
            placeholder="Search part name, number, or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "7px 12px", fontSize: 13, width: 300, outline: "none" }}
          />
          <strong style={{ fontSize: 13, color: "#6b7a8d" }}>{sortedRows.length} items</strong>
        </div>
        <div className="action-right">
          <button className="icon-btn blue" type="button" aria-label="Export inventory CSV" title="Export all inventory with serials"
            onClick={() => exportCSV(sortedRows, emptySerials)}>
            <Download aria-hidden="true" />
          </button>
          <button className="icon-btn" type="button" aria-label="Refresh inventory" onClick={() => void loadInventory(page)}>
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
            <thead>
              <tr>
                <th className="cell-check">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} aria-label="Select all visible rows" />
                </th>
                <th>{renderHeaderButton("Part name", "partName")}</th>
                <th>{renderHeaderButton("Part no.", "partNumber")}</th>
                <th>{renderHeaderButton("Category", "category")}</th>
                <th className="num">{renderHeaderButton("In stock", "inStock")}</th>
                <th className="num">{renderHeaderButton("Reserved", "committed")}</th>
                <th className="num">{renderHeaderButton("Available", "available")}</th>
                <th>{renderHeaderButton("Last stock-in date", "lastStockInAt")}</th>
                <th>{renderHeaderButton("Last stock-out date", "lastStockOutAt")}</th>
              </tr>
            </thead>
            <tbody>
              {state.loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="skeleton-row"><td /><td colSpan={8}><div className="skeleton-line" /></td></tr>
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
                    <td className="num">
                      <button type="button" className="row-link-btn num-link-btn" onClick={() => setFocusedRowId(row.partId)}>{formatQty(row.inStock)}</button>
                    </td>
                    <td className="num">
                      <button type="button" className="row-link-btn num-link-btn" onClick={() => setFocusedRowId(row.partId)}>{formatQty(row.committed)}</button>
                    </td>
                    <td className={row.available < 0 ? "num negative" : "num"}>{formatQty(row.available)}</td>
                    <td>{formatDate(row.lastStockInAt)}</td>
                    <td>{formatDate(row.lastStockOutAt)}</td>
                  </tr>
                );
              })}
              {!state.loading && sortedRows.length === 0 && (
                <tr><td colSpan={9} className="empty-row">No project inventory data found for current filters.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0" }}>
                <td />
                <td colSpan={3} style={{ padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {sortedRows.length} items
                </td>
                <td className="num" style={{ padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#15803d" }}>{totals.inStock.toLocaleString()}</td>
                <td className="num" style={{ padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#b45309" }}>{totals.committed.toLocaleString()}</td>
                <td className="num" style={{ padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#1d4ed8" }}>{totals.available.toLocaleString()}</td>
                <td colSpan={2} />
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", fontSize: 13, color: "#6b7a8d" }}>
          <span>
            Page {page + 1} · showing {sortedRows.length} of {PAGE_SIZE} per page
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || state.loading}
              style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: "var(--radius)", padding: "5px 14px", fontSize: 13, fontWeight: 600, cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={sortedRows.length < PAGE_SIZE || state.loading}
              style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: "var(--radius)", padding: "5px 14px", fontSize: 13, fontWeight: 600, cursor: sortedRows.length < PAGE_SIZE ? "not-allowed" : "pointer", opacity: sortedRows.length < PAGE_SIZE ? 0.4 : 1 }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export function InventoryPage(): ReactElement {
  const [activeTab, setActiveTab] = useState("Inventory");

  return (
    <AppLayout>
      <nav className="sub-nav" aria-label="Inventory pages">
        {["Inventory", "Import History", "Serial numbers"].map((item) => (
          <button key={item} className={item === activeTab ? "sub-tab active" : "sub-tab"} type="button" onClick={() => setActiveTab(item)}>
            {item}
          </button>
        ))}
      </nav>

      {activeTab === "Inventory" && <InventoryTab />}
      {activeTab === "Import History" && <main className="inventory-shell"><ImportHistoryTab /></main>}
      {activeTab === "Serial numbers" && <SerialNumbersTab />}
    </AppLayout>
  );
}
