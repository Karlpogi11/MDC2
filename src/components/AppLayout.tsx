import { type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3, Bell, Boxes, CircleHelp, ClipboardCheck,
  FileDown, PackagePlus, Settings, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/useBranding";

type Module = { label: string; icon: LucideIcon; path: string };

const MODULES: Module[] = [
  { label: "Inventory",   icon: Boxes,         path: "/" },
  { label: "Stock-in",    icon: PackagePlus,   path: "/stock-in" },
  { label: "Transfers",   icon: ShieldCheck,   path: "/transfers" },
  { label: "Corrections", icon: ClipboardCheck, path: "/corrections" },
  { label: "Exports",     icon: FileDown,      path: "/exports" },
  { label: "Analytics",   icon: BarChart3,     path: "/analytics" },
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

  const isSystemAdmin = authState.status === "authenticated" && authState.profile.role === "system_admin";
  const profileName =
    authState.status === "authenticated"
      ? (authState.profile.full_name ?? authState.profile.username ?? authState.profile.email ?? "User")
      : "User";

  const activePath = activeModule ?? location.pathname;

  return (
    <div className="katana-app">
      <header className="global-nav">
        <div className="nav-left">
          <span className="brand-word">{brandName ?? "MDC"}</span>
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
          <button className="icon-btn" type="button" aria-label="Notifications">
            <Bell aria-hidden="true" />
          </button>
          <button className="icon-btn" type="button" aria-label="Help">
            <CircleHelp aria-hidden="true" />
          </button>
          {isSystemAdmin && (
            <>
              <button type="button" className="icon-btn" title="Users"
                style={{ fontSize: 12, color: "#9fb4ba", width: "auto", padding: "0 6px" }}
                onClick={() => navigate("/users")}>
                Users
              </button>
              <button type="button" className="icon-btn" aria-label="Configuration"
                title="Configuration" onClick={() => navigate("/config")}>
                <Settings aria-hidden="true" />
              </button>
            </>
          )}
          <div className="account">
            <span className="account-name">{profileName}</span>
            <button type="button" className="icon-btn"
              aria-label="Sign out" onClick={() => void signOut()}
              style={{ marginLeft: 8, fontSize: 12, color: "#9fb4ba" }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <Breadcrumb />

      {children}
    </div>
  );
}
