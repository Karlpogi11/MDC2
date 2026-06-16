import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ChangePasswordPage } from "@/pages/ChangePasswordPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { ConfigPage } from "@/pages/ConfigPage";
import { UsersPage } from "@/pages/UsersPage";
import { StockInPage } from "@/pages/StockInPage";
import { TransfersPage } from "@/pages/TransfersPage";
import { TransferNewPage } from "@/pages/TransferNewPage";
import { TransferDetailPage } from "@/pages/TransferDetailPage";
import { TransferTemplatesPage } from "@/pages/TransferTemplatesPage";
import { CorrectionsPage } from "@/pages/CorrectionsPage";
import { ExportsPage } from "@/pages/ExportsPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { PhysicalCountPage } from "@/pages/PhysicalCountPage";
import { ReceivePage } from "@/pages/ReceivePage";
import { AuditLogPage } from "@/pages/AuditLogPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { RoleGuard } from "@/components/RoleGuard";

const ALL   = ["system_admin", "dc_admin", "dc_operator", "dc_viewer"] as const;
const OPS   = ["system_admin", "dc_admin", "dc_operator"] as const;
const ADMIN = ["system_admin", "dc_admin"] as const;
const SYS   = ["system_admin"] as const;

export function App() {
  return (
    <Routes>
      <Route path="/login"                      element={<LoginPage />} />
      <Route path="/change-password"            element={<ChangePasswordPage />} />
      <Route path="/dashboard"                  element={<RoleGuard allow={[...ALL, "shipping_coordinator"]}><DashboardPage /></RoleGuard>} />
      <Route path="/" element={
        window.location.hash.includes("type=recovery") || window.location.hash.includes("type=invite")
          ? <LoginPage />
          : window.location.hash.includes("access_token") || window.location.hash.includes("error_description")
          ? <LoginPage />
          : <Navigate to="/dashboard" replace />
      } />
      <Route path="/inventory"                  element={<RoleGuard allow={[...ALL, "shipping_coordinator"]}><InventoryPage /></RoleGuard>} />
      <Route path="/stock-in"                   element={<RoleGuard allow={[...OPS]}><StockInPage /></RoleGuard>} />
      <Route path="/transfers"                  element={<RoleGuard allow={[...ALL, "shipping_coordinator"]}><TransfersPage /></RoleGuard>} />
      <Route path="/transfers/new"              element={<RoleGuard allow={[...OPS]}><TransferNewPage /></RoleGuard>} />
      <Route path="/transfers/templates"        element={<RoleGuard allow={[...ADMIN]}><TransferTemplatesPage /></RoleGuard>} />
      <Route path="/transfers/:id"              element={<RoleGuard allow={[...ALL, "shipping_coordinator"]}><TransferDetailPage /></RoleGuard>} />
      {/* Public receipt link: ReceivePage validates signed token via get_transfer_by_token; logged-in DC staff use RLS-backed access. */}
      <Route path="/transfers/:id/receive"      element={<ReceivePage />} />
      <Route path="/corrections"                element={<RoleGuard allow={[...ADMIN]}><CorrectionsPage /></RoleGuard>} />
      <Route path="/exports"                    element={<RoleGuard allow={[...ALL]}><ExportsPage /></RoleGuard>} />
      <Route path="/analytics"                  element={<RoleGuard allow={[...OPS]}><AnalyticsPage /></RoleGuard>} />
      <Route path="/physical-count"             element={<RoleGuard allow={[...OPS]}><PhysicalCountPage /></RoleGuard>} />
      <Route path="/config"                     element={<RoleGuard allow={[...SYS]}><ConfigPage /></RoleGuard>} />
      <Route path="/users"                      element={<RoleGuard allow={[...SYS]}><UsersPage /></RoleGuard>} />
      <Route path="/audit-log"                  element={<RoleGuard allow={[...ADMIN]}><AuditLogPage /></RoleGuard>} />
      <Route path="/reports"                    element={<RoleGuard allow={[...ALL]}><ReportsPage /></RoleGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
