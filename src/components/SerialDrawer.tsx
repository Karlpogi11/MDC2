import { useState, useEffect, useRef } from "react";
import { X, Search, Clock } from "lucide-react";
import { api } from "@/lib/api";

type Serial = {
  id: string;
  serialNumber: string;
  status: string;
  currentSiteId: string | null;
  stockInAt: string;
  site: { siteName: string; siteCode: string } | null;
  dispatched?: boolean;
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
  in_stock:    { bg: "var(--bg-surface-elevated)", color: "var(--link)",  label: "In Stock" },
  in_transit:  { bg: "var(--bg-surface-elevated)", color: "var(--muted)", label: "In Transit" },
  transit:     { bg: "var(--bg-surface-elevated)", color: "var(--muted)", label: "In Transit" },
  transferred: { bg: "var(--bg-surface-elevated)", color: "var(--muted)", label: "Stocked Out" },
  consumed:    { bg: "var(--bg-surface-elevated)", color: "var(--muted)",    label: "Consumed" },
  void:        { bg: "var(--bg-surface-elevated)", color: "var(--negative)", label: "Void" },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function actionColor(action: string): string {
  if (action.includes("stock") || action.includes("insert")) return "var(--blue)";
  if (action.includes("transit") || action.includes("transfer")) return "var(--muted)";
  if (action.includes("receiv")) return "var(--muted)";
  if (action.includes("void") || action.includes("cancel")) return "var(--negative)";
  if (action.includes("correct")) return "var(--muted)";
  return "var(--muted)";
}

function actionLabel(action: string, newVal: any, oldVal: any): string {
  const nv = newVal ?? {};
  const ov = oldVal ?? {};
  if (action === "insert") return "Stocked In";
  if (action === "update") {
    const ns = nv.status; const os = ov.status;
    if (ns && ns !== os) {
      if (ns === "in_transit" || ns === "transit" || ns === "transferred") return "Dispatched";
      if (ns === "void") return "Voided";
      if (ns === "consumed") return "Consumed";
      if (ns === "in_stock") return "Returned to Stock";
      return `Status -> ${ns}`;
    }
    if (nv.currentSiteId && nv.currentSiteId !== ov.currentSiteId) return "Site Updated";
    return "Updated";
  }
  if (action === "delete") return "Deleted";
  return action;
}

function SerialTimeline({ serialId, serialNumber, stockInAt }: { serialId: string; serialNumber: string; stockInAt?: string | null }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/serials/" + serialId + "/audit-logs"),
      api.get("/serials/" + serialId + "/transfer-history"),
      api.get("/serials/" + serialId + "/corrections"),
    ]).then(([auditData, transferData, correctionData]) => {
      const timeline: TimelineEvent[] = [];

      // Audit log events
      for (const row of (auditData ?? [])) {
        const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
        const nv = row.newValue as any;
        const ov = row.oldValue as any;
        const label = actionLabel(row.action, nv, ov);

        // Skip audit events that duplicate transfer events
        if (row.action === "update" && nv?.status && nv.status !== ov?.status) {
          if (["in_transit", "transit", "transferred"].includes(nv.status)) continue;
          if (nv.status === "in_stock" && row.note?.includes("Received")) continue;
        }

        timeline.push({
          id: `audit-${row.id}`,
          at: row.createdAt,
          action: label,
          actor: actor?.fullName ?? actor?.username ?? null,
          site: null,
          note: row.note ?? null,
          color: actionColor(row.action + label.toLowerCase()),
        });
      }

      // Add synthetic Stocked In event if audit log has no insert
      const hasInsert = (auditData ?? []).some((r: any) => r.action === "insert");
      if (!hasInsert && stockInAt) {
        timeline.push({
          id: `stockin-${serialId}`,
          at: stockInAt,
          action: "Stocked In",
          actor: null,
          site: null,
          note: null,
          color: "var(--muted)",
        });
      }

      // Transfer events
      for (const item of (transferData ?? [])) {
        const t = Array.isArray(item.transfer) ? item.transfer[0] : item.transfer;
        if (!t) continue;
        const dest = Array.isArray(t.destinationSite) ? t.destinationSite[0] : t.destinationSite;
        const src = Array.isArray(t.sourceSite) ? t.sourceSite[0] : t.sourceSite;

        if (t.createdAt) {
          timeline.push({
            id: `tr-created-${t.id}`,
            at: t.createdAt,
            action: `Added to Transfer ${t.transferNo}`,
            actor: null,
            site: src?.siteName ?? null,
            note: null,
            color: "var(--muted)",
          });
        }
          if (t.packedAt) {
            timeline.push({
              id: `tr-packed-${t.id}`,
              at: t.packedAt,
              action: `Dispatched - ${t.transferNo}`,
              actor: null,
              site: src?.siteName ?? null,
              note: `→ ${dest?.siteName ?? "unknown"}`,
              color: "var(--muted)",
            });
          }
          if (t.status === "received") {
          timeline.push({
            id: `tr-received-${t.id}`,
            at: t.packedAt ?? t.createdAt,
            action: `Received at ${dest?.siteName ?? "site"}`,
            actor: null,
            site: dest?.siteName ?? null,
            note: t.transferNo,
            color: "var(--muted)",
          });
        }
      }

      // Correction events
      for (const c of (correctionData ?? [])) {
        const by = Array.isArray(c.correctedBy) ? c.correctedBy[0] : c.correctedBy;
        timeline.push({
          id: `corr-${c.id}`,
          at: c.correctedAt,
          action: `Serial Corrected`,
          actor: by?.fullName ?? by?.username ?? null,
          site: null,
          note: `${c.oldSerialNumber} -> ${c.newSerialNumber}: ${c.reason}`,
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
        <div style={{ position: "absolute", left: 4, top: 8, bottom: 8, width: 2, background: "var(--line)" }} />

        {events.map((ev, i) => {
          const isLast = i === events.length - 1;
          const dotColor = isLast ? "var(--blue)" : ev.color;
          return (
          <div key={ev.id} style={{ display: "flex", gap: 16, marginBottom: i < events.length - 1 ? 20 : 0, position: "relative" }}>
            {/* Dot */}
            <div className="circle" style={{
              width: 10, height: 10, borderRadius: "50%", background: dotColor,
              flexShrink: 0, zIndex: 1, marginTop: 4,
            }} />

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
          );
        })}
      </div>
    </div>
  );
}

export function SerialDrawer({ partId, partName, partNumber, initialStatusFilter, onClose }: Props) {
  const [serials, setSerials] = useState<Serial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter ?? "all");
  const [activeTab, setActiveTab] = useState<"serials" | "history">("serials");
  const [selectedSerial, setSelectedSerial] = useState<Serial | null>(null);
  const [dcSiteId, setDcSiteId] = useState<string | null>(null);
  const [returningSerial, setReturningSerial] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/serials?part_id=" + partId + "&limit=500")
      .then((data) => {
        setSerials((data ?? []).map((s: any) => ({
          ...s,
          currentSiteId: s.currentSiteId ?? null,
          site: Array.isArray(s.site) ? s.site[0] ?? null : s.site,
        })));
        setLoading(false);
      });

    api.get("/sites/dc").then((site: any) => setDcSiteId(site?.id ?? null));

    setTimeout(() => searchRef.current?.focus(), 50);
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [partId, onClose]);

  useEffect(() => {
    setStatusFilter(initialStatusFilter ?? "all");
  }, [initialStatusFilter, partId]);

  const filtered = serials.filter((s) => {
    if (statusFilter !== "all") {
      if (statusFilter === "transferred" || statusFilter === "stocked_out") {
        if (!s.dispatched) return false;
      } else if (s.status !== statusFilter) {
        return false;
      }
    }
    if (search && !s.serialNumber.toLowerCase().includes(search.toLowerCase())) return false;
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--blue)", background: "var(--bg-surface-elevated)", padding: "1px 6px", borderRadius: "var(--radius-sm)", display: "inline-block" }}>{partNumber}</span>
                {initialStatusFilter === "in_stock" && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--link)", background: "var(--bg-surface-elevated)", padding: "1px 8px", borderRadius: "var(--radius-pill)", display: "inline-block" }}>In Stock</span>}
                {initialStatusFilter === "transferred" && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--bg-surface-elevated)", padding: "1px 8px", borderRadius: "var(--radius-pill)", display: "inline-block" }}>Stocked Out</span>}
              </div>
            </div>
            <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {!loading && activeTab === "serials" && !initialStatusFilter && (
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

        {/* Tabs — hide when opened from a specific column */}
        {!initialStatusFilter && (
          <div style={{ display: "flex", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            {([["serials", "Serials"], ["history", "Timeline"]] as const).map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => { setActiveTab(tab); if (tab === "serials") setSelectedSerial(null); }}
                style={{ flex: 1, padding: "5px 0", fontSize: 13, fontWeight: activeTab === tab ? 700 : 400, color: activeTab === tab ? "var(--blue)" : "var(--muted)", background: "transparent", border: "none", borderBottom: `2px solid ${activeTab === tab ? "var(--blue)" : "transparent"}`, borderRadius: 0, cursor: "pointer", marginBottom: -1 }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {activeTab === "serials" && (
          <>
            <div style={{ padding: "5px 12px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
              <div style={{ position: "relative" }}>
                <Search size={14} color="#9ca3af" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search serial number..."
                  className="drawer-search"
                  data-plain
                  style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px 7px 34px", fontSize: 12, outline: "none", boxSizing: "border-box", background: "var(--bg-surface-elevated)", color: "var(--text)" }} />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loading && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading serials...</div>}
              {!loading && filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{search ? `No serials matching "${search}"` : "No serials found."}</div>}
              {!loading && filtered.map((serial, i) => {
                const contextStyle = initialStatusFilter === "in_stock" ? { bg: "var(--bg-surface-elevated)", color: "var(--link)", label: "In Stock" } : initialStatusFilter === "transferred" ? { bg: "var(--bg-surface-elevated)", color: "var(--muted)", label: "Stocked Out" } : null;
                const sm = contextStyle ?? STATUS_STYLE[serial.status] ?? { bg: "#f3f4f6", color: "var(--muted)", label: serial.status };
                return (
                  <div key={serial.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 12, padding: "5px 12px", borderBottom: "1px solid var(--line-soft)", background: "transparent" }}>
                    <div>
                      <div
                        role="button"
                        onClick={() => { setSelectedSerial(serial); setActiveTab("history"); }}
                        style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: "var(--link)", marginBottom: 2, cursor: "pointer", textDecoration: "underline" }}
                      >{serial.serialNumber}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        Stocked in {fmtDate(serial.stockInAt)}
                        {serial.site && <span> · {serial.site.siteName}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: sm.bg, color: sm.color, whiteSpace: "nowrap" }}>{sm.label}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "5px 12px", borderTop: "1px solid var(--line)", background: "var(--bg-surface-elevated)", flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>
              {!loading && `Showing ${filtered.length} of ${serials.length} serials`}
            </div>
          </>
        )}

        {activeTab === "history" && (
          <>
            <div style={{ padding: "5px 12px", borderBottom: "1px solid var(--line)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
              {initialStatusFilter && selectedSerial && (
                <button type="button" onClick={() => { setActiveTab("serials"); setSelectedSerial(null); setTimelineSearch(""); }}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--link)", fontSize: 12, fontWeight: 600, padding: "4px 0", whiteSpace: "nowrap" }}>
                  ← Back to {partName}
                </button>
              )}
              <input value={timelineSearch} onChange={(e) => setTimelineSearch(e.target.value)}
                placeholder="Search serial number..."
                style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", background: "var(--bg-surface-elevated)", color: "var(--text)" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {selectedSerial && !timelineSearch.trim() ? (
                <>
                  {dcSiteId && selectedSerial.currentSiteId && selectedSerial.currentSiteId !== dcSiteId && (
                    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-surface-elevated)" }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>At {selectedSerial.site?.siteName ?? "branch"}</span>
                      <button type="button" onClick={() => { setReturningSerial(selectedSerial.id); setReturnReason(""); }}
                        style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: "var(--radius)", cursor: "pointer", background: "var(--blue)", color: "#fff" }}>
                        Return to DC
                      </button>
                    </div>
                  )}
                  <SerialTimeline serialId={selectedSerial.id} serialNumber={selectedSerial.serialNumber} stockInAt={selectedSerial.stockInAt} />
                </>
              ) : (
                <div>
                  {serials
                    .filter(s => !timelineSearch.trim() || s.serialNumber.toLowerCase().includes(timelineSearch.toLowerCase()))
                    .slice(0, 30)
                    .map(s => (
                      <div key={s.id}
                        onClick={() => { setSelectedSerial(s); setTimelineSearch(""); }}
                        style={{ padding: "7px 12px", cursor: "pointer", borderBottom: "1px solid var(--line-soft)", fontSize: 13, fontFamily: "monospace", color: "var(--link)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        {s.serialNumber}
                      </div>
                    ))}
                  {timelineSearch.trim() && !serials.some(s => s.serialNumber.toLowerCase().includes(timelineSearch.toLowerCase())) && (
                    <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No serials matching "{timelineSearch}"</div>
                  )}
                  {!timelineSearch.trim() && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Type a serial number to view its timeline.</div>}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Return to DC confirmation modal */}
      {returningSerial && selectedSerial && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", width: 400, maxWidth: "90vw", padding: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Return to DC</h3>
            <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--muted)" }}>
              Serial <strong style={{ color: "var(--text)" }}>{selectedSerial.serialNumber}</strong> at <strong style={{ color: "var(--text)" }}>{selectedSerial.site?.siteName ?? "branch"}</strong>
            </p>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
              This will set it to <strong style={{ color: "var(--link)" }}>In Stock</strong> at DC and log the reason.
            </p>
            <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)}
              placeholder="Reason for return (e.g. Defective, Wrong item, RTS, etc.)"
              rows={3}
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "8px 10px", fontSize: 12, outline: "none", boxSizing: "border-box", resize: "vertical", background: "var(--bg-surface-elevated)", color: "var(--text)", fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" onClick={() => { setReturningSerial(null); setReturnReason(""); }}
                style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={async () => {
                const id = returningSerial;
                setReturningSerial("submitting");
                try {
                  await api.post(`/serials/${id}/return-to-dc`, { reason: returnReason.trim() || undefined });
                  setReturningSerial(null);
                  setReturnReason("");
                  onClose();
                  return;
                } catch { }
                setReturningSerial(null);
                setReturnReason("");
              }}
                style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: "var(--radius)", background: returningSerial === "submitting" ? "#d1d5db" : "var(--blue)", color: "#fff", cursor: returningSerial === "submitting" ? "not-allowed" : "pointer" }}>
                {returningSerial === "submitting" ? "Returning..." : "Confirm Return"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}






