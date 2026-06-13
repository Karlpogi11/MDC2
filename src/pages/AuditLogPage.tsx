import { useState, useEffect } from "react";
import { ShieldAlert, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/AppLayout";
import { useTableResize } from "@/components/ResizableColumns";

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  note: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  actor: { full_name: string | null; username: string | null } | null;
};

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  insert:  { bg: "var(--bg-surface-elevated)", color: "var(--link)" },
  update:  { bg: "var(--bg-surface-elevated)", color: "var(--blue)" },
  delete:  { bg: "var(--bg-surface-elevated)", color: "var(--negative)" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Map technical field names to human-readable labels
const FIELD_LABELS: Record<string, string> = {
  status:           "Status",
  serial_number:    "Serial number",
  part_id:          "Part",
  serial_id:        "Serial",
  current_site_id:  "Current site",
  source_site_id:   "From site",
  destination_site_id: "To site",
  transfer_id:      "Transfer",
  stock_in_at:      "Stocked in at",
  packed_at:        "Packed at",
  fixably_series:   "Fixably series",
  qty:              "Quantity",
  is_active:        "Active",
  part_number:      "Part number",
  part_name:        "Part name",
  category:         "Category",
  site_name:        "Site name",
  full_name:        "Full name",
  role:             "Role",
  invoice_ref:      "Invoice ref",
};

const SKIP_FIELDS = new Set(["updated_at", "created_at", "row_hash", "prev_hash", "id", "requested_by", "packed_by"]);

function humanValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") {
    // ISO date
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return v;
  }
  return String(v);
}

function diffSummary(
  action: string,
  entity_type: string,
  old_value: Record<string, unknown> | null,
  new_value: Record<string, unknown> | null,
  note: string | null,
): string {
  if (note) return note;

  if (action === "insert" && new_value) {
    if (entity_type === "serial_numbers") return `Serial ${new_value.serial_number ?? ""} stocked in`;
    if (entity_type === "transfers") return `Transfer ${new_value.transfer_no ?? ""} created`;
    if (entity_type === "transfer_items") return `Item added to transfer`;
    return `${entity_type} created`;
  }

  if (action === "delete" && old_value) {
    if (entity_type === "serial_numbers") return `Serial ${old_value.serial_number ?? ""} deleted`;
    return `${entity_type} deleted`;
  }

  if (action === "update" && old_value && new_value) {
    const changed = Object.keys(new_value).filter(
      k => !SKIP_FIELDS.has(k) && JSON.stringify(old_value[k]) !== JSON.stringify(new_value[k])
    );
    if (changed.length === 0) return "No visible changes";

    // Special case: status transition
    if (changed.includes("status")) {
      return `Status: ${humanValue(old_value.status)} → ${humanValue(new_value.status)}`;
    }

    return changed
      .map(k => `${FIELD_LABELS[k] ?? k}: ${humanValue(old_value[k])} → ${humanValue(new_value[k])}`)
      .join(" · ");
  }

  return "—";
}

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const tableRef = useTableResize();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterSerial, setFilterSerial] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    void load();
  }, [filterAction, filterEntity, filterSerial, page]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (filterAction) params.set("action", filterAction);
    if (filterEntity) params.set("entity_type", filterEntity);
    if (filterSerial.trim()) params.set("serial", filterSerial.trim());
    const result = await api.get("/audit-logs?" + params.toString());
    setRows((result.data ?? []).map((r: any) => ({
      ...r,
      actor: Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor,
    })));
    setTotal(result.total ?? 0);
    setLoading(false);
  }

  const entityTypes = ["serial_numbers", "transfers", "transfer_items", "parts", "sites", "profiles"];

  return (
    <AppLayout>
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <ShieldAlert size={18} color="var(--blue)" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Audit Log</h1>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{total.toLocaleString()} entries</span>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0); }}
            style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, background: "var(--bg-surface)", outline: "none" }}>
            <option value="">All actions</option>
            <option value="insert">Insert</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </select>
          <select value={filterEntity} onChange={e => { setFilterEntity(e.target.value); setPage(0); }}
            style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, background: "var(--bg-surface)", outline: "none" }}>
            <option value="">All entities</option>
            {entityTypes.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <input
            value={filterSerial}
            onChange={e => { setFilterSerial(e.target.value); setPage(0); }}
            placeholder="Filter by serial…"
            className="search-input"
            style={{ fontSize: 13, width: 200, color: "var(--text)" }}
          />
        </div>

        <div className="table-card">
          <div className="table-scroll">
            <table ref={tableRef}>
                <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface)" }}>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Changes</th>
                  </tr>
                </thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="empty-row">Loading…</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={5} className="empty-row">No audit entries.</td></tr>}
                {rows.map(row => {
                  const ac = ACTION_COLORS[row.action] ?? { bg: "var(--bg-surface-elevated)", color: "var(--text)" };
                  const actor = row.actor?.full_name ?? row.actor?.username ?? "system";
                  const label = diffSummary(row.action, row.entity_type, row.old_value, row.new_value, row.note);
                  return (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{formatDate(row.created_at)}</td>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{actor}</td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: ac.bg, color: ac.color, textTransform: "uppercase" }}>
                          {row.action}
                        </span>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text)" }}>{row.entity_type}</td>
                      <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 0" }}>
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: page === 0 || loading ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
              <ChevronLeft size={14} /> Prev
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
              Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button type="button" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(p => p + 1)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: (page + 1) * PAGE_SIZE >= total || loading ? "not-allowed" : "pointer", opacity: (page + 1) * PAGE_SIZE >= total ? 0.4 : 1 }}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </main>
    </AppLayout>
  );
}



