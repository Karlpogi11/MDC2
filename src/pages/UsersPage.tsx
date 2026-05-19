import { friendlyError } from "@/lib/friendlyError";
import { useTableResize } from "@/components/ResizableColumns";
import { DangerAction } from "@/components/DangerAction";
import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Boxes, UserPlus, Check, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import type { UserRole } from "@/lib/auth";

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  username: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};

const ROLES: UserRole[] = ["system_admin", "dc_admin", "dc_operator", "dc_viewer"];

const ROLE_LABELS: Record<UserRole, string> = {
  system_admin: "System Admin",
  dc_admin: "DC Admin",
  dc_operator: "DC Operator",
  dc_viewer: "DC Viewer",
};

async function fetchUsers(): Promise<UserRow[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data } = await client
    .from("profiles")
    .select("id,full_name,email,username,role,is_active,created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as UserRow[];
}

export function UsersPage() {
  const tableRef = useTableResize();
  const { state: authState } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form state
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("dc_operator");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentUserId = authState.status === "authenticated" ? authState.user.id : null;

  useEffect(() => {
    fetchUsers().then((rows) => { setUsers(rows); setLoading(false); });
  }, []);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);

    const client = getSupabaseClient();
    if (!client) { setInviteError("Supabase not configured."); setInviting(false); return; }

    const { data, error } = await client.functions.invoke("invite-user", {
      body: { email, username, full_name: fullName, role },
    });

    if (error || data?.error) {
      setInviteError(data?.error ?? friendlyError(error) ?? "Invite failed.");
      setInviting(false);
      return;
    }

    setInviteSuccess(`Invite sent to ${email}. User created with role ${role} and username "${username}".`);
    setEmail(""); setUsername(""); setFullName(""); setRole("dc_operator");
    const rows = await fetchUsers();
    setUsers(rows);
    setInviting(false);
  }

  async function toggleActive(user: UserRow) {
    setTogglingId(user.id);
    setActionError(null);
    const client = getSupabaseClient();
    if (!client) { setActionError("Supabase not configured."); setTogglingId(null); return; }

    const { error } = await client
      .from("profiles")
      .update({ is_active: !user.is_active })
      .eq("id", user.id);

    if (error) { setActionError(friendlyError(error)); }
    else { setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, is_active: !u.is_active } : u)); }
    setTogglingId(null);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)",
    padding: "9px 12px", fontSize: 13, color: "#111827",
    background: "#fff", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5" }}>
      {/* Header */}
      <header style={{
        background: "linear-gradient(180deg, #13294b 0%, #0d1e38 100%)",
        padding: "14px 28px", display: "flex", alignItems: "center", gap: 16,
        borderBottom: "1px solid #0a2f36",
      }}>
        <button type="button" onClick={() => navigate("/")}
          style={{ background: "transparent", border: "none", color: "#9fb4ba", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "var(--radius)", background: "#0f4c57", color: "var(--nav-active)" }}>
            <Boxes size={17} />
          </span>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>MDC</span>
          <span style={{ color: "#4a6a7a", fontSize: 14, marginLeft: 4 }}>/ Users</span>
        </div>
        <span style={{ marginLeft: "auto", background: "#1e3a5f", color: "#9fb4ba", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          System Admin
        </span>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>User Management</h1>
        <p style={{ margin: "0 0 28px", fontSize: 13, color: "#6b7a8d" }}>
          Invite users and manage their access. Invited users receive an email to set their password.
        </p>

        {/* Invite form */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", marginBottom: 24, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8 }}>
            <UserPlus size={16} color="var(--blue)" />
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>Invite new user</h2>
          </div>
          <form onSubmit={(e) => void handleInvite(e)} style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>
                  Email <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="user@company.com" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>
                  Username <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} placeholder="e.g. jdoe" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Full name</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} placeholder="Juan Dela Cruz" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>
                  Role <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}
                  style={{ ...inputStyle, cursor: "pointer" }}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>

            {inviteError && (
              <div role="alert" style={{ marginBottom: 14, padding: "9px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>
                {inviteError}
              </div>
            )}
            {inviteSuccess && (
              <div role="status" style={{ marginBottom: 14, padding: "9px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", color: "#15803d", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <Check size={14} /> {inviteSuccess}
              </div>
            )}

            <button type="submit" disabled={inviting}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: inviting ? "#6b8fc4" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: inviting ? "not-allowed" : "pointer" }}>
              <UserPlus size={14} />
              {inviting ? "Sending invite…" : "Send invite"}
            </button>
          </form>
        </div>

        {/* User list */}
        <div className="table-card">
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>
              All users {!loading && <span style={{ fontWeight: 400, color: "#6b7a8d" }}>({users.length})</span>}
            </h2>
          </div>

          {actionError && (
            <div role="alert" style={{ margin: "12px 20px 0", padding: "9px 12px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>
              {actionError}
            </div>
          )}

          <div className="table-scroll">
          <table ref={tableRef}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="empty-row">Loading…</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={6} className="empty-row">No users yet.</td></tr>
              )}
              {!loading && users.map((user) => (
                <tr key={user.id} style={{ opacity: user.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600 }}>
                    {user.full_name ?? <span style={{ color: "#9ca3af" }}>—</span>}
                  </td>
                  <td style={{ fontFamily: "monospace" }}>
                    {user.username ?? <span style={{ color: "#9ca3af" }}>—</span>}
                  </td>
                  <td style={{ color: "#6b7a8d" }}>{user.email ?? "—"}</td>
                  <td>
                    <span className="status-badge" style={{
                      background: user.role === "system_admin" ? "#1e3a5f" : user.role === "dc_admin" ? "#dbeafe" : user.role === "dc_operator" ? "#dcfce7" : "#f3f4f6",
                      color: user.role === "system_admin" ? "#9fb4ba" : user.role === "dc_admin" ? "#1d4ed8" : user.role === "dc_operator" ? "#15803d" : "#6b7a8d",
                    }}>
                      {ROLE_LABELS[user.role]}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: user.is_active ? "#15803d" : "#9ca3af" }}>
                      {user.is_active ? <Check size={12} /> : <X size={12} />}
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {user.id !== currentUserId && (
                      user.is_active
                        ? <DangerAction label="Deactivate" confirmLabel="Deactivate" description={`Deactivate ${user.full_name ?? user.username ?? "user"}?`}
                            onConfirm={() => void toggleActive(user)} busy={togglingId === user.id} />
                        : <button type="button" disabled={togglingId === user.id} onClick={() => void toggleActive(user)}
                            style={{ border: "1px solid var(--line)", background: "#fff", color: "#15803d", fontSize: 12, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                            {togglingId === user.id ? "…" : "Activate"}
                          </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </main>
    </div>
  );
}
