import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth, type UserRole } from "@/lib/auth";

type Props = {
  allow: UserRole[];
  requireMfa?: boolean; // default: true for dc_admin
  children: ReactNode;
};

export function RoleGuard({ allow, requireMfa, children }: Props) {
  const { state } = useAuth();

  if (state.status === "loading" || state.status === "connecting") {
    const isConnecting = state.status === "connecting";
    return (
      <div style={{ position: "fixed", inset: 0, background: "#f9fafb", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: isConnecting ? "#ef4444" : "var(--blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 16 }} />
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#374151" }}>
          {isConnecting ? "Connection lost" : "Loading…"}
        </p>
        {isConnecting && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9ca3af" }}>
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
      <div className="min-h-screen flex items-center justify-center bg-[#efefef]">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">Access denied</p>
          <p className="text-sm text-gray-500 mt-1">
            Your role <strong>{state.profile.role}</strong> does not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  // MFA enforcement: dc_admin must have aal2 (TOTP verified)
  // requireMfa defaults to true when the role is dc_admin
  const shouldEnforceMfa = requireMfa ?? state.profile.role === "dc_admin";
  if (shouldEnforceMfa) {
    const aal = state.session.user.factors?.length
      ? state.session.user.factors.some((f) => f.status === "verified")
        ? "aal2"
        : "aal1"
      : "aal1";

    // Also check the JWT aal claim (set by Supabase after TOTP challenge)
    const jwtAal = (state.session as { aal?: string }).aal
      ?? (state.session.user as { aal?: string }).aal;

    const effectiveAal = jwtAal ?? aal;

    if (effectiveAal !== "aal2") {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#efefef]">
          <div className="text-center max-w-sm">
            <p className="text-lg font-semibold text-gray-700">MFA required</p>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              Admin accounts must have two-factor authentication enabled and verified.
            </p>
            <a
              href="/login?mfa=setup"
              className="inline-block px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              Set up MFA
            </a>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
