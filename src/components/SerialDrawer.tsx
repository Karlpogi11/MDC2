import { useState, useEffect, useRef } from "react";
import { X, Search } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Serial = {
  id: string;
  serial_number: string;
  status: "in_stock" | "transit" | "transferred" | "consumed" | "void";
  stock_in_at: string;
  current_site: { site_name: string; site_code: string } | null;
};

type Props = {
  partId: string;
  partName: string;
  partNumber: string;
  onClose: () => void;
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  in_stock:    { bg: "#dcfce7", color: "#15803d", label: "In Stock" },
  transit:     { bg: "#fef9c3", color: "#a16207", label: "In Transit" },
  transferred: { bg: "#dbeafe", color: "#1d4ed8", label: "Stocked Out" },
  consumed:    { bg: "#f3f4f6", color: "#6b7a8d", label: "Consumed" },
  void:        { bg: "#fee2e2", color: "#b91c1c", label: "Void" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export function SerialDrawer({ partId, partName, partNumber, onClose }: Props) {
  const [serials, setSerials] = useState<Serial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
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

    // Focus search on open
    setTimeout(() => searchRef.current?.focus(), 50);

    // Close on Escape
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [partId, onClose]);

  const filtered = serials.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (search && !s.serial_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Count by status
  const counts = serials.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100 }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 560,
        background: "#fff", zIndex: 101, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: "#f7f7f7", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: "var(--text)", fontFamily: "inherit" }}>{partName}</h2>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--blue)", background: "#eff6ff", padding: "1px 6px", borderRadius: "var(--radius-sm)", display: "inline-block" }}>{partNumber}</span>
            </div>
            <button type="button" onClick={onClose}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "#6b7a8d", padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {/* Status summary pills */}
          {!loading && (
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setStatusFilter("all")}
                style={{ border: `1px solid ${statusFilter === "all" ? "var(--blue)" : "var(--line)"}`, borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: statusFilter === "all" ? "var(--blue)" : "transparent",
                  color: statusFilter === "all" ? "#fff" : "var(--muted)" }}>
                All ({serials.length})
              </button>
              {Object.entries(counts).map(([status, count]) => {
                const s = STATUS_STYLE[status] ?? { bg: "#f3f4f6", color: "#6b7a8d", label: status };
                const active = statusFilter === status;
                return (
                  <button key={status} type="button" onClick={() => setStatusFilter(status)}
                    style={{ border: `1px solid ${active ? s.color : "var(--line)"}`, borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: active ? s.color : "transparent",
                      color: active ? "#fff" : "var(--muted)" }}>
                    {s.label} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <Search size={14} color="#9ca3af" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search serial number…"
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px 7px 30px", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
            />
          </div>
        </div>

        {/* Serial list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Loading serials…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              {search ? `No serials matching "${search}"` : "No serials found."}
            </div>
          )}
          {!loading && filtered.map((serial, i) => {
            const sm = STATUS_STYLE[serial.status] ?? { bg: "#f3f4f6", color: "#6b7a8d", label: serial.status };
            return (
              <div key={serial.id} style={{
                display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 12,
                padding: "10px 20px", borderBottom: "1px solid #f3f4f6",
                background: i % 2 === 0 ? "#fff" : "#fafafa",
              }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: "var(--blue)", marginBottom: 2 }}>
                    {serial.serial_number}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    Stocked in {formatDate(serial.stock_in_at)}
                    {serial.current_site && <span> · {serial.current_site.site_name}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: sm.bg, color: sm.color, whiteSpace: "nowrap" }}>
                  {sm.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", background: "#f7f7f7", flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>
          {!loading && `Showing ${filtered.length} of ${serials.length} serials`}
        </div>
      </div>
    </>
  );
}
