import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth, type UserRole } from "@/lib/auth";

type Props = {
  allow: UserRole[];
  children: ReactNode;
};

export function RoleGuard({ allow, children }: Props) {
  const { state } = useAuth();

  if (state.status === "loading" || state.status === "connecting") {
    const isConnecting = state.status === "connecting";
    return (
      <div style={{ position: "fixed", inset: 0, background: "var(--bg-surface-elevated)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
        <div className="circle" style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: isConnecting ? "#ef4444" : "var(--blue)", animation: "spin 0.8s linear infinite", marginBottom: 16 }} />
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          {isConnecting ? "Connection lost" : "Loading…"}
        </p>
        {isConnecting && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Waiting for database connection…
          </p>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!allow.includes(state.profile.role)) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "var(--bg-surface-elevated)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>Access denied</p>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            Your role <strong>{state.profile.role}</strong> does not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }



  return <>{children}</>;
}



