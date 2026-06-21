import { useState, useEffect, useMemo, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api, getSavedProfiles, removeSavedProfile, isProfileExpired } from "@/lib/api";
import { pendingPasswordRecovery, hadRecoveryHash } from "../main";
import { useBranding } from "@/lib/useBranding";

export function LoginPage() {
  const { state, signInWithUsername } = useAuth();
  const { brandName, supportEmail, loginNotice } = useBranding();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedProfiles, setSavedProfiles] = useState(() => getSavedProfiles());
  const [showForm, setShowForm] = useState(false);
  const [reauthProfile, setReauthProfile] = useState<{ username: string; fullName: string | null } | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const isSavedUsername = useMemo(
    () => savedProfiles.some((p) => username.trim().toLowerCase() === p.username.toLowerCase()),
    [savedProfiles, username]
  );

  // Recovery / invite token handling
  const [isRecovery, setIsRecovery] = useState(() => pendingPasswordRecovery);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  // Forgot password UI
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.remove("dark-theme");
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=invite")) {
      setIsRecovery(true);
      const params = new URLSearchParams(hash.slice(1));
      const tok = params.get("token");
      if (tok) setResetToken(tok);
    }
    if (hadRecoveryHash) {
      if (api.auth.getUser()) {
        setIsRecovery(true);
      } else {
        setLinkExpired(true);
      }
    }
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
    try {
      if (resetToken) {
        await api.post("/auth/reset-password", { token: resetToken, newPassword });
      } else {
        await api.auth.updatePassword("", newPassword);
      }
      setPasswordSet(true);
      setTimeout(() => navigate("/", { replace: true }), 1500);
    } catch (err: any) {
      setError(err?.message ?? "Failed to set password");
    }
    setSettingPassword(false);
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    const email = forgotEmail.trim();
    if (!email) return;
    if (/\.\./.test(email) || !/^[^\s@]+@[^\s@]+(\.[a-zA-Z]{2,})+$/.test(email)) {
      setForgotError("Enter a valid email address.");
      return;
    }
    setForgotError(null);
    setForgotLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setForgotSent(true);
    } catch (err: any) {
      setForgotError(err?.message ?? "Failed to send reset link.");
    }
    setForgotLoading(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim()) { setError("Enter your username."); return; }
    if (!password) { setError("Enter your password."); return; }
    setLoading(true);
    const err = await signInWithUsername(username.trim(), password, rememberMe);
    setLoading(false);
    if (err) setError(err);
    else setSavedProfiles(getSavedProfiles()); // refresh in case rememberMe just saved
  }

  async function handleOneClickLogin(profile: { username: string; password: string; lastUsedAt: number; fullName: string | null }) {
    if (isProfileExpired(profile)) {
      setReauthProfile({ username: profile.username, fullName: profile.fullName });
      setReauthPassword("");
      setError(null);
      return;
    }
    setError(null);
    setLoading(true);
    const err = await signInWithUsername(profile.username, profile.password, true);
    setLoading(false);
    if (err) setError(err);
  }

  async function handleReauthSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reauthProfile) return;
    if (!reauthPassword) { setError("Enter your password."); return; }
    setError(null);
    setLoading(true);
    const err = await signInWithUsername(reauthProfile.username, reauthPassword, true);
    setLoading(false);
    if (err) setError(err);
    else {
      setReauthProfile(null);
      setSavedProfiles(getSavedProfiles());
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid #9ca3af", borderRadius: 6,
    padding: "8px 10px", fontSize: 14, color: "#1d1d1f",
    background: "#fff", outline: "none", boxSizing: "border-box", height: 38,
    WebkitTextFillColor: "#1d1d1f",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#fff" }}>
      {/* Left panel */}
      <div className="login-panel" style={{
        width: 360, flexShrink: 0,
        background: "linear-gradient(160deg, #13294b 0%, #0d1e38 100%)",
        display: "flex", flexDirection: "column",
        padding: "48px 40px",
        justifyContent: "space-between",
      }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ marginBottom: 48 }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px", minHeight: 36 }}>
              {brandName ?? ""}
            </p>
          </div>
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
        <p style={{ color: "rgba(255,255,255,0.28)", fontSize: 11, margin: 0 }}>
          Authorized personnel only. All actions are audited.
        </p>
      </div>

      {/* Right panel */}
      <div className="login-right" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, background: "#fff" }}>
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
              {showForgot ? (
                <>
                  <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#1d1d1f", letterSpacing: "-0.4px" }}>Reset password</h1>
                  <p style={{ margin: "0 0 28px", fontSize: 14, color: "#86868b" }}>
                    Enter your email and we'll send a reset link.
                  </p>
                  {forgotSent ? (
                    <div>
                      <div style={{ padding: "12px 16px", background: "#f5f5f7", border: "1px solid #16a34a", borderRadius: "6px", color: "#16a34a", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
                        ✓ Reset link sent. Check your inbox.
                      </div>
                      <button type="button" onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); setForgotError(null); }}
                        style={{ background: "none", border: "none", color: "#0057d9", cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline", display: "block", margin: "0 auto" }}>
                        Back to sign in
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={(e) => void handleForgotSubmit(e)}>
                      <div style={{ marginBottom: 20 }}>
                        <label htmlFor="forgot-email" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>Email</label>
                        <input id="forgot-email" type="email" required autoFocus
                          value={forgotEmail} onChange={(e) => { setForgotEmail(e.target.value); setForgotError(null); }}
                          placeholder="you@company.com"
                          style={{ ...inputStyle, borderColor: forgotError ? "#ff3b30" : undefined }} />
                        {forgotError && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ff3b30" }}>{forgotError}</p>}
                      </div>
                      <button type="submit" disabled={forgotLoading || !forgotEmail.trim()}
                        style={{ width: "100%", background: forgotLoading ? "#6b8fc4" : "#0071e3", color: "#fff", border: "none", borderRadius: "6px", padding: "7px 0", fontSize: 14, fontWeight: 600, cursor: (forgotLoading || !forgotEmail.trim()) ? "not-allowed" : "pointer", transition: "background 150ms", marginBottom: 12 }}>
                        {forgotLoading ? "Sending…" : "Send reset link"}
                      </button>
                      <button type="button" onClick={() => { setShowForgot(false); setForgotEmail(""); setForgotError(null); }}
                        style={{ background: "none", border: "none", color: "#0057d9", cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline", display: "block", margin: "0 auto" }}>
                        Back to sign in
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

                  {savedProfiles.length > 0 && !showForm ? (
                    <div>
                      {error && (
                        <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#f5f5f7", border: "1px solid #ff3b30", borderRadius: "6px", color: "#ff3b30", fontSize: 13 }}>
                          {error}
                        </div>
                      )}
                      {reauthProfile ? (
                        <form onSubmit={(e) => void handleReauthSubmit(e)}>
                          <div style={{ marginBottom: 12, fontSize: 14, color: "#1d1d1f" }}>
                            Sign in as <strong>{reauthProfile.username}</strong>
                          </div>
                          <div style={{ marginBottom: 16 }}>
                            <label htmlFor="reauth-password" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>Password</label>
                            <input
                              id="reauth-password" type="password" autoComplete="current-password" required
                              value={reauthPassword} onChange={(e) => setReauthPassword(e.target.value)}
                              style={inputStyle}
                              onFocus={(e) => (e.target.style.borderColor = "#0071e3")}
                              onBlur={(e) => (e.target.style.borderColor = "#9ca3af")}
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={loading}
                            style={{
                              width: "100%", background: loading ? "#6b8fc4" : "#0071e3", color: "#fff",
                              border: "none", borderRadius: "6px", padding: "7px 0", fontSize: 14,
                              fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", transition: "background 150ms", marginBottom: 12,
                            }}
                          >
                            {loading ? "Signing in…" : "Sign in"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setReauthProfile(null); setError(null); setReauthPassword(""); }}
                            style={{
                              background: "none", border: "none", color: "#0071e3",
                              cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline",
                              display: "block", margin: "0 auto",
                            }}
                          >
                            Use a different account
                          </button>
                        </form>
                      ) : (
                        <>
                          {savedProfiles.map((profile) => (
                            <div key={profile.username} style={{ position: "relative", marginBottom: 12 }}>
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => void handleOneClickLogin(profile)}
                                style={{
                                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                                  padding: "14px 16px", fontSize: 15, fontWeight: 600,
                                  background: loading ? "#6b8fc4" : "#f5f5f7",
                                  color: loading ? "#fff" : "#1d1d1f",
                                  border: "1px solid #d1d5db", borderRadius: "10px",
                                  cursor: loading ? "not-allowed" : "pointer",
                                  transition: "background 150ms",
                                  boxSizing: "border-box",
                                }}
                              >
                                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#0071e3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                  <LogIn size={16} color="#fff" />
                                </div>
                                <div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 15, fontWeight: 600, color: loading ? "#fff" : "#1d1d1f" }}>
                                    {loading ? "Signing in…" : `Sign in as ${profile.username}`}
                                  </div>
                                  <div style={{ fontSize: 12, color: loading ? "rgba(255,255,255,0.7)" : "#86868b", marginTop: 2 }}>
                                    {profile.fullName ? `${profile.fullName} · ` : ""}Saved profile
                                  </div>
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm(`Remove saved profile for ${profile.username}?`)) {
                                    removeSavedProfile(profile.username);
                                    setSavedProfiles(getSavedProfiles());
                                  }
                                }}
                                style={{
                                  position: "absolute", top: -6, right: -6,
                                  width: 22, height: 22, borderRadius: "50%",
                                  background: "#fff", border: "1px solid #d1d5db",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  cursor: "pointer", fontSize: 12, color: "#86868b",
                                  lineHeight: 1, padding: 0,
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => { setShowForm(true); }}
                            style={{
                              background: "none", border: "none", color: "#0071e3",
                              cursor: loading ? "not-allowed" : "pointer",
                              fontSize: 13, padding: 0, textDecoration: "underline",
                              display: "block", margin: "0 auto",
                            }}
                          >
                            Not you? Sign in with a different account
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
                      <div style={{ marginBottom: 16 }}>
                        <label htmlFor="username" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>Username</label>
                        <input
                          id="username" type="text" autoComplete="username" required
                          value={username} onChange={(e) => setUsername(e.target.value)}
                          style={inputStyle}
                          onFocus={(e) => (e.target.style.borderColor = "#0071e3")}
                          onBlur={(e) => (e.target.style.borderColor = "#9ca3af")}
                        />
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <label htmlFor="password" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>Password</label>
                        <input
                          id="password" type="password" autoComplete="current-password" required
                          value={password} onChange={(e) => setPassword(e.target.value)}
                          style={inputStyle}
                          onFocus={(e) => (e.target.style.borderColor = "#0071e3")}
                          onBlur={(e) => (e.target.style.borderColor = "#9ca3af")}
                        />
                        <div style={{ marginTop: 4, textAlign: "right" }}>
                          <button type="button" onClick={() => setShowForgot(true)}
                            style={{ background: "none", border: "none", color: "#0057d9", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>
                            Forgot password?
                          </button>
                        </div>
                      </div>
                      {!isSavedUsername && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, cursor: "pointer", fontSize: 13, color: "#1d1d1f" }}>
                          <input
                            type="checkbox" checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            style={{ accentColor: "#0071e3", width: 16, height: 16, cursor: "pointer" }}
                          />
                          Remember me
                        </label>
                      )}
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
                      {savedProfiles.length > 0 && showForm && (
                        <button type="button" onClick={() => setShowForm(false)} style={{ background: "none", border: "none", color: "#0071e3", cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline", display: "block", margin: "16px auto 0" }}>
                          Use saved profile
                        </button>
                      )}
                    </>
                  )}

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
                      <button type="button" onClick={() => setShowForgot(true)}
                        style={{ background: "none", border: "none", color: "#0057d9", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>
                        Request new link
                      </button>
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}