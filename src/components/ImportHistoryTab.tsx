import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { useTableResize } from "@/components/ResizableColumns";

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

  if (loading) return <tr><td colSpan={5} style={{ padding: "8px 16px", fontSize: 12, color: "var(--muted)" }}>Loading items…</td></tr>;

  return (
    <>
      <tr>
        <td colSpan={7} style={{ padding: 0, background: "var(--bg-surface-elevated)", borderTop: "1px solid #e5e7eb" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-surface-elevated)" }}>
                  <th style={{ padding: "6px 16px 6px 32px", textAlign: "left", fontWeight: 600, color: "var(--muted)", width: 160 }}>Serial</th>
                  <th style={{ padding: "6px 12px", textAlign: "left", fontWeight: 600, color: "var(--muted)", width: 120 }}>Part #</th>
                  <th style={{ padding: "6px 12px", textAlign: "left", fontWeight: 600, color: "var(--muted)" }}>Part Name</th>
                  <th style={{ padding: "6px 16px", textAlign: "right", fontWeight: 600, color: "var(--muted)", width: 60 }}>Qty</th>
                  <th style={{ padding: "6px 16px", textAlign: "left", fontWeight: 600, color: "var(--muted)", width: 90 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "8px 32px", color: "var(--muted)" }}>No items.</td></tr>
                )}
                {items.map((item) => {
                  const part = Array.isArray(item.part) ? item.part[0] : item.part;
                  const serial = Array.isArray(item.serial) ? item.serial[0] : item.serial;
                  return (
                    <tr key={item.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "5px 16px 5px 32px", fontFamily: "monospace", color: "var(--blue)", fontWeight: 600 }}>{serial?.serial_number ?? "—"}</td>
                      <td style={{ padding: "5px 12px", fontFamily: "monospace", color: "var(--text)" }}>{part?.part_number ?? "—"}</td>
                      <td style={{ padding: "5px 12px", color: "var(--text)" }}>{part?.part_name ?? "—"}</td>
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
          </div>
        </td>
      </tr>
    </>
  );
}

export function ImportHistoryTab() {
  const tableRef = useTableResize();
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
        <table ref={tableRef} style={{ tableLayout: "fixed" as const, minWidth: 660 }}>
          <colgroup>
            <col style={{ width: 160 }} /><col style={{ width: 70 }} />
            <col style={{ width: "auto" }} /><col style={{ width: 60 }} />
            <col style={{ width: 60 }} /><col style={{ width: 70 }} />
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
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={b.source_file_name ?? ""}>{b.source_type === "manual" ? <span style={{ color: "var(--muted)", fontStyle: "italic" }}>Manual entry</span> : (b.source_file_name ?? "—")}</td>
                    <td className="num">{b.total_rows}</td>
                    <td className="num" style={{ color: "var(--text)", fontWeight: 600 }}>{b.success_rows}</td>
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


