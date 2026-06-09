import { friendlyError } from "@/lib/friendlyError";
import { useTableResize } from "@/components/ResizableColumns";
import { DangerAction } from "@/components/DangerAction";
import { useState, useEffect, useRef, type FormEvent, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Boxes, UserPlus, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import type { UserRole } from "@/lib/auth";
import { getTheme } from "@/lib/theme";

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
const PAGE_SIZE = 50;

function RoleDropdown({ value, busy, onChange }: { value: UserRole; busy: boolean; onChange: (r: UserRole) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<UserRole | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && e.target !== btnRef.current) { setOpen(false); setPending(null); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const menuHeight = 140;
    const showAbove = spaceBelow < menuHeight;
    setPos(showAbove ? { top: r.top - menuHeight - 4, left: r.left } : { top: r.bottom + 4, left: r.left });
    setOpen((o) => !o);
    setPending(null);
  }

  function select(r: UserRole) {
    if (r === value) { setOpen(false); return; }
    setPending(r);
  }

  function confirm() {
    if (pending) { onChange(pending); }
    setOpen(false);
    setPending(null);
  }

  return (
    <>
      <button ref={btnRef} type="button" disabled={busy} onClick={toggle}
        style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, border: "none", background: "transparent", color: "var(--text)", cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap", opacity: busy ? 0.5 : 1 }}>
        {ROLE_LABELS[value]} ▾
      </button>
      {open && (
        <div ref={ref} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", boxShadow: "0 4px 16px rgba(0,0,0,0.15)", minWidth: 150, overflow: "hidden" }}>
          {ROLES.map((r) => {
            const isCurrent = r === value;
            const isSelected = r === pending;
            return (
              <button key={r} type="button" onClick={() => select(r)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", padding: "7px 12px", fontSize: 12, fontWeight: isCurrent ? 700 : 400, background: isSelected ? "var(--bg-surface-elevated)" : "transparent", color: "var(--text)", border: "none", cursor: "pointer", gap: 8 }}>
                <span>{ROLE_LABELS[r]}</span>
                {isCurrent && <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>current</span>}
              </button>
            );
          })}
          {pending && (
            <div style={{ borderTop: "1px solid var(--line)", padding: "8px 12px", display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--muted)", flex: 1 }}>Change to {ROLE_LABELS[pending]}?</span>
              <button type="button" onClick={confirm}
                style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", cursor: "pointer" }}>
                Confirm
              </button>
              <button type="button" onClick={() => setPending(null)}
                style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", background: "transparent", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: "var(--radius)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function UsersPage() {
  const tableRef = useTableResize();
  const { state: authState } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const t = getTheme();
    document.documentElement.classList.toggle("dark-theme", t === "dark");
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const loadPage = useCallback(async (p: number) => {
    setLoading(true);
    setActionError(null);
    const client = getSupabaseClient();
    if (!client) { setLoading(false); return; }
    const from = p * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    try {
      const { data, error, count } = await client
        .from("profiles")
        .select("id,full_name,email,username,role,is_active,created_at", { count: "exact", head: false })
        .order("email", { ascending: true })
        .range(from, to);
      if (error) { setActionError(error.message); setLoading(false); return; }
      if (data) setUsers(data as UserRow[]);
      if (count !== null) setTotalCount(count);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to load users.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadPage(0); }, [loadPage]);

  // Invite form state
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("dc_operator");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Username availability check
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "taken" | "available">("idle");
  useEffect(() => {
    if (username.length < 2) { setUsernameStatus("idle"); return; }
    setUsernameStatus("checking");
    const t = setTimeout(async () => {
      const client = getSupabaseClient();
      if (!client) return;
      const { data } = await client.from("profiles").select("id").eq("username", username.trim()).maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentUserId = authState.status === "authenticated" ? authState.user.id : null;

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);

    if (usernameStatus === "taken") { setInviteError("Username already taken."); setInviting(false); return; }

    const client = getSupabaseClient();
    if (!client) { setInviteError("Supabase not configured."); setInviting(false); return; }

    const { data, error } = await client.functions.invoke("invite-user", {
      body: { email, username, full_name: fullName, role },
    });

    if (error || data?.error) {
      setInviteError(data?.error ?? error?.message ?? "Invite failed.");
      setInviting(false);
      return;
    }

    const emailNote = data?.email_sent
      ? `Credentials emailed to ${email}.`
      : `Account created — email delivery failed (${data?.email_error ?? "unknown"}). Share credentials manually.`;
    setInviteSuccess(`User "${username}" created as ${role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}. ${emailNote}`);
    setEmail(""); setUsername(""); setFullName(""); setRole("dc_operator"); setUsernameStatus("idle");
    setPage(0);
    await loadPage(0);
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

  async function changeRole(user: UserRow, newRole: UserRole) {
    setChangingRoleId(user.id);
    setActionError(null);
    const client = getSupabaseClient();
    if (!client) { setChangingRoleId(null); return; }
    const { error } = await client.from("profiles").update({ role: newRole }).eq("id", user.id);
    if (error) setActionError(`Failed to change role: ${error.message}`);
    else setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: newRole } : u));
    setChangingRoleId(null);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)",
    padding: "5px 10px", fontSize: 13, color: "var(--text)",
    background: "var(--bg-surface)", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      {/* Header */}
      <header style={{
        background: "var(--nav-bg)",
        padding: "14px 28px", display: "flex", alignItems: "center", gap: 16,
        borderBottom: "1px solid var(--nav-border)",
      }}>
        <button type="button" onClick={() => navigate("/")}
          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>MDC</span>
          <span style={{ color: "var(--muted)", fontSize: 14, marginLeft: 4 }}>/ Users</span>
        </div>
        <span style={{ marginLeft: "auto", background: "var(--bg-surface-elevated)", color: "var(--muted)", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          System Admin
        </span>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>User Management</h1>
        <p style={{ margin: "0 0 28px", fontSize: 13, color: "var(--muted)" }}>
          Invite users and manage their access. A temporary password is auto-generated and emailed to the new user.
        </p>

        {/* Invite form */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", marginBottom: 24, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", gap: 8 }}>
            <UserPlus size={16} color="var(--blue)" />
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Invite new user</h2>
          </div>
          <form onSubmit={(e) => void handleInvite(e)} style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
                  Email <span style={{ color: "var(--negative)" }}>*</span>
                </label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="user@company.com" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
                  Username <span style={{ color: "var(--negative)" }}>*</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)}
                    style={{ ...inputStyle, borderColor: usernameStatus === "taken" ? "var(--negative)" : usernameStatus === "available" ? "#16a34a" : undefined, paddingRight: 28 }}
                    placeholder="e.g. jdoe" />
                  {usernameStatus === "checking" && (
                    <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--muted)" }}>…</span>
                  )}
                  {usernameStatus === "taken" && (
                    <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--negative)" }}>✕</span>
                  )}
                  {usernameStatus === "available" && (
                    <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#16a34a" }}>✓</span>
                  )}
                </div>
                {usernameStatus === "taken" && (
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--negative)" }}>Username already taken.</p>
                )}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>Full name</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} placeholder="Juan Dela Cruz" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
                  Role <span style={{ color: "var(--negative)" }}>*</span>
                </label>
                <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}
                  style={{ ...inputStyle, cursor: "pointer" }}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>A temporary password will be auto-generated and emailed directly to the user. They will be required to change it on first login.</p>
              </div>
            </div>

            {inviteError && (
              <div role="alert" style={{ marginBottom: 14, padding: "5px 10px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>
                {inviteError}
              </div>
            )}
            {inviteSuccess && (
              <div role="status" style={{ marginBottom: 14, padding: "8px 12px", background: "var(--bg-surface-elevated)", border: "1px solid var(--link)", borderRadius: "var(--radius)", color: "var(--link)", fontSize: 13, display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                <Check size={14} /> {inviteSuccess}
              </div>
            )}

            <button type="submit" disabled={inviting}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: inviting ? "not-allowed" : "pointer", opacity: inviting ? 0.7 : 1 }}>
              <UserPlus size={14} />
              {inviting ? "Sending invite…" : "Send invite"}
            </button>
          </form>
        </div>

        {/* User list */}
        <div className="table-card">
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              All users {!loading && <span style={{ fontWeight: 400, color: "var(--muted)" }}>({totalCount.toLocaleString()})</span>}
            </h2>
          </div>

          {actionError && (
            <div role="alert" style={{ margin: "12px 20px 0", padding: "5px 10px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", color: "var(--negative)", fontSize: 13 }}>
              {actionError}
            </div>
          )}

          <div className="table-scroll">
          <table ref={tableRef} style={{ tableLayout: "fixed", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>Name</th>
                <th style={{ width: "14%" }}>Username</th>
                <th style={{ width: "25%" }}>Email</th>
                <th style={{ width: "14%" }}>Role</th>
                <th style={{ width: "10%" }}>Status</th>
                <th style={{ width: "19%" }} />
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
                  <td style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.full_name ?? <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.username ?? <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.email ?? "—"}
                  </td>
                  <td style={{ padding: "0 8px" }}>
                    {user.id === currentUserId ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
                        {ROLE_LABELS[user.role]}
                      </span>
                    ) : (
                      <RoleDropdown
                        value={user.role}
                        busy={changingRoleId === user.id}
                        onChange={(r) => void changeRole(user, r)}
                      />
                    )}
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: user.is_active ? "var(--link)" : "var(--muted)", whiteSpace: "nowrap" }}>
                      {user.is_active ? <Check size={12} /> : <X size={12} />}
                      {user.is_active ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 16 }}>
                    {user.id !== currentUserId && (
                      user.is_active
                        ? <DangerAction
                            size="sm"
                            label="Disable"
                            confirmLabel="Disable account"
                            description={`Disable ${user.full_name ?? user.username ?? "this user"}? They will no longer be able to log in.`}
                            onConfirm={() => void toggleActive(user)}
                            busy={togglingId === user.id}
                          />
                        : <button type="button" disabled={togglingId === user.id} onClick={() => void toggleActive(user)}
                            style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", color: "var(--text)", fontSize: 11, fontWeight: 600, padding: "3px 8px", cursor: "pointer", borderRadius: "var(--radius)" }}>
                            {togglingId === user.id ? "…" : "Enable"}
                          </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {totalCount > PAGE_SIZE && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 20px", borderTop: "1px solid var(--line)" }}>
              <button type="button" disabled={page === 0 || loading} onClick={() => { const p = page - 1; setPage(p); loadPage(p); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: page === 0 || loading ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
                <ChevronLeft size={14} /> Prev
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                Page {page + 1} of {pageCount.toLocaleString()}
              </span>
              <button type="button" disabled={page >= pageCount - 1 || loading} onClick={() => { const p = page + 1; setPage(p); loadPage(p); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--bg-surface)", color: "var(--text)", cursor: page >= pageCount - 1 || loading ? "not-allowed" : "pointer", opacity: page >= pageCount - 1 ? 0.4 : 1 }}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}




