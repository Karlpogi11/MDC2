import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * DangerAction — trigger button stays fixed-size; confirm appears in a portal
 * modal so it never shifts surrounding layout.
 */
export function DangerAction({
  label,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  busy = false,
  size = "md",
}: {
  label: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  size?: "sm" | "md";
}) {
  const [confirming, setConfirming] = useState(false);
  const btnStyle = size === "sm"
    ? { padding: "3px 8px", fontSize: 11, fontWeight: 600 }
    : { padding: "7px 12px", fontSize: 13, fontWeight: 600 };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        style={{
          border: "1px solid var(--line)", background: "transparent", color: "var(--negative)",
          cursor: "pointer", borderRadius: "var(--radius)", ...btnStyle,
        }}
      >
        {label}
      </button>

      {confirming && createPortal(
        <>
          <div
            onClick={() => setConfirming(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 }}
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed", top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              background: "var(--bg-surface)", borderRadius: "var(--radius)",
              padding: 24, width: 340, zIndex: 201,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            {description && (
              <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text)" }}>{description}</p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", color: "var(--text)", padding: "4px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: "var(--radius)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setConfirming(false); onConfirm(); }}
                disabled={busy}
                style={{ border: "none", background: "#b91c1c", color: "#fff", padding: "4px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: "var(--radius)" }}
              >
                {busy ? "…" : confirmLabel}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/**
 * DangerZoneCard — full section card for settings pages (like Reset inventory).
 * Requires checking all checkboxes before the action button activates.
 */
export function DangerZoneCard({
  title,
  description,
  checks,
  actionLabel,
  onConfirm,
  successMessage,
}: {
  title: string;
  description: string;
  checks: string[];
  actionLabel: string;
  onConfirm: () => Promise<string | null>; // returns error string or null
  successMessage: string;
}) {
  const [checked, setChecked] = useState<boolean[]>(checks.map(() => false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const allChecked = checked.every(Boolean);

  async function handle() {
    setBusy(true); setError(null);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
    else setDone(true);
  }

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 16 }}>
      <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "var(--negative)" }}>⚠ {title}</p>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>{description}</p>

      {done
        ? <p style={{ margin: 0, fontSize: 13, color: "var(--text)", fontWeight: 600 }}>✓ {successMessage}</p>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {error && <p style={{ margin: 0, fontSize: 12, color: "var(--negative)" }}>{error}</p>}
            {checks.map((text, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={checked[i]}
                  onChange={(e) => setChecked((prev) => prev.map((v, j) => j === i ? e.target.checked : v))} />
                {text}
              </label>
            ))}
            <div>
              <button type="button" disabled={!allChecked || busy} onClick={() => void handle()}
                style={{
                  background: allChecked ? "#b91c1c" : "#e5e7eb",
                  color: allChecked ? "#fff" : "#9ca3af",
                  border: "none", padding: "5px 12px", fontSize: 13, fontWeight: 600,
                  cursor: allChecked ? "pointer" : "not-allowed",
                }}>
                {busy ? "Working…" : actionLabel}
              </button>
            </div>
          </div>
        )}
    </div>
  );
}



