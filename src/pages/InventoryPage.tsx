import { useEffect, useMemo, useState, useCallback, type ReactElement } from "react";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { SerialDrawer } from "@/components/SerialDrawer";
import {
  ArrowDown, ArrowUp, ArrowUpDown,
  CalendarDays, CheckSquare, ChevronDown,
  Download, MapPin, Printer,
} from "lucide-react";
import { demoInventoryRows } from "../data/demoInventory";
import { fetchInventoryRows } from "../services/inventory";
import type { InventoryRow, InventorySource } from "../types";
import { getSupabaseClient } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useFeatureFlag } from "@/lib/useFeatureFlag";
import { toCapitalized } from "@/lib/format";

type SerialRow = {
  id: string;
  serial_number: string;
  status: string;
  stock_in_at: string | null;
  parts: { part_number: string; part_name: string } | null;
  sites: { site_name: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In Stock", transit: "In Transit", transferred: "Stocked Out",
  consumed: "Consumed", void: "Void",
};

type SegmentFilter = "all" | "products" | "stocked_out";

type SortKey =
  | "partName"
  | "partNumber"
  | "category"
  | "inStock"
  | "committed"
  | "available"
  | "lastStockInAt"
  | "lastStockOutAt";

type SortState = {
  key: SortKey;
  direction: "asc" | "desc";
};

type LoadState = {
  rows: InventoryRow[];
  source: InventorySource;
  loading: boolean;
  error: string | null;
};

const INITIAL_STATE: LoadState = {
  rows: [],
  source: "demo",
  loading: true,
  error: null,
};

function formatQty(value: number): string {
  return String(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function normalizeDateValue(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function compareString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

// ── Import History tab ───────────────────────────────────────────────────────────────
function BatchItems({ batchId }: { batchId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    client.from("stock_in_items")
      .select("id, quantity, part:parts(part_number, part_name), serial:serial_numbers(serial_number, status)")
      .eq("batch_id", batchId)
      .order("created_at")
      .then(({ data }) => { setItems(data ?? []); setLoading(false); });
  }, [batchId]);

  if (loading) return <tr><td colSpan={7} style={{ padding: "8px 16px", fontSize: 12, color: "#9ca3af" }}>Loading items…</td></tr>;

  return (
    <>
      <tr>
        <td colSpan={7} style={{ padding: 0, background: "#f8fafc", borderTop: "1px solid #e5e7eb" }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: "6px 16px 6px 32px", textAlign: "left", fontWeight: 600, color: "#6b7a8d", width: 160 }}>Serial</th>
                <th style={{ padding: "6px 12px", textAlign: "left", fontWeight: 600, color: "#6b7a8d", width: 120 }}>Part #</th>
                <th style={{ padding: "6px 12px", textAlign: "left", fontWeight: 600, color: "#6b7a8d" }}>Part Name</th>
                <th style={{ padding: "6px 16px", textAlign: "right", fontWeight: 600, color: "#6b7a8d", width: 60 }}>Qty</th>
                <th style={{ padding: "6px 16px", textAlign: "left", fontWeight: 600, color: "#6b7a8d", width: 90 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={5} style={{ padding: "8px 32px", color: "#9ca3af" }}>No items.</td></tr>
              )}
              {items.map((item) => {
                const part = Array.isArray(item.part) ? item.part[0] : item.part;
                const serial = Array.isArray(item.serial) ? item.serial[0] : item.serial;
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "5px 16px 5px 32px", fontFamily: "monospace", color: "var(--blue)", fontWeight: 600 }}>{serial?.serial_number ?? "—"}</td>
                    <td style={{ padding: "5px 12px", fontFamily: "monospace", color: "#374151" }}>{part?.part_number ?? "—"}</td>
                    <td style={{ padding: "5px 12px", color: "#374151" }}>{part?.part_name ?? "—"}</td>
                    <td style={{ padding: "5px 16px", textAlign: "right" }}>{item.quantity}</td>
                    <td style={{ padding: "5px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: serial?.status === "in_stock" ? "#dcfce7" : "#f3f4f6", color: serial?.status === "in_stock" ? "#15803d" : "#6b7a8d" }}>
                        {serial?.status ?? "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

function ImportHistoryTab() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    client.from("stock_in_batches")
      .select("id, source_type, source_file_name, imported_at, total_rows, success_rows, failed_rows, importer:profiles!imported_by(full_name, username)")
      .order("imported_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setBatches(data ?? []); setLoading(false); });
  }, []);

  return (
    <section className="table-card">
      <div className="table-scroll">
        <table style={{ tableLayout: "fixed" as const, minWidth: 700 }}>
          <colgroup>
            <col style={{ width: 160 }} /><col style={{ width: 80 }} />
            <col style={{ width: "auto" }} /><col style={{ width: 80 }} />
            <col style={{ width: 80 }} /><col style={{ width: 80 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Date</th><th>Type</th><th>Source</th>
              <th className="num">Total</th><th className="num">OK</th><th className="num">Failed</th>
              <th>Imported by</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="empty-row">Loading…</td></tr>}
            {!loading && batches.length === 0 && <tr><td colSpan={7} className="empty-row">No imports yet.</td></tr>}
            {batches.map((b) => {
              const importer = Array.isArray(b.importer) ? b.importer[0] : b.importer;
              const isExpanded = expanded === b.id;
              return (
                <>
                  <tr key={b.id} onClick={() => setExpanded(isExpanded ? null : b.id)}
                    style={{ cursor: "pointer", background: isExpanded ? "#f0f7ff" : undefined }}>
                    <td>{new Date(b.imported_at).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: b.source_type === "manual" ? "#f3f4f6" : "#dbeafe", color: b.source_type === "manual" ? "#6b7a8d" : "#1d4ed8" }}>{b.source_type}</span></td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={b.source_file_name ?? ""}>{b.source_type === "manual" ? <span style={{ color: "#9ca3af", fontStyle: "italic" }}>Manual entry</span> : (b.source_file_name ?? "—")}</td>
                    <td className="num">{b.total_rows}</td>
                    <td className="num" style={{ color: "#15803d", fontWeight: 600 }}>{b.success_rows}</td>
                    <td className="num" style={{ color: b.failed_rows > 0 ? "#b91c1c" : undefined, fontWeight: b.failed_rows > 0 ? 600 : undefined }}>{b.failed_rows}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{importer?.full_name ?? importer?.username ?? "—"}</td>
                  </tr>
                  {isExpanded && <BatchItems batchId={b.id} />}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function InventoryPage(): ReactElement {
  const [segment, setSegment] = useState<SegmentFilter>("all");
  const [activeTab, setActiveTab] = useState("Inventory");

  // Serial numbers tab state
  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [serialsLoading, setSerialsLoading] = useState(false);
  const [serialSearch, setSerialSearch] = useState("");

  const filteredSerials = useMemo(() => {
    const q = serialSearch.trim().toLowerCase();
    if (!q) return serials;
    return serials.filter(r =>
      r.serial_number.toLowerCase().includes(q) ||
      r.parts?.part_number.toLowerCase().includes(q) ||
      r.parts?.part_name.toLowerCase().includes(q)
    );
  }, [serials, serialSearch]);

  useEffect(() => {
    if (activeTab !== "Serial numbers") return;
    setSerialsLoading(true);
    const client = getSupabaseClient();
    if (!client) { setSerialsLoading(false); return; }
    void client
      .from("serial_numbers")
      .select("id,serial_number,status,stock_in_at,parts(part_number,part_name),sites:current_site_id(site_name)")
      .order("stock_in_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setSerials((data ?? []) as unknown as SerialRow[]);
        setSerialsLoading(false);
      });
  }, [activeTab]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<LoadState>(INITIAL_STATE);
  const { state: authState } = useAuth();
  const isSystemAdmin = authState.status === "authenticated" && authState.profile.role === "system_admin";

  const realtimeEnabled = useFeatureFlag("enable_realtime");
  const realtimeStatus = useRealtimeTable("serial_numbers", () => void loadInventory(), realtimeEnabled);

  const [drawerPart, setDrawerPart] = useState<{ id: string; name: string; number: string } | null>(null);
  const closeDrawer = useCallback(() => setDrawerPart(null), []);
  const [sortState, setSortState] = useState<SortState>({
    key: "partName",
    direction: "asc",
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const loadInventory = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchInventoryRows();
      setState({
        rows: result.rows,
        source: result.source,
        loading: false,
        error: null,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Failed to load inventory";
      setState({
        rows: demoInventoryRows,
        source: "demo",
        loading: false,
        error: `Unable to load project inventory (${reason}).`,
      });
    }
  };

  useEffect(() => {
    void loadInventory();
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.rows.filter((row) => {
      if (segment === "products" && row.partType !== "product") return false;
      if (segment === "stocked_out" && row.available > 0) return false; // only show parts with 0 available (all transferred out)
      if (!q) return true;
      return (
        row.partName.toLowerCase().includes(q) ||
        row.partNumber.toLowerCase().includes(q) ||
        row.category.toLowerCase().includes(q)
      );
    });
  }, [search, segment, state.rows]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];

    rows.sort((left, right) => {
      let result = 0;

      if (sortState.key === "partName") {
        result = compareString(left.partName, right.partName);
      } else if (sortState.key === "partNumber") {
        result = compareString(left.partNumber, right.partNumber);
      } else if (sortState.key === "category") {
        result = compareString(left.category, right.category);
      } else if (sortState.key === "inStock") {
        result = left.inStock - right.inStock;
      } else if (sortState.key === "committed") {
        result = left.committed - right.committed;
      } else if (sortState.key === "available") {
        result = left.available - right.available;
      } else if (sortState.key === "lastStockInAt") {
        result = (normalizeDateValue(left.lastStockInAt) ?? 0) - (normalizeDateValue(right.lastStockInAt) ?? 0);
      } else if (sortState.key === "lastStockOutAt") {
        result = (normalizeDateValue(left.lastStockOutAt) ?? 0) - (normalizeDateValue(right.lastStockOutAt) ?? 0);
      }

      return sortState.direction === "asc" ? result : -result;
    });

    return rows;
  }, [filteredRows, sortState]);

  useEffect(() => {
    setSelectedIds((previous) => previous.filter((id) => sortedRows.some((row) => row.partId === id)));
  }, [sortedRows]);

  useEffect(() => {
    if (!focusedRowId) {
      return;
    }

    if (!sortedRows.some((row) => row.partId === focusedRowId)) {
      setFocusedRowId(null);
    }
  }, [focusedRowId, sortedRows]);

  const selectedCount = selectedIds.length;
  const visibleIds = sortedRows.map((row) => row.partId);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((partId) => selectedIds.includes(partId));

  const totals = useMemo(() => {
    return sortedRows.reduce(
      (acc, row) => {
        acc.inStock += row.inStock;
        acc.committed += row.committed;
        acc.available += row.available;
        return acc;
      },
      { inStock: 0, committed: 0, available: 0 },
    );
  }, [sortedRows]);

  const focusedRow = useMemo(
    () => sortedRows.find((row) => row.partId === focusedRowId) ?? null,
    [focusedRowId, sortedRows],
  );

  const toggleSort = (key: SortKey) => {
    setSortState((previous) => {
      if (previous.key === key) {
        return { key, direction: previous.direction === "asc" ? "desc" : "asc" };
      }

      return { key, direction: "asc" };
    });
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((previous) => previous.filter((partId) => !visibleIds.includes(partId)));
      return;
    }

    setSelectedIds((previous) => Array.from(new Set([...previous, ...visibleIds])));
  };

  const toggleRowSelection = (partId: string) => {
    setSelectedIds((previous) =>
      previous.includes(partId)
        ? previous.filter((current) => current !== partId)
        : [...previous, partId],
    );
  };

  const runBulkAction = (actionLabel: string) => {
    if (selectedCount === 0) {
      return;
    }

    setActionFeedback(`${actionLabel} prepared for ${selectedCount} selected item(s).`);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setActionFeedback("Selection cleared.");
  };

  const clearFeedback = () => {
    setActionFeedback(null);
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortState.key !== key) {
      return <ArrowUpDown size={14} aria-hidden="true" />;
    }

    if (sortState.direction === "asc") {
      return <ArrowUp size={14} aria-hidden="true" />;
    }

    return <ArrowDown size={14} aria-hidden="true" />;
  };

  const renderHeaderButton = (label: string, key: SortKey) => {
    const isActive = sortState.key === key;

    return (
      <button
        className={isActive ? "col-sort active" : "col-sort"}
        type="button"
        onClick={() => toggleSort(key)}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        {renderSortIcon(key)}
      </button>
    );
  };

  return (
    <AppLayout>
      {drawerPart && (
        <SerialDrawer
          partId={drawerPart.id}
          partName={drawerPart.name}
          partNumber={drawerPart.number}
          onClose={closeDrawer}
        />
      )}
      <nav className="sub-nav" aria-label="Inventory pages">
        {["Inventory", "Import History", "Serial numbers"].map((item) => (
          <button key={item} className={item === activeTab ? "sub-tab active" : "sub-tab"} type="button" onClick={() => setActiveTab(item)}>
            {item}
          </button>
        ))}
      </nav>

      {activeTab === "Serial numbers" && (
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
              <strong style={{ marginLeft: 8, fontSize: 13, color: "#6b7a8d" }}>
                {serialsLoading ? "Loading…" : `${filteredSerials.length} serials`}
              </strong>
            </div>
          </section>
          <section className="table-card">
            <div className="table-scroll">
              <table>
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
                  {serialsLoading && Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="skeleton-row"><td /><td colSpan={5}><div className="skeleton-line" /></td></tr>
                  ))}
                  {!serialsLoading && filteredSerials.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontFamily: "monospace", fontSize: 13 }}>{r.serial_number}</td>
                        <td>{r.parts?.part_number ?? "—"}</td>
                        <td>{r.parts?.part_name ?? "—"}</td>
                        <td>
                          <span style={{
                            display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 600,
                            background: r.status === "in_stock" ? "#dcfce7" : r.status === "transferred" ? "#dbeafe" : "#f3f4f6",
                            color: r.status === "in_stock" ? "#15803d" : r.status === "transferred" ? "#1d4ed8" : "#374151",
                          }}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                        </td>
                        <td>{r.sites?.site_name ?? "—"}</td>
                        <td>{r.stock_in_at ? new Date(r.stock_in_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" }) : "—"}</td>
                      </tr>
                    ))}
                  {!serialsLoading && filteredSerials.length === 0 && (
                    <tr><td colSpan={6} className="empty-row">{serials.length === 0 ? "No serials found." : "No serials match your search."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {activeTab === "Inventory" && (
      <main className="inventory-shell">
        <section className="selector-row">
          <div className="segment-tabs" role="group" aria-label="Inventory segment">
            <button
              type="button"
              className={segment === "all" ? "segment" : "segment ghost"}
              onClick={() => setSegment("all")}
            >
              All
            </button>
            <button
              type="button"
              className={segment === "products" ? "segment" : "segment ghost"}
              onClick={() => setSegment("products")}
            >
              Products
            </button>
            <button
              type="button"
              className={segment === "stocked_out" ? "segment" : "segment ghost"}
              onClick={() => setSegment("stocked_out")}
            >
              Stocked Out
            </button>
          </div>

          <div className="balance-controls">
            <span className="balance-label">Inventory snapshot:</span>
            <button className="control-btn" type="button">
              <CalendarDays className="control-icon" aria-hidden="true" />
              As of: Today
              <ChevronDown className="control-chevron" aria-hidden="true" />
            </button>
            <button className="control-btn" type="button">
              <MapPin className="control-icon" aria-hidden="true" />
              Site: Main warehouse
              <ChevronDown className="control-chevron" aria-hidden="true" />
            </button>
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
            <button className="icon-btn blue" type="button" aria-label="Export inventory" onClick={() => runBulkAction("Export")}>
              <Download aria-hidden="true" />
            </button>
            <button className="icon-btn" type="button" aria-label="Print list">
              <Printer aria-hidden="true" />
            </button>
            <button className="icon-btn" type="button" aria-label="Refresh inventory" onClick={() => void loadInventory()}>
              <ArrowUpDown aria-hidden="true" />
            </button>
            {realtimeEnabled && (
              <span title={realtimeStatus === "live" ? "Live" : "Connecting…"} style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0, alignSelf: "center",
                background: realtimeStatus === "live" ? "#16a34a" : "#9ca3af",
                animation: realtimeStatus === "live" ? "dot-pulse 2s ease-in-out infinite" : "none",
              }} />
            )}
          </div>
        </section>

        {selectedCount > 0 && (
          <section className="bulk-row" aria-label="Bulk actions">
            <div className="bulk-left">
              <CheckSquare size={16} aria-hidden="true" />
              <span>{selectedCount} selected</span>
            </div>
            <div className="bulk-actions">
              <button type="button" className="bulk-btn" onClick={() => runBulkAction("Transfer")}>Transfer selected</button>
              <button type="button" className="bulk-btn" onClick={() => runBulkAction("Export")}>Export selected</button>
              <button type="button" className="bulk-btn ghost" onClick={clearSelection}>Clear selection</button>
            </div>
          </section>
        )}

        {actionFeedback && (
          <section className="action-feedback" role="status">
            <span>{actionFeedback}</span>
            <button type="button" onClick={clearFeedback} aria-label="Dismiss action status">
              Dismiss
            </button>
          </section>
        )}

        {focusedRow && (
          <section className="row-focus-card" aria-label="Part details">
            <div>
              <h3>{focusedRow.partName}</h3>
              <p>
                Part no: <strong>{focusedRow.partNumber}</strong> | Category: <strong>{focusedRow.category}</strong>
              </p>
            </div>
            <div className="row-focus-actions">
              <button type="button" className="bulk-btn" onClick={() => runBulkAction("Transfer")}>Create transfer</button>
              <button type="button" className="bulk-btn" onClick={() => runBulkAction("Export")}>Export part</button>
              <button type="button" className="bulk-btn ghost" onClick={() => setFocusedRowId(null)}>Close</button>
            </div>
          </section>
        )}

        {state.error && (
          <section className="error-banner" role="alert">
            {state.error}
          </section>
        )}

        <section className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="cell-check">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all visible rows"
                    />
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

                {state.loading &&
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={`sk-${index}`} className="skeleton-row">
                      <td />
                      <td colSpan={8}>
                        <div className="skeleton-line" />
                      </td>
                    </tr>
                  ))}

                {!state.loading &&
                  sortedRows.map((row) => {
                    const isSelected = selectedIds.includes(row.partId);

                    return (
                      <tr key={row.partId} className={isSelected ? "selected-row" : undefined}>
                        <td className="cell-check">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(row.partId)}
                            aria-label={`Select ${row.partName}`}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="row-link-btn"
                            onClick={() => setDrawerPart({ id: row.partId, name: row.partName, number: row.partNumber })}
                          >
                            {row.partName}
                          </button>
                        </td>
                        <td>{row.partNumber}</td>
                        <td className="capitalize">{toCapitalized(row.category)}</td>
                        <td className="num">
                          <button
                            type="button"
                            className="row-link-btn num-link-btn"
                            onClick={() => setFocusedRowId(row.partId)}
                          >
                            {formatQty(row.inStock)}
                          </button>
                        </td>
                        <td className="num">
                          <button
                            type="button"
                            className="row-link-btn num-link-btn"
                            onClick={() => setFocusedRowId(row.partId)}
                          >
                            {formatQty(row.committed)}
                          </button>
                        </td>
                        <td className={row.available < 0 ? "num negative" : "num"}>{formatQty(row.available)}</td>
                        <td>{formatDate(row.lastStockInAt)}</td>
                        <td>{formatDate(row.lastStockOutAt)}</td>
                      </tr>
                    );
                  })}

                {!state.loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty-row">
                      No project inventory data found for current filters.
                    </td>
                  </tr>
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
          <p className="footer-note">
            Real values require Supabase data in `parts`, `serial_numbers`, `transfers`, and
            `transfer_items`.
          </p>
        )}
      </main>
      )}

      {activeTab === "Import History" && (
        <main className="inventory-shell">
          <ImportHistoryTab />
        </main>
      )}

    </AppLayout>
  );
}

// keep at module level so it's injected once
const _style = document.createElement("style");
_style.textContent = `@keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`;
document.head.appendChild(_style);
