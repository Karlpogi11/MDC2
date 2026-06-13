import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { state: authState } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) { setError("Passwords don't match."); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    setError(null);
    setSaving(true);
    try {
      await api.auth.updatePassword(currentPassword, newPassword);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.message ?? "Failed to update password");
    }
    setSaving(false);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)",
    padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 380, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 32 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Set your password</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--muted)" }}>
          You're using a temporary password. Please set a new one to continue.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          {error && <div style={{ marginBottom: 16, padding: "8px 12px", border: "1px solid var(--negative)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>{error}</div>}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>Current password</label>
            <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>New password</label>
            <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 8 characters" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>Confirm password</label>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" style={inputStyle} />
          </div>
          <button type="submit" disabled={saving} style={{ width: "100%", padding: "8px", fontSize: 13, fontWeight: 600, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Set password & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
