import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth, type UserRole } from "@/lib/auth";

type Props = {
  allow: UserRole[];
  children: ReactNode;
};

export function RoleGuard({ allow, children }: Props) {
  const { state } = useAuth();

  if (state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#efefef]">
        <span className="text-sm text-gray-500">Loading…</span>
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

  return <>{children}</>;
}
