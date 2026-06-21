import { useEffect, useState, useRef, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import { PackagePlus, ArrowRightLeft, AlertTriangle, Search, CheckCircle2, Truck, Package, Clock, Copy, Check, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { ShipmentBookingPanel } from "@/components/ShipmentBookingPanel";
import { useQuery } from "@tanstack/react-query";
import {
  dashboardQueryKey,
  fetchDashboardData,
  NAVIGATION_CACHE_GC_TIME,
  NAVIGATION_CACHE_STALE_TIME,
} from "@/services/navigationCache";
import { friendlyError } from "@/lib/friendlyError";
import { SerialLookupDrawer } from "@/components/SerialLookupDrawer";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  booked: "Booked",
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

type SearchResult = { type: "serial" | "part" | "transfer" | "nav" | "site" | "invoice"; label: string; sub: string; path: string };

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

const NAV_ITEMS: { label: string; sub: string; path: string }[] = [
  { label: "Dashboard", sub: "Home page", path: "/" },
  { label: "Inventory", sub: "Parts, serials, stock", path: "/inventory" },
  { label: "Transfers", sub: "Inbound & outbound transfers", path: "/transfers" },
  { label: "Stock In", sub: "Receive inventory", path: "/stock-in" },
  { label: "Corrections", sub: "Fix serial discrepancies", path: "/corrections" },
  { label: "Analytics", sub: "Usage & performance", path: "/analytics" },
  { label: "Reports", sub: "Export reports", path: "/reports" },
  { label: "Exports", sub: "Data exports", path: "/exports" },
  { label: "Physical Count", sub: "Cycle counting", path: "/physical-count" },
  { label: "Settings", sub: "App configuration", path: "/config" },
  { label: "Users", sub: "Manage accounts", path: "/users" },
  { label: "Audit Log", sub: "Activity history", path: "/audit-log" },
];

function GlobalSearch({ onSerialClick }: { onSerialClick: (serial: string) => void }) {
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
      setLoading(true);
      const term = q.trim().toLowerCase();
      const [apiData, sites] = await Promise.all([
        api.get("/dashboard/search?q=" + encodeURIComponent(term)),
        api.get<any[]>("/sites"),
      ]);
      const out: SearchResult[] = [];
      const seenPaths = new Set<string>();
      if (Array.isArray(apiData)) {
        for (const r of apiData) {
          out.push({ type: r.type, label: r.label, sub: r.sub, path: r.path });
          seenPaths.add(r.path);
        }
      }
      if (Array.isArray(sites)) {
        for (const s of sites) {
          const name = (s.siteName ?? "").toLowerCase();
          const code = (s.siteCode ?? "").toLowerCase();
          if (name.includes(term) || code.includes(term)) {
            const path = `/config?tab=sites`;
            if (!seenPaths.has(path)) {
              out.push({ type: "site", label: s.siteName, sub: s.siteCode ? `Code: ${s.siteCode}` : "Site", path });
              seenPaths.add(path);
            }
          }
        }
      }
      let fuzzySuggestion: SearchResult | null = null;
      for (const nav of NAV_ITEMS) {
        const lower = nav.label.toLowerCase();
        if (lower.includes(term) && !seenPaths.has(nav.path)) {
          out.push({ type: "nav", label: nav.label, sub: nav.sub, path: nav.path });
          seenPaths.add(nav.path);
        } else if (!fuzzySuggestion && !lower.includes(term)) {
          const dist = editDistance(lower, term);
          if (dist <= 2 && dist > 0) {
            fuzzySuggestion = { type: "nav", label: nav.label, sub: `Did you mean “${nav.label}”?`, path: nav.path };
          }
        }
      }
      if (fuzzySuggestion && !seenPaths.has(fuzzySuggestion.path)) {
        out.push(fuzzySuggestion);
        seenPaths.add(fuzzySuggestion.path);
      }
      setResults(out);
      setOpen(true);
      setLoading(false);
    }, 250);
  }, [q]);

  const TYPE_LABEL: Record<string, string> = { serial: "Serial", part: "Part", transfer: "Transfer", nav: "Page", site: "Site", invoice: "Invoice" };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <div className="global-search-box" style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: 20, padding: "9px 16px", width: 280 }}>
        <Search size={14} color="var(--muted)" />
        <div
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={(e) => setQ(e.currentTarget.textContent ?? "")}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }}
          data-placeholder="Search serials, parts, transfers…"
          style={{ fontSize: 13, color: "var(--text)", flex: 1, outline: "none", border: "none", minHeight: "1.4em", cursor: "text", whiteSpace: "nowrap", overflow: "hidden" }}
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
          {!loading && results.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>No results found.</div>}
          {!loading && results.map((r, i) => (
            <div key={i} onMouseDown={() => { if (r.type === "serial") onSerialClick(r.label); else navigate(r.path); setQ(""); setOpen(false); }}
              style={{ padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", width: 48, flexShrink: 0, textTransform: "uppercase" }}>{TYPE_LABEL[r.type]}</span>
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
      ? (authState.profile.full_name || authState.profile.username || "there")
      : "there";

  const { data, error } = useQuery({
    queryKey: dashboardQueryKey,
    queryFn: fetchDashboardData,
    staleTime: NAVIGATION_CACHE_STALE_TIME,
    gcTime: NAVIGATION_CACHE_GC_TIME,
  });
  const isCoordinator = authState.status === "authenticated" && authState.profile.role === "shipping_coordinator";
  const metrics = data?.metrics ?? null;
  const pipeline = data?.pipeline ?? [];
  const activity = data?.activity ?? [];
  const [showAllActivity, setShowAllActivity] = useState(false);
  const ACTIVITY_LIMIT = 5;
  const displayedActivity = showAllActivity ? activity : activity.slice(0, ACTIVITY_LIMIT);
  const stockInThisWeek = data?.stockInThisWeek ?? null;
  const pendingCorrections = data?.pendingCorrections ?? null;
  const topParts = data?.topParts ?? [];
  const loadError = error instanceof Error ? error.message : null;

  const ACTIVITY_ICON: Record<string, React.ReactNode> = {
    transfer_dispatched: <ArrowRightLeft size={13} color="var(--muted)" />,
    transfer_received:   <CheckCircle2 size={13} color="var(--muted)" />,
    stock_in:            <PackagePlus size={13} color="var(--muted)" />,
    correction:          <AlertTriangle size={13} color="var(--muted)" />,
  };

  // ─── Shipping Queue (for coordinator) ──────────────────────────────
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [bookTarget, setBookTarget] = useState<any | null>(null);
  const [bookSuccess, setBookSuccess] = useState<string | null>(null);
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [serialLookup, setSerialLookup] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const [pendingRes, bookingsRes] = await Promise.all([
        api.get("/shipments/pending"),
        api.get("/shipments/my-bookings"),
      ]);
      setPendingItems(pendingRes?.data ?? []);
      setMyBookings(bookingsRes?.data ?? []);
    } catch {}
    setPendingLoading(false);
  }, []);

  useEffect(() => {
    if (!isCoordinator) return;
    fetchPending();
    const interval = setInterval(fetchPending, 30000);
    return () => clearInterval(interval);
  }, [isCoordinator, fetchPending]);

  const draftItems = pendingItems.filter((p: any) => p.status === "draft");

  const handleBookClick = useCallback(async (item: any) => {
    try {
      const full = await api.get(`/transfers/${item.id}`);
      if (full) setBookTarget(full);
    } catch {}
  }, []);

  return (
    <AppLayout activeModule="/dashboard">
      <main className="coordinator-dashboard" style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: "var(--text)" }}>
              Good {getGreeting()}, {profileName}.
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>
              {authState.status === "authenticated" ? authState.profile.role.replace(/_/g, " ") : ""}
              &nbsp;&middot;&nbsp;
              {isCoordinator ? "Transfers waiting for your action." : "Here's what needs your attention today."}
            </p>
          </div>
          <GlobalSearch onSerialClick={(s) => setSerialLookup(s)} />
        </div>

        {loadError && (
          <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>
            {loadError}
          </div>
        )}

        {isCoordinator ? (
          <>
            {bookSuccess && (
              <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--positive)", borderRadius: "var(--radius)", color: "var(--positive)", fontSize: 13, fontWeight: 600 }}>
                {bookSuccess}
              </div>
            )}
            <CoordinatorDashboard
              pendingItems={pendingItems}
              pendingLoading={pendingLoading}
              myBookings={myBookings}
              onBookClick={handleBookClick}
              navigate={navigate}
            />
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
              <MetricCard label="In Stock" value={metrics?.inStock ?? "—"} />
              <MetricCard label="In Transit" value={metrics?.inTransit ?? "—"} />
              <MetricCard label="Overdue (>3d)" value={metrics?.overdue ?? "—"} alert={!!metrics?.overdue} />
              <MetricCard label="Stocked In This Week" value={stockInThisWeek ?? "—"} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
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

              <section className="table-card" style={{ padding: 0 }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Recent Activity</span>
                </div>
                <div style={{ padding: "4px 0" }}>
                  {activity.length === 0 && (
                    <div style={{ padding: "16px", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>No recent activity</div>
                  )}
                  {displayedActivity.map((a) => (
                    <div key={a.id + a.type} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 12px", borderBottom: "1px solid var(--line)" }}>
                      <span style={{ marginTop: 1, flexShrink: 0 }}>{ACTIVITY_ICON[a.type]}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</div>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>{timeAgo(a.time)}</span>
                    </div>
                  ))}
                  {activity.length > ACTIVITY_LIMIT && (
                    <div style={{ textAlign: "center", padding: "6px" }}>
                      <button type="button" onClick={() => setShowAllActivity(!showAllActivity)}
                        style={{ fontSize: 12, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: "4px 12px" }}>
                        {showAllActivity ? "Show less" : `Show more (${activity.length - ACTIVITY_LIMIT} more)`}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <section className="table-card" style={{ padding: 0, marginBottom: 20 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Top Parts This Week</span>
                <button type="button" onClick={() => navigate("/inventory")}
                  style={{ fontSize: 12, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  View inventory →
                </button>
              </div>
              {topParts.length === 0 ? (
                <div style={{ padding: "16px", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>No movement this week</div>
              ) : (
                <div>
                  {topParts.map((p, i) => (
                    <div key={p.part_number} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 16px", borderBottom: i < topParts.length - 1 ? "1px solid var(--line)" : "none" }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", width: 16, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" }}>{p.part_number}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.part_name}</div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)", flexShrink: 0 }}>{p.movement}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}


      </main>

      {/* Booking panel — always mounted, visibility toggled internally to preserve compositing layers */}
      <ShipmentBookingPanel
        transfer={bookTarget}
        onClose={() => setBookTarget(null)}
        onBooked={() => {
          setBookTarget(null);
          fetchPending();
          setBookSuccess("Courier booked successfully");
          setTimeout(() => setBookSuccess(null), 4000);
        }}
      />
      {serialLookup && (
        <SerialLookupDrawer serialNumber={serialLookup} onClose={() => setSerialLookup(null)} />
      )}
    </AppLayout>
  );
}

const PIPELINE_COLOR: Record<string, string> = {
  draft:      "var(--muted)",
  booked:     "var(--blue)",
  packed:     "var(--blue)",
  in_transit: "var(--muted)",
};

type QueueTransfer = {
  id: string;
  transferNo: string;
  status: string;
  createdAt: string;
  bookedAt: string | null;
  destSiteName: string;
  destSiteCode: string;
  destSiteAddress: string | null;
  trackingLink: string | null;
  itemCount: number;
  totalUnits: number;
  reqFullName: string;
  courierName: string;
  trackingNumber: string;
};

const BOOKING_STATUS_META: Record<string, { label: string; color: string }> = {
  booked:     { label: "Booked", color: "var(--blue)" },
  packed:     { label: "Packed", color: "var(--warning)" },
  in_transit: { label: "In Transit", color: "#16a34a" },
  received:   { label: "Received", color: "var(--muted)" },
  cancelled:  { label: "Cancelled", color: "var(--negative)" },
};

function BookingHistory({ items }: { items: any[] }) {
  if (items.length === 0) {
    return (
      <div style={{ padding: "20px 14px", textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
        No bookings yet
      </div>
    );
  }
  return (
    <div>
      {items.map((b: any) => {
        const meta = BOOKING_STATUS_META[b.status] ?? { label: b.status, color: "var(--muted)" };
        return (
          <div key={b.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-soft)", fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--link)", fontSize: 12 }}>{b.transferNo}</span>
              <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: "var(--radius-pill)", background: meta.color + "22", color: meta.color, fontWeight: 600 }}>{meta.label}</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>{b.destSiteName}</div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 10, marginTop: 2 }}>
              <span>{b.bookedAt ? timeAgo(b.bookedAt) : ""}</span>
              {b.trackingLink && (
                <a href={b.trackingLink} target="_blank" rel="noopener noreferrer"
                  style={{ color: "var(--blue)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  Track <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const CoordinatorDashboard = memo(function CoordinatorDashboard({
  pendingItems, pendingLoading, myBookings,
  onBookClick, navigate,
}: {
  pendingItems: QueueTransfer[];
  pendingLoading: boolean;
  myBookings: any[];
  onBookClick: (t: any) => void;
  navigate: (path: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const draftItems = pendingItems.filter((p) => p.status === "draft");
  const count = draftItems.length;

  if (pendingLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, gap: 12, color: "var(--muted)", fontSize: 14 }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--line)", borderTopColor: "var(--blue)", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
        Loading queue…
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 20, alignItems: "start" }}>
      {/* Main: awaiting courier table */}
      {count === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "48px 24px", gap: 12,
          border: "1px dashed var(--line)", borderRadius: "var(--radius)",
          background: "var(--bg-surface)",
        }}>
          <div style={{ fontSize: 32, opacity: 0.25, lineHeight: 1 }}>✓</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>All assigned</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>No transfers awaiting courier</div>
        </div>
      ) : (
        <section style={{
          background: "var(--bg-surface)", borderRadius: "var(--radius)",
          border: "1px solid var(--line)", overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 18px", borderBottom: "1px solid var(--line)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Clock size={16} color="var(--blue)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                Awaiting Courier
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                · {count} transfer{count !== 1 ? "s" : ""}
              </span>
            </div>
            <button type="button" onClick={() => navigate("/transfers")}
              style={{ fontSize: 12, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
              View all →
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-surface-elevated)" }}>
                  <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>Transfer</th>
                  <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>Destination</th>
                  <th style={{ padding: "8px 14px", textAlign: "center", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>Units</th>
                  <th style={{ padding: "8px 14px", textAlign: "center", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>Waiting</th>
                  <th style={{ padding: "8px 14px", textAlign: "right", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}></th>
                </tr>
              </thead>
              <tbody>
                {draftItems.map((item: QueueTransfer) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <button type="button" onClick={() => navigate(`/transfers/${item.id}`)}
                        style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "var(--link)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        {item.transferNo}
                      </button>
                      {item.reqFullName && (
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                          {item.reqFullName}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 500 }}>{item.destSiteName}</span>
                        <button type="button" title="Copy address"
                          onClick={() => {
                            const addr = item.destSiteAddress ?? "";
                            navigator.clipboard.writeText(addr);
                            setCopiedId(item.id);
                            setTimeout(() => setCopiedId(null), 1500);
                          }}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: "var(--muted)", opacity: 0.5, transition: "opacity 0.15s" }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>
                          {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{item.destSiteCode}</div>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>
                      {item.totalUnits}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                        padding: "2px 10px", borderRadius: "var(--radius-pill)",
                        color: "#fff",
                        background: ageColor(item.createdAt),
                      }}>
                        {ageLabel(item.createdAt)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <button type="button" onClick={() => onBookClick(item)}
                        style={{
                          padding: "6px 16px", fontSize: 12, fontWeight: 700,
                          background: "var(--blue)", color: "#fff",
                          border: "none", borderRadius: "var(--radius)",
                          cursor: "pointer", whiteSpace: "nowrap",
                          transition: "opacity 0.15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}>
                        Book Courier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Sidebar: booking history */}
      <section style={{
        background: "var(--bg-surface)", borderRadius: "var(--radius)",
        border: "1px solid var(--line)", overflow: "hidden",
      }}>
        <div style={{
          padding: "12px 14px", borderBottom: "1px solid var(--line)",
          fontSize: 12, fontWeight: 700, color: "var(--text)",
        }}>
          My Bookings
        </div>
        <BookingHistory items={myBookings} />
      </section>
    </div>
  );
});

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function ageColor(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 2 * 3600000) return "var(--blue)";
  if (diff < 24 * 3600000) return "var(--warning)";
  return "var(--negative)";
}

function ageLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function MetricCard({ label, value, alert, onClick }: { label: string; value: number | string; alert?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: "var(--bg-surface)",
      borderRadius: "var(--radius)",
      padding: "22px 24px",
      border: `1px solid ${alert && value !== 0 ? "var(--negative)" : "var(--line)"}`,
      cursor: onClick ? "pointer" : "default",
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
      textDecoration: primary ? "none" : "underline",
    }}>
      {label}
    </button>
  );
}