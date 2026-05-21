import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PackagePlus, ArrowRightLeft, AlertTriangle, Search, CheckCircle2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { friendlyError } from "@/lib/friendlyError";

type Metrics = {
  inStock: number;
  inTransit: number;
  awaitingReceipt: number;
  overdue: number; // in_transit > 3 days
};

type PipelineItem = { status: string; count: number; overdueCount: number };

type ActivityItem = {
  id: string;
  type: "transfer_dispatched" | "transfer_received" | "stock_in" | "correction";
  label: string;
  time: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  packed: "Packed",
  in_transit: "In Transit",
  received: "Received",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Global Search ────────────────────────────────────────────────────────────

type SearchResult = { type: "serial" | "part" | "transfer"; label: string; sub: string; path: string };

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!q.trim() || q.length < 2) { setResults([]); setOpen(false); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const client = getSupabaseClient();
      if (!client) return;
      setLoading(true);
      const term = q.trim();
      const [serialRes, partRes, transferRes] = await Promise.all([
        client.from("serial_numbers").select("serial_number, parts(part_name)").ilike("serial_number", `%${term}%`).limit(4),
        client.from("parts").select("part_number, part_name").or(`part_number.ilike.%${term}%,part_name.ilike.%${term}%`).limit(4),
        client.from("transfers").select("transfer_no, status").ilike("transfer_no", `%${term}%`).limit(3),
      ]);
      const out: SearchResult[] = [];
      for (const r of (serialRes.data ?? []) as any[]) {
        const p = Array.isArray(r.parts) ? r.parts[0] : r.parts;
        out.push({ type: "serial", label: r.serial_number, sub: p?.part_name ?? "Serial", path: `/inventory?q=${encodeURIComponent(r.serial_number)}` });
      }
      for (const r of (partRes.data ?? []) as any[]) {
        out.push({ type: "part", label: r.part_number, sub: r.part_name, path: `/inventory?q=${encodeURIComponent(r.part_number)}` });
      }
      for (const r of (transferRes.data ?? []) as any[]) {
        out.push({ type: "transfer", label: r.transfer_no, sub: r.status?.replace("_", " "), path: `/transfers` });
      }
      setResults(out);
      setOpen(out.length > 0);
      setLoading(false);
    }, 250);
  }, [q]);

  const TYPE_LABEL: Record<string, string> = { serial: "Serial", part: "Part", transfer: "Transfer" };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <div className="global-search-box" style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: 20, padding: "9px 16px", width: 280 }}>
        <Search size={14} color="var(--muted)" />
        <div
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => setQ(e.currentTarget.textContent ?? "")}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }}
          data-placeholder="Search serials, parts, transfers…"
          style={{ fontSize: 13, color: "var(--text)", flex: 1, outline: "none", minHeight: "1.4em", cursor: "text", whiteSpace: "nowrap", overflow: "hidden" }}
        ></div>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          background: "var(--bg-surface)", border: "1px solid var(--line)",
          borderRadius: "var(--radius)", boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          zIndex: 999, overflow: "hidden",
        }}>
          {loading && <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>Searching…</div>}
          {!loading && results.map((r, i) => (
            <div key={i} onMouseDown={() => { navigate(r.path); setQ(""); setOpen(false); }}
              style={{ padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", gap: 10 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--blue)", width: 48, flexShrink: 0, textTransform: "uppercase" }}>{TYPE_LABEL[r.type]}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: r.type !== "part" ? "monospace" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { state: authState } = useAuth();
  const profileName =
    authState.status === "authenticated"
      ? (authState.profile.full_name ?? authState.profile.username ?? "there")
      : "there";

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const client = getSupabaseClient();
    if (!client) {
      // Demo mode — show placeholder zeros
      setMetrics({ inStock: 0, inTransit: 0, awaitingReceipt: 0, overdue: 0 });
      setPipeline([]);
      setActivity([]);
      return;
    }

    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      const [stockRes, transfersRes, stockInRes, correctionsRes] = await Promise.all([
        // in_stock count
        client.from("serial_numbers").select("id", { count: "exact", head: true }).eq("status", "in_stock"),
        // all active transfers
        client
          .from("transfers")
          .select("id, status, packed_at, created_at, transfer_no, destination_site:sites!destination_site_id(site_name)")
          .in("status", ["draft", "packed", "in_transit"])
          .order("created_at", { ascending: false })
          .limit(200),
        // recent stock-in batches
        client
          .from("stock_in_batches")
          .select("id, created_at, total_rows")
          .order("created_at", { ascending: false })
          .limit(5),
        // recent corrections
        client
          .from("serial_corrections")
          .select("id, created_at, old_serial, new_serial")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (stockRes.error) throw new Error(friendlyError(stockRes.error));
      if (transfersRes.error) throw new Error(friendlyError(transfersRes.error));

      const transfers = (transfersRes.data ?? []) as any[];

      // Metrics
      const inTransitList = transfers.filter((t) => t.status === "in_transit");
      const overdueList = inTransitList.filter((t) => {
        const dispatchedAt = t.packed_at ?? t.created_at;
        return dispatchedAt < threeDaysAgo;
      });

      setMetrics({
        inStock: stockRes.count ?? 0,
        inTransit: inTransitList.length,
        awaitingReceipt: inTransitList.length, // same — in_transit = awaiting receipt
        overdue: overdueList.length,
      });

      // Pipeline counts
      const pipelineMap: Record<string, { count: number; overdueCount: number }> = {};
      for (const t of transfers) {
        if (!pipelineMap[t.status]) pipelineMap[t.status] = { count: 0, overdueCount: 0 };
        pipelineMap[t.status].count++;
        if (t.status === "in_transit") {
          const dispatchedAt = t.packed_at ?? t.created_at;
          if (dispatchedAt < threeDaysAgo) pipelineMap[t.status].overdueCount++;
        }
      }
      setPipeline(
        ["draft", "packed", "in_transit"].map((s) => ({
          status: s,
          count: pipelineMap[s]?.count ?? 0,
          overdueCount: pipelineMap[s]?.overdueCount ?? 0,
        }))
      );

      // Recent activity feed — merge transfers + stock-in + corrections, sort by time
      const activityItems: ActivityItem[] = [];

      for (const t of transfers.slice(0, 5)) {
        const site = Array.isArray(t.destination_site) ? t.destination_site[0] : t.destination_site;
        if (t.status === "in_transit") {
          activityItems.push({
            id: t.id,
            type: "transfer_dispatched",
            label: `${t.transfer_no} dispatched → ${site?.site_name ?? "unknown"}`,
            time: t.packed_at ?? t.created_at,
          });
        }
      }

      for (const b of (stockInRes.data ?? []) as any[]) {
        activityItems.push({
          id: b.id,
          type: "stock_in",
          label: `${b.total_rows ?? "?"} serials stocked in`,
          time: b.created_at,
        });
      }

      for (const c of (correctionsRes.data ?? []) as any[]) {
        activityItems.push({
          id: c.id,
          type: "correction",
          label: `Correction: ${c.old_serial} → ${c.new_serial}`,
          time: c.created_at,
        });
      }

      activityItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setActivity(activityItems.slice(0, 8));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }

  const ACTIVITY_ICON: Record<string, React.ReactNode> = {
    transfer_dispatched: <ArrowRightLeft size={13} color="var(--muted)" />,
    transfer_received:   <CheckCircle2 size={13} color="var(--muted)" />,
    stock_in:            <PackagePlus size={13} color="var(--muted)" />,
    correction:          <AlertTriangle size={13} color="var(--muted)" />,
  };

  return (
    <AppLayout activeModule="/dashboard">
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
              Good {getGreeting()}, {profileName}.
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Here's what needs your attention today.
            </p>
          </div>
          <GlobalSearch />
        </div>

        {error && (
          <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Metric cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
          <MetricCard label="In Stock" value={metrics?.inStock ?? "—"} />
          <MetricCard label="In Transit" value={metrics?.inTransit ?? "—"} />
          <MetricCard label="Awaiting Receipt" value={metrics?.awaitingReceipt ?? "—"} />
          <MetricCard
            label="Overdue (>3d)"
            value={metrics?.overdue ?? "—"}
            alert={!!metrics?.overdue}
          />
        </div>

        {/* Pipeline + Activity */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          {/* Transfer Pipeline */}
          <section className="table-card" style={{ padding: 0 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Transfer Pipeline</span>
              <button type="button" onClick={() => navigate("/transfers")}
                style={{ fontSize: 12, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                View all →
              </button>
            </div>
            <div style={{ padding: "8px 0" }}>
              {pipeline.length === 0 && (
                <div style={{ padding: "16px", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>No active transfers</div>
              )}
              {pipeline.map((p) => (
                <div key={p.status}
                  onClick={() => navigate(`/transfers?status=${p.status}`)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 12px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: PIPELINE_COLOR[p.status], flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--text)" }}>{STATUS_LABEL[p.status]}</span>
                    {p.overdueCount > 0 && (
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                        ⚠ {p.overdueCount} overdue
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{p.count}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Recent Activity */}
          <section className="table-card" style={{ padding: 0 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Recent Activity</span>
            </div>
            <div style={{ padding: "4px 0" }}>
              {activity.length === 0 && (
                <div style={{ padding: "16px", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>No recent activity</div>
              )}
              {activity.map((a) => (
                <div key={a.id + a.type} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 12px", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ marginTop: 1, flexShrink: 0 }}>{ACTIVITY_ICON[a.type]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>{timeAgo(a.time)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Quick Actions */}
        <section className="table-card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Quick Actions</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <QuickAction label="New Transfer" onClick={() => navigate("/transfers/new")} />
            <QuickAction label="Stock-In" onClick={() => navigate("/stock-in")} />
            <QuickAction label="View Transfers" onClick={() => navigate("/transfers")} />
            <QuickAction label="Exports" onClick={() => navigate("/exports")} />
            <QuickAction label="Reconcile" onClick={() => navigate("/physical-count")} />
          </div>
        </section>
      </main>
    </AppLayout>
  );
}

const PIPELINE_COLOR: Record<string, string> = {
  draft:      "var(--muted)",
  packed:     "var(--blue)",
  in_transit: "var(--muted)",
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function MetricCard({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div style={{
      background: "var(--bg-surface)",
      borderRadius: "var(--radius)",
      padding: "22px 24px",
      border: `1px solid ${alert && value !== 0 ? "var(--negative)" : "var(--line)"}`,
    }}>
      <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color: alert && value !== 0 ? "var(--negative)" : "var(--text)", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function QuickAction({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{
      background: primary ? "var(--blue)" : "transparent",
      color: primary ? "#fff" : "var(--blue)",
      border: "none",
      borderRadius: primary ? "var(--radius)" : 0,
      padding: primary ? "5px 12px" : "0",
      fontSize: 13,
      fontWeight: primary ? 600 : 400,
      cursor: "pointer",
      textDecoration: primary ? "none" : "none",
    }}>
      {label}
    </button>
  );
}



