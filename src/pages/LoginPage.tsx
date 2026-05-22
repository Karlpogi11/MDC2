import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { pendingPasswordRecovery, hadRecoveryHash } from "../main";
import { useBranding } from "@/lib/useBranding";

export function LoginPage() {
  const { state, signInWithUsername, signInWithGoogle } = useAuth();
  const { brandName, supportEmail, loginNotice } = useBranding();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Recovery / invite token handling
  const [isRecovery, setIsRecovery] = useState(() => pendingPasswordRecovery);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  useEffect(() => {
    // Login page is always light mode
    document.documentElement.classList.remove("dark-theme");
  }, []);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;

    // Check hash immediately for recovery/invite token
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=invite")) {
      setIsRecovery(true);
    }

    // Listen for PASSWORD_RECOVERY event (fires when Supabase processes the token)
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    // Also check current session — if user is in recovery state
    client.auth.getSession().then(({ data: { session } }) => {
      if (session && hadRecoveryHash) {
        setIsRecovery(true);
      } else if (!session && hadRecoveryHash) {
        setLinkExpired(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (state.status === "authenticated" && !isRecovery) navigate("/dashboard", { replace: true });
  }, [state.status, navigate, isRecovery]);

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError("Passwords don't match."); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    setError(null);
    setSettingPassword(true);
    const client = getSupabaseClient();
    const { error: updateErr } = await client!.auth.updateUser({ password: newPassword });
    setSettingPassword(false);
    if (updateErr) { setError(updateErr.message); return; }
    setPasswordSet(true);
    setTimeout(() => navigate("/", { replace: true }), 1500);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await signInWithUsername(username.trim(), password);
    setLoading(false);
    if (err) setError(err);
  }

  async function handleGoogle() {
    setError(null);
    setGoogleLoading(true);
    const err = await signInWithGoogle();
    setGoogleLoading(false);
    if (err) setError(err);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid #d1d5db", borderRadius: 6,
    padding: "8px 10px", fontSize: 14, color: "#1d1d1f",
    background: "#fff", outline: "none", boxSizing: "border-box", height: 38,
    WebkitTextFillColor: "#1d1d1f",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f5f5f7" }}>
      {/* Left panel */}
      <div className="login-panel" style={{
        width: 360, flexShrink: 0,
        background: "linear-gradient(160deg, #13294b 0%, #0d1e38 100%)",
        display: "flex", flexDirection: "column",
        padding: "48px 40px",
        justifyContent: "space-between",
      }}>
        {/* Brand + feature list */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {/* Brand */}
          <div style={{ marginBottom: 48 }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px", minHeight: 36 }}>
              {brandName ?? ""}
            </p>
          </div>

          {/* Feature list */}
          <div>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
              System access
            </p>
            {["DC On-Hand Inventory", "Stock-In & Transfers", "Serial Corrections", "Analytics & Exports"].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
                <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: 400 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer pinned to bottom */}
        <p style={{ color: "rgba(255,255,255,0.28)", fontSize: 11, margin: 0 }}>
          Authorized personnel only. All actions are audited.
        </p>
      </div>

      {/* Right panel — always light, never dark */}
      <div className="login-right" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, background: "#f5f5f7" }}>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 8, background: "#e8edf5", marginBottom: 20 }}>
            <Lock size={18} color="#13294b" />
          </div>

          {isRecovery ? (
            <>
              <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1d1d1f" }}>Set your password</h1>
              <p style={{ margin: "0 0 28px", fontSize: 14, color: "#86868b" }}>Choose a password to complete your account setup.</p>
              {passwordSet ? (
                <div style={{ padding: "12px 16px", background: "#f5f5f7", border: "1px solid #0057d9", borderRadius: "6px", color: "#0057d9", fontSize: 14, fontWeight: 600 }}>
                  ✓ Password set! Redirecting…
                </div>
              ) : (
                <form onSubmit={(e) => void handleSetPassword(e)}>
                  {error && <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f5f5f7", border: "1px solid #ff3b30", borderRadius: "6px", color: "#ff3b30", fontSize: 13 }}>{error}</div>}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#1d1d1f" }}>New password</label>
                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 8 characters" required style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 24 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#1d1d1f" }}>Confirm password</label>
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat password" required style={inputStyle} />
                  </div>
                  <button type="submit" disabled={settingPassword} style={{ width: "100%", padding: "7px", fontSize: 14, fontWeight: 700, background: "#0071e3", color: "#fff", border: "none", borderRadius: "6px", cursor: settingPassword ? "not-allowed" : "pointer", opacity: settingPassword ? 0.7 : 1 }}>
                    {settingPassword ? "Setting password…" : "Set password & sign in"}
                  </button>
                </form>
              )}
            </>
          ) : (
          <>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#1d1d1f", letterSpacing: "-0.4px" }}>Sign in to MDC</h1>
          <p style={{ margin: "0 0 28px", fontSize: 14, color: "#86868b" }}>
            Enter your credentials to access the inventory system.
          </p>

          {/* Username + password form */}
          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="username" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#0071e3")}
                onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label htmlFor="password" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#0071e3")}
                onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
              />
            </div>

            {error && (
              <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#f5f5f7", border: "1px solid #d1d5db", borderRadius: "6px", color: "#ff3b30", fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || state.status === "loading"}
              style={{
                width: "100%", background: (loading || state.status === "loading") ? "#6b8fc4" : "#0071e3", color: "#fff",
                border: "none", borderRadius: "6px", padding: "7px 0", fontSize: 14,
                fontWeight: 600, cursor: (loading || state.status === "loading") ? "not-allowed" : "pointer", transition: "background 150ms",
              }}
            >
              {loading || state.status === "loading" ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            <span style={{ fontSize: 12, color: "#86868b", whiteSpace: "nowrap" }}>or continue with</span>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          </div>

          {/* Google button */}
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={googleLoading}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              background: "#fff", border: "1px solid #d1d5db", borderRadius: 6,
              padding: "8px 0", fontSize: 14, fontWeight: 600, color: "#1d1d1f",
              cursor: googleLoading ? "not-allowed" : "pointer",
              opacity: googleLoading ? 0.7 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          {loginNotice && (
            <div style={{ marginTop: 20, padding: "10px 14px", background: "#fef9c3", border: "1px solid #fde047", borderRadius: 6, fontSize: 13, color: "#713f12", textAlign: "center" }}>
              {loginNotice}
            </div>
          )}
          <p style={{ marginTop: 20, fontSize: 12, color: "#86868b", textAlign: "center" }}>
            Access is restricted to authorized DC personnel.{" "}
            {supportEmail
              ? <><br />Contact <a href={`mailto:${supportEmail}`} style={{ color: "#0071e3" }}>{supportEmail}</a> if you need access.</>
              : <><br />Contact your administrator if you need access.</>
            }
          </p>
          {linkExpired && (
            <p style={{ marginTop: 12, fontSize: 12, color: "#86868b", textAlign: "center" }}>
              Invite link expired.{" "}
              <button type="button" onClick={() => {
                const email = window.prompt("Enter your email to receive a new link:");
                if (!email) return;
                const client = getSupabaseClient();
                client?.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` })
                  .then(() => alert(`Reset link sent to ${email}. Check your inbox.`));
              }} style={{ background: "none", border: "none", color: "#0057d9", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>
                Request new link
              </button>
            </p>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}





