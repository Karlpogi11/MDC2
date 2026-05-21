import { useState, useEffect, useRef } from "react";
import { X, Search, Clock } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Serial = {
  id: string;
  serial_number: string;
  status: string;
  stock_in_at: string;
  current_site: { site_name: string; site_code: string } | null;
};

type TimelineEvent = {
  id: string;
  at: string;
  action: string;
  actor: string | null;
  site: string | null;
  note: string | null;
  color: string;
};

type Props = {
  partId: string;
  partName: string;
  partNumber: string;
  initialStatusFilter?: string;
  onClose: () => void;
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  in_stock:    { bg: "#dcfce7", color: "var(--text)", label: "In Stock" },
  in_transit:  { bg: "#fef9c3", color: "var(--muted)", label: "In Transit" },
  transit:     { bg: "#fef9c3", color: "var(--muted)", label: "In Transit" },
  transferred: { bg: "#dbeafe", color: "var(--blue)", label: "Stocked Out" },
  consumed:    { bg: "#f3f4f6", color: "var(--muted)", label: "Consumed" },
  void:        { bg: "#fee2e2", color: "var(--negative)", label: "Void" },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function actionColor(action: string): string {
  if (action.includes("stock") || action.includes("insert")) return "#15803d";
  if (action.includes("transit") || action.includes("transfer")) return "#1d4ed8";
  if (action.includes("receiv")) return "#7c3aed";
  if (action.includes("void") || action.includes("cancel")) return "#b91c1c";
  if (action.includes("correct")) return "#d97706";
  return "#6b7a8d";
}

function actionLabel(action: string, newVal: any, oldVal: any): string {
  const nv = newVal ?? {};
  const ov = oldVal ?? {};
  if (action === "insert") return "Stocked In";
  if (action === "update") {
    const ns = nv.status; const os = ov.status;
    if (ns && ns !== os) {
      if (ns === "in_transit" || ns === "transit") return "Dispatched (In Transit)";
      if (ns === "transferred") return "Received at Site";
      if (ns === "void") return "Voided";
      if (ns === "consumed") return "Consumed";
      if (ns === "in_stock") return "Returned to Stock";
      return `Status -> ${ns}`;
    }
    if (nv.current_site_id && nv.current_site_id !== ov.current_site_id) return "Site Updated";
    return "Updated";
  }
  if (action === "delete") return "Deleted";
  return action;
}

function SerialTimeline({ serialId, serialNumber }: { serialId: string; serialNumber: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;

    Promise.all([
      // Audit log events for this serial
      client.from("audit_logs")
        .select("id, action, old_value, new_value, note, created_at, actor:profiles!actor_id(full_name, username)")
        .eq("entity_type", "serial_numbers")
        .eq("entity_id", serialId)
        .order("created_at", { ascending: true }),

      // Transfer history — transfers this serial was part of
      client.from("transfer_items")
        .select("id, transfer:transfers(id, transfer_no, status, created_at, packed_at, destination_site:sites!destination_site_id(site_name), source_site:sites!source_site_id(site_name))")
        .eq("serial_id", serialId),

      // Corrections involving this serial
      client.from("serial_corrections")
        .select("id, old_serial_number, new_serial_number, reason, corrected_at, corrected_by:profiles!corrected_by(full_name, username)")
        .eq("serial_id", serialId)
        .order("corrected_at", { ascending: true }),
    ]).then(([auditRes, transferRes, correctionRes]) => {
      const timeline: TimelineEvent[] = [];

      // Audit log events
      for (const row of (auditRes.data ?? [])) {
        const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
        const nv = row.new_value as any;
        const ov = row.old_value as any;
        const label = actionLabel(row.action, nv, ov);
        // Derive site from new_value if available
        let site: string | null = null;
        if (nv?.current_site_id) site = null; // resolved below if needed

        timeline.push({
          id: `audit-${row.id}`,
          at: row.created_at,
          action: label,
          actor: actor?.full_name ?? actor?.username ?? null,
          site,
          note: row.note ?? null,
          color: actionColor(row.action + label.toLowerCase()),
        });
      }

      // Transfer events
      for (const item of (transferRes.data ?? [])) {
        const t = Array.isArray(item.transfer) ? item.transfer[0] : item.transfer;
        if (!t) continue;
        const dest = Array.isArray(t.destination_site) ? t.destination_site[0] : t.destination_site;
        const src = Array.isArray(t.source_site) ? t.source_site[0] : t.source_site;

        if (t.created_at) {
          timeline.push({
            id: `tr-created-${t.id}`,
            at: t.created_at,
            action: `Added to Transfer ${t.transfer_no}`,
            actor: null,
            site: src?.site_name ?? null,
            note: null,
            color: "var(--muted)",
          });
        }
        if (t.packed_at) {
          timeline.push({
            id: `tr-packed-${t.id}`,
            at: t.packed_at,
            action: `Packed - ${t.transfer_no}`,
            actor: null,
            site: src?.site_name ?? null,
            note: `→ ${dest?.site_name ?? "unknown"}`,
            color: "var(--blue)",
          });
        }
        if (t.status === "received") {
          timeline.push({
            id: `tr-received-${t.id}`,
            at: t.packed_at ?? t.created_at,
            action: `Received at ${dest?.site_name ?? "site"}`,
            actor: null,
            site: dest?.site_name ?? null,
            note: t.transfer_no,
            color: "var(--muted)",
          });
        }
      }

      // Correction events
      for (const c of (correctionRes.data ?? [])) {
        const by = Array.isArray(c.corrected_by) ? c.corrected_by[0] : c.corrected_by;
        timeline.push({
          id: `corr-${c.id}`,
          at: c.corrected_at,
          action: `Serial Corrected`,
          actor: by?.full_name ?? by?.username ?? null,
          site: null,
          note: `${c.old_serial_number} -> ${c.new_serial_number}: ${c.reason}`,
          color: "var(--muted)",
        });
      }

      // Sort by time
      timeline.sort((a, b) => a.at.localeCompare(b.at));
      setEvents(timeline);
      setLoading(false);
    });
  }, [serialId]);

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading history...</div>;
  if (!events.length) return <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No history found.</div>;

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ position: "relative" }}>
        {/* Vertical line */}
        <div style={{ position: "absolute", left: 11, top: 8, bottom: 8, width: 2, background: "#e5e7eb" }} />

        {events.map((ev, i) => (
          <div key={ev.id} style={{ display: "flex", gap: 16, marginBottom: i < events.length - 1 ? 20 : 0, position: "relative" }}>
            {/* Dot */}
            <div className="circle" style={{
              width: 24, height: 24, borderRadius: "50%", background: ev.color,
              flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 1, marginTop: 2,
            }}>
              <div className="circle" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--bg-surface)" }} />
            </div>

            {/* Content */}
            <div style={{ flex: 1, paddingBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{ev.action}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {fmt(ev.at)}
                {ev.actor && <span> · {ev.actor}</span>}
                {ev.site && <span> · <strong style={{ color: "var(--text)" }}>{ev.site}</strong></span>}
              </div>
              {ev.note && (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>{ev.note}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SerialDrawer({ partId, partName, partNumber, initialStatusFilter, onClose }: Props) {
  const [serials, setSerials] = useState<Serial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter ?? "all");
  const [activeTab, setActiveTab] = useState<"serials" | "history">("serials");
  const [selectedSerial, setSelectedSerial] = useState<Serial | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    client
      .from("serial_numbers")
      .select("id, serial_number, status, stock_in_at, current_site:sites!current_site_id(site_name, site_code)")
      .eq("part_id", partId)
      .order("stock_in_at", { ascending: false })
      .then(({ data }) => {
        setSerials((data ?? []).map((s: any) => ({
          ...s,
          current_site: Array.isArray(s.current_site) ? s.current_site[0] ?? null : s.current_site,
        })));
        setLoading(false);
      });

    setTimeout(() => searchRef.current?.focus(), 50);
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [partId, onClose]);

  useEffect(() => {
    setStatusFilter(initialStatusFilter ?? "all");
  }, [initialStatusFilter, partId]);

  const filtered = serials.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (search && !s.serial_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = serials.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 560, background: "var(--bg-surface)", zIndex: 101, display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: "var(--bg-surface-elevated)", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{partName}</h2>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--blue)", background: "var(--bg-surface-elevated)", padding: "1px 6px", borderRadius: "var(--radius-sm)", display: "inline-block" }}>{partNumber}</span>
            </div>
            <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {!loading && activeTab === "serials" && (
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setStatusFilter("all")}
                style={{ border: `1px solid ${statusFilter === "all" ? "var(--blue)" : "var(--line)"}`, borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", background: statusFilter === "all" ? "var(--blue)" : "transparent", color: statusFilter === "all" ? "#fff" : "var(--muted)" }}>
                All ({serials.length})
              </button>
              {Object.entries(counts).map(([status, count]) => {
                const s = STATUS_STYLE[status] ?? { bg: "#f3f4f6", color: "var(--muted)", label: status };
                const active = statusFilter === status;
                return (
                  <button key={status} type="button" onClick={() => setStatusFilter(status)}
                    style={{ border: `1px solid ${active ? s.color : "var(--line)"}`, borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", background: active ? s.color : "transparent", color: active ? "#fff" : "var(--muted)" }}>
                    {s.label} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          {([["serials", "Serials"], ["history", "Chain of Custody"]] as const).map(([tab, label]) => (
            <button key={tab} type="button" onClick={() => { setActiveTab(tab); setSelectedSerial(null); }}
              style={{ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: activeTab === tab ? 700 : 400, color: activeTab === tab ? "var(--blue)" : "var(--muted)", background: "transparent", border: "none", borderBottom: `2px solid ${activeTab === tab ? "var(--blue)" : "transparent"}`, cursor: "pointer", marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </div>

        {activeTab === "serials" && (
          <>
            <div style={{ padding: "10px 20px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
              <div style={{ position: "relative" }}>
                <Search size={14} color="#9ca3af" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search serial number..."
                  style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px 7px 30px", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loading && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading serials...</div>}
              {!loading && filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{search ? `No serials matching "${search}"` : "No serials found."}</div>}
              {!loading && filtered.map((serial, i) => {
                const sm = STATUS_STYLE[serial.status] ?? { bg: "#f3f4f6", color: "var(--muted)", label: serial.status };
                return (
                  <div key={serial.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 12, padding: "10px 20px", borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <div>
                      <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: "var(--blue)", marginBottom: 2 }}>{serial.serial_number}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        Stocked in {fmtDate(serial.stock_in_at)}
                        {serial.current_site && <span> · {serial.current_site.site_name}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: sm.bg, color: sm.color, whiteSpace: "nowrap" }}>{sm.label}</span>
                    <button
                      type="button"
                      onClick={() => { setSelectedSerial(serial); setActiveTab("history"); }}
                      aria-label={`View history for ${serial.serial_number}`}
                      title={`View history for ${serial.serial_number}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--blue)",
                        background: "var(--bg-surface-elevated)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--radius-sm)",
                        padding: "3px 8px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Clock size={10} />View
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", background: "var(--bg-surface-elevated)", flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>
              {!loading && `Showing ${filtered.length} of ${serials.length} serials`}
            </div>
          </>
        )}

        {activeTab === "history" && (
          <>
            {/* Serial selector */}
            <div style={{ padding: "10px 20px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
              <select value={selectedSerial?.id ?? ""} onChange={(e) => {
                const s = serials.find(x => x.id === e.target.value) ?? null;
                setSelectedSerial(s);
              }} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px", fontSize: 13, outline: "none", fontFamily: "monospace" }}>
                <option value="">- select a serial to view history -</option>
                {serials.map(s => <option key={s.id} value={s.id}>{s.serial_number}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {selectedSerial
                ? <SerialTimeline serialId={selectedSerial.id} serialNumber={selectedSerial.serial_number} />
                : <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Select a serial above to view its chain of custody.</div>
              }
            </div>
          </>
        )}
      </div>
    </>
  );
}


