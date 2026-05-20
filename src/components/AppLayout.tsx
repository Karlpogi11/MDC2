import { type ReactNode, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3, Boxes, CircleHelp, ClipboardCheck, ClipboardList,
  FileDown, PackagePlus, Settings, ShieldCheck, Users, LogOut,
  ArrowLeft, ShieldAlert, type LucideIcon, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/useBranding";
import { NotificationBell } from "@/components/NotificationBell";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

type Module = { label: string; icon: LucideIcon; path: string };

const MODULES: Module[] = [
  { label: "Inventory",      icon: Boxes,         path: "/" },
  { label: "Stock-in",       icon: PackagePlus,   path: "/stock-in" },
  { label: "Transfers",      icon: ShieldCheck,   path: "/transfers" },
  { label: "Corrections",    icon: ClipboardCheck, path: "/corrections" },
  { label: "Physical Count", icon: ClipboardList, path: "/physical-count" },
  { label: "Exports",        icon: FileDown,      path: "/exports" },
  { label: "Analytics",      icon: BarChart3,     path: "/analytics" },
];

type Props = {
  children: ReactNode;
  /** Override the active module highlight. Defaults to current pathname. */
  activeModule?: string;
};

const ROUTE_LABELS: Record<string, string> = {
  "/":              "Inventory",
  "/stock-in":      "Stock-In",
  "/transfers":     "Transfers",
  "/transfers/new": "Create Transfer",
  "/corrections":   "Corrections",
  "/exports":       "Exports",
  "/analytics":     "Analytics",
  "/config":        "Configuration",
  "/users":         "Users",
};

function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  // Build crumb chain: Home > Parent > Current
  const crumbs: { label: string; path: string }[] = [{ label: "Home", path: "/" }];

  if (path !== "/") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length > 1) {
      const parentPath = "/" + parts[0];
      if (ROUTE_LABELS[parentPath]) {
        crumbs.push({ label: ROUTE_LABELS[parentPath], path: parentPath });
      }
    }
    // Dynamic routes
    const label = ROUTE_LABELS[path] ?? (parts.length > 1 ? "Detail" : undefined);
    if (label) crumbs.push({ label, path });
  }

  if (crumbs.length <= 1) return null; // Don't show on home

  return (
    <div style={{
      background: "#fff",
      borderBottom: "1px solid #e5e7eb",
      padding: "8px 28px",
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 13,
    }}>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.path} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span style={{ color: "#d1d5db" }}>/</span>}
            {isLast ? (
              <span style={{ color: "#111827", fontWeight: 600 }}>{crumb.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => navigate(crumb.path)}
                style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", padding: 0, fontSize: 13 }}
              >
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function AppLayout({ children, activeModule }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: authState, signOut } = useAuth();
  const { brandName } = useBranding();
  const [showHelp, setShowHelp] = useState(false);

  const isSystemAdmin = authState.status === "authenticated" && authState.profile.role === "system_admin";
  const isAdmin = authState.status === "authenticated" && ["system_admin", "dc_admin"].includes(authState.profile.role);
  const profileName =
    authState.status === "authenticated"
      ? (authState.profile.full_name ?? authState.profile.username ?? authState.profile.email ?? "User")
      : "User";
  const userRole =
    authState.status === "authenticated" ? authState.profile.role : "";

  const activePath = activeModule ?? location.pathname;
  const onlineStatus = useOnlineStatus();

  return (
    <div className="katana-app">
      <header className="global-nav">
        <div className="nav-left">
          <button type="button" className="brand-word" style={{border:"none",background:"transparent",cursor:"pointer",padding:0}} onClick={() => navigate("/")}>{brandName ?? "MDC"}</button>
          <nav className="main-modules" aria-label="Main modules">
            {MODULES.map((item) => {
              const Icon = item.icon;
              const isActive = activePath === item.path ||
                (item.path !== "/" && activePath.startsWith(item.path));
              return (
                <button
                  key={item.label}
                  className={isActive ? "module active" : "module"}
                  type="button"
                  onClick={() => navigate(item.path)}
                >
                  <Icon className="module-icon-svg" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="nav-right">
          <NotificationBell />

          <button className="icon-btn" type="button" aria-label="Help" title="Help" onClick={() => setShowHelp(true)}>
            <CircleHelp aria-hidden="true" />
          </button>

          {isAdmin && (
            <button type="button" className="icon-btn" aria-label="Audit Log" title="Audit Log" onClick={() => navigate("/audit-log")}>
              <ShieldAlert aria-hidden="true" />
            </button>
          )}
          {isSystemAdmin && (
            <>
              <button type="button" className="icon-btn" aria-label="Users" title="Users" onClick={() => navigate("/users")}>
                <Users aria-hidden="true" />
              </button>
              <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => navigate("/config")}>
                <Settings aria-hidden="true" />
              </button>
            </>
          )}

          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.12)", margin: "0 4px" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ textAlign: "right", lineHeight: 1.3 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#ecf5f8" }}>{profileName}</div>
              <div style={{ fontSize: 11, color: "#7a9ba3", textTransform: "capitalize" }}>{userRole?.replace("_", " ")}</div>
            </div>
            <button type="button" className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <Breadcrumb />

      {onlineStatus === "offline" && (
        <div role="alert" style={{ background: "#fef2f2", borderBottom: "1px solid #fecaca", padding: "7px 28px", fontSize: 13, color: "#b91c1c", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="circle" style={{ width: 7, height: 7, background: "#ef4444", flexShrink: 0, display: "inline-block" }} />
          No connection. Changes may not save.
        </div>
      )}
      {onlineStatus === "restored" && (
        <div role="status" style={{ background: "#f0fdf4", borderBottom: "1px solid #bbf7d0", padding: "7px 28px", fontSize: 13, color: "#15803d", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="circle" style={{ width: 7, height: 7, background: "#16a34a", flexShrink: 0, display: "inline-block" }} />
          Connection restored.
        </div>
      )}

      {children}

      {showHelp && (
        <>
          <div onClick={() => setShowHelp(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 }} />
          <div role="dialog" aria-modal="true" aria-label="Help" style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "#fff", width: 520, maxHeight: "80vh", overflowY: "auto",
            zIndex: 201, boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #e5e7eb" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111" }}>Help & Quick Reference</h2>
              <button type="button" onClick={() => setShowHelp(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#6b7a8d", padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: "20px 24px", fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
              {[
                { title: "Inventory", body: "View all stocked parts and serials. Use the Serial Numbers tab to filter by status (In Stock, In Transit, Transferred)." },
                { title: "Stock-In", body: "Import new serials or parts into DC inventory via CSV upload or manual entry." },
                { title: "Transfers", body: "Create and manage outbound transfers from DC to branch sites. Advance status: Draft → Packed → In Transit → Received." },
                { title: "Corrections", body: "Fix incorrect serial assignments with a full audit trail. Requires dc_admin or system_admin role." },
                { title: "Exports", body: "Download stocked-in or transferred serials as CSV for reporting." },
                { title: "Analytics", body: "Upload Fixably or GSX exports to analyze repair trends by date range, site, or part." },
                { title: "Physical Count", body: "Reconcile physical stock against system records." },
                { title: "Configuration", body: "Manage sites, parts, branding, and system settings. System admin only." },
              ].map(({ title, body }) => (
                <div key={title} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: "#111", marginBottom: 2 }}>{title}</div>
                  <div style={{ color: "#6b7a8d" }}>{body}</div>
                </div>
              ))}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #e5e7eb", color: "#9ca3af", fontSize: 12 }}>
                For support, contact your system administrator.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
