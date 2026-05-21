import { type ReactNode, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3,
  Boxes,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  PackagePlus,
  Settings,
  ShieldCheck,
  Users,
  LogOut,
  ShieldAlert,
  type LucideIcon,
  X,
  LayoutDashboard,
  FileBarChart2,
  Moon,
  Sun,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/useBranding";
import { NotificationBell } from "@/components/NotificationBell";
import { getTheme, applyTheme, type Theme } from "@/lib/theme";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

type Module = { label: string; icon: LucideIcon; path: string };

const MODULES: Module[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Inventory", icon: Boxes, path: "/inventory" },
  { label: "Stock-in", icon: PackagePlus, path: "/stock-in" },
  { label: "Transfers", icon: ShieldCheck, path: "/transfers" },
  { label: "Corrections", icon: ClipboardCheck, path: "/corrections" },
  { label: "Physical Count", icon: ClipboardList, path: "/physical-count" },
  { label: "Reports", icon: FileBarChart2, path: "/reports" },
  { label: "Analytics", icon: BarChart3, path: "/analytics" },
];

type Props = {
  children: ReactNode;
  activeModule?: string;
};

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/dashboard": "Dashboard",
  "/inventory": "Inventory",
  "/stock-in": "Stock-In",
  "/transfers": "Transfers",
  "/transfers/new": "Create Transfer",
  "/corrections": "Corrections",
  "/exports": "Exports",
  "/analytics": "Analytics",
  "/config": "Configuration",
  "/users": "Users",
};

function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  const crumbs: { label: string; path: string }[] = [{ label: "Home", path: "/" }];

  if (path !== "/") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length > 1) {
      const parentPath = "/" + parts[0];
      if (ROUTE_LABELS[parentPath]) {
        crumbs.push({ label: ROUTE_LABELS[parentPath], path: parentPath });
      }
    }

    const label = ROUTE_LABELS[path] ?? (parts.length > 1 ? "Detail" : undefined);
    if (label) crumbs.push({ label, path });
  }

  if (crumbs.length <= 1) return null;

  return (
    <div className="breadcrumb-bar">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.path} className="breadcrumb-item">
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            {isLast ? (
              <span className="breadcrumb-current">{crumb.label}</span>
            ) : (
              <button type="button" className="breadcrumb-link" onClick={() => navigate(crumb.path)}>
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
  const headerBrandName = brandName?.trim() ? brandName.trim() : "MobilCare DC";

  const [theme, setTheme] = useState<Theme>(() => {
    const initial = getTheme();
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.toggle("dark-theme", initial === "dark");
      root.setAttribute("data-theme", initial);
    }
    return initial;
  });

  const toggleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  };

  const isSystemAdmin = authState.status === "authenticated" && authState.profile.role === "system_admin";
  const isAdmin = authState.status === "authenticated" && ["system_admin", "dc_admin"].includes(authState.profile.role);
  const profileName =
    authState.status === "authenticated"
      ? (authState.profile.full_name ?? authState.profile.username ?? authState.profile.email ?? "User")
      : "User";
  const userRole = authState.status === "authenticated" ? authState.profile.role : "";

  const activePath = activeModule ?? location.pathname;
  const onlineStatus = useOnlineStatus();

  return (
    <div className="katana-app">
      <header className="global-nav">
        <div className="nav-left">
          <button type="button" className="brand-word brand-trigger" onClick={() => navigate("/")}>
            {headerBrandName}
          </button>
          <nav className="main-modules" aria-label="Main modules">
            {MODULES.map((item) => {
              const Icon = item.icon;
              const isActive = activePath === item.path || (item.path !== "/" && activePath.startsWith(item.path));
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

          <button
            className="icon-btn theme-toggle"
            type="button"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
           
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>

          <button className="icon-btn" type="button" aria-label="Help" onClick={() => setShowHelp(true)}>
            <CircleHelp aria-hidden="true" />
          </button>

          {isAdmin && (
            <button type="button" className="icon-btn" aria-label="Audit Log" onClick={() => navigate("/audit-log")}>
              <ShieldAlert aria-hidden="true" />
            </button>
          )}
          {isSystemAdmin && (
            <>
              <button type="button" className="icon-btn" aria-label="Users" onClick={() => navigate("/users")}>
                <Users aria-hidden="true" />
              </button>
              <button type="button" className="icon-btn" aria-label="Settings" onClick={() => navigate("/config")}>
                <Settings aria-hidden="true" />
              </button>
            </>
          )}

          <div className="nav-divider" />

          <div className="account-block">
            <div className="account-meta">
              <div className="account-name">{profileName}</div>
              <div className="account-role">{userRole?.replace("_", " ")}</div>
            </div>
            <button type="button" className="icon-btn" aria-label="Sign out" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <Breadcrumb />

      {onlineStatus === "offline" && (
        <div role="alert" className="connection-banner connection-banner-offline">
          <span className="circle connection-dot connection-dot-offline" />
          No connection. Changes may not save.
        </div>
      )}
      {onlineStatus === "restored" && (
        <div role="status" className="connection-banner connection-banner-restored">
          <span className="circle connection-dot connection-dot-restored" />
          Connection restored.
        </div>
      )}

      {children}

      {showHelp && (
        <>
          <div onClick={() => setShowHelp(false)} className="modal-backdrop" />
          <div role="dialog" aria-modal="true" aria-label="Help" className="help-dialog">
            <div className="help-dialog-head">
              <h2>Help & Quick Reference</h2>
              <button type="button" onClick={() => setShowHelp(false)} className="help-close-btn">
                <X size={18} />
              </button>
            </div>
            <div className="help-dialog-body">
              {[
                { title: "Inventory", body: "View all stocked parts and serials. Use the Serial Numbers tab to filter by status (In Stock, In Transit, Transferred)." },
                { title: "Stock-In", body: "Import new serials or parts into DC inventory via CSV upload or manual entry." },
                { title: "Transfers", body: "Create and manage outbound transfers from DC to branch sites. Advance status: Draft -> Packed -> In Transit -> Received." },
                { title: "Corrections", body: "Fix incorrect serial assignments with a full audit trail. Requires dc_admin or system_admin role." },
                { title: "Exports", body: "Download stocked-in or transferred serials as CSV for reporting." },
                { title: "Analytics", body: "Upload Fixably or GSX exports to analyze repair trends by date range, site, or part." },
                { title: "Physical Count", body: "Reconcile physical stock against system records." },
                { title: "Configuration", body: "Manage sites, parts, branding, and system settings. System admin only." },
              ].map(({ title, body }) => (
                <div key={title} className="help-topic">
                  <div className="help-topic-title">{title}</div>
                  <div className="help-topic-body">{body}</div>
                </div>
              ))}
              <div className="help-footer-note">For support, contact your system administrator.</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

