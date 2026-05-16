import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function LoginPage() {
  const { signInWithUsername, signInWithGoogle, state } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Redirect once authenticated
  useEffect(() => {
    if (state.status === "authenticated") navigate("/", { replace: true });
  }, [state.status, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await signInWithUsername(username.trim(), password);
    setLoading(false);
    if (err) setError(err);
    // navigation handled by useEffect above
  }

  async function handleGoogle() {
    setError(null);
    setGoogleLoading(true);
    const err = await signInWithGoogle();
    setGoogleLoading(false);
    if (err) setError(err);
    // On success, Supabase redirects — no navigate() needed
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)",
    padding: "10px 12px", fontSize: 14, color: "#111827",
    background: "#fff", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f2f5" }}>
      {/* Left panel */}
      <div className="login-panel" style={{
        width: 340, flexShrink: 0,
        background: "linear-gradient(180deg, #13294b 0%, #0d1e38 100%)",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        padding: "48px 36px",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, background: "#0f4c57", color: "var(--nav-active)" }}>
              <Boxes size={22} />
            </span>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-1px", color: "#fff", fontFamily: "'Trebuchet MS','Segoe UI',sans-serif" }}>
              MDC
            </span>
          </div>
          <p style={{ color: "#9fb4ba", fontSize: 13, margin: 0 }}>Distribution Center</p>

          <div style={{ marginTop: 48, borderTop: "1px solid #1e3a5f", paddingTop: 32 }}>
            <p style={{ color: "#6a8fa0", fontSize: 12, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
              System access
            </p>
            {["DC On-Hand Inventory", "Stock-In & Transfers", "Edit Serial / Corrections", "Analytics & Exports"].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--nav-active)", flexShrink: 0 }} />
                <span style={{ color: "#9fb4ba", fontSize: 13 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <p style={{ color: "#3d5a6e", fontSize: 11, margin: 0 }}>
          Authorized personnel only. All actions are audited.
        </p>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 12, background: "#e8edf5", marginBottom: 24 }}>
            <Lock size={20} color="#13294b" />
          </div>

          <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1a2a3a" }}>Sign in to MDC</h1>
          <p style={{ margin: "0 0 28px", fontSize: 14, color: "#6b7a8d" }}>
            Enter your credentials to access the inventory system.
          </p>

          {/* Google button */}
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={googleLoading}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)",
              padding: "10px 0", fontSize: 14, fontWeight: 600, color: "#374151",
              cursor: googleLoading ? "not-allowed" : "pointer", marginBottom: 20,
              opacity: googleLoading ? 0.7 : 1,
            }}
          >
            {/* Google SVG icon */}
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            <span style={{ fontSize: 12, color: "#9ca3af", whiteSpace: "nowrap" }}>or sign in with username</span>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          </div>

          {/* Username + password form */}
          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="username" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
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
                onFocus={(e) => (e.target.style.borderColor = "var(--blue)")}
                onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label htmlFor="password" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
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
                onFocus={(e) => (e.target.style.borderColor = "var(--blue)")}
                onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
              />
            </div>

            {error && (
              <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || state.status === "loading"}
              style={{
                width: "100%", background: (loading || state.status === "loading") ? "#6b8fc4" : "var(--blue)", color: "#fff",
                border: "none", borderRadius: "var(--radius)", padding: "11px 0", fontSize: 14,
                fontWeight: 600, cursor: (loading || state.status === "loading") ? "not-allowed" : "pointer", transition: "background 150ms",
              }}
            >
              {loading || state.status === "loading" ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p style={{ marginTop: 28, fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
            Access is restricted to authorized DC personnel.<br />
            Contact your administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  );
}
