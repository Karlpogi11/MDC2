import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "@/pages/LoginPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { ConfigPage } from "@/pages/ConfigPage";
import { UsersPage } from "@/pages/UsersPage";
import { StockInPage } from "@/pages/StockInPage";
import { TransfersPage } from "@/pages/TransfersPage";
import { TransferNewPage } from "@/pages/TransferNewPage";
import { TransferDetailPage } from "@/pages/TransferDetailPage";
import { CorrectionsPage } from "@/pages/CorrectionsPage";
import { ExportsPage } from "@/pages/ExportsPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { PhysicalCountPage } from "@/pages/PhysicalCountPage";
import { ReceivePage } from "@/pages/ReceivePage";
import { RoleGuard } from "@/components/RoleGuard";

const ALL   = ["system_admin", "dc_admin", "dc_operator", "dc_viewer"] as const;
const OPS   = ["system_admin", "dc_admin", "dc_operator"] as const;
const ADMIN = ["system_admin", "dc_admin"] as const;
const SYS   = ["system_admin"] as const;

export function App() {
  return (
    <Routes>
      <Route path="/login"                      element={<LoginPage />} />
      <Route path="/"                           element={<RoleGuard allow={[...ALL]}><InventoryPage /></RoleGuard>} />
      <Route path="/stock-in"                   element={<RoleGuard allow={[...OPS]}><StockInPage /></RoleGuard>} />
      <Route path="/transfers"                  element={<RoleGuard allow={[...ALL]}><TransfersPage /></RoleGuard>} />
      <Route path="/transfers/new"              element={<RoleGuard allow={[...OPS]}><TransferNewPage /></RoleGuard>} />
      <Route path="/transfers/:id"              element={<RoleGuard allow={[...ALL]}><TransferDetailPage /></RoleGuard>} />
      <Route path="/transfers/:id/receive"      element={<ReceivePage />} />
      <Route path="/corrections"                element={<RoleGuard allow={[...ADMIN]}><CorrectionsPage /></RoleGuard>} />
      <Route path="/exports"                    element={<RoleGuard allow={[...ALL]}><ExportsPage /></RoleGuard>} />
      <Route path="/analytics"                  element={<RoleGuard allow={[...OPS]}><AnalyticsPage /></RoleGuard>} />
      <Route path="/physical-count"             element={<RoleGuard allow={[...OPS]}><PhysicalCountPage /></RoleGuard>} />
      <Route path="/config"                     element={<RoleGuard allow={[...SYS]}><ConfigPage /></RoleGuard>} />
      <Route path="/users"                      element={<RoleGuard allow={[...SYS]}><UsersPage /></RoleGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
