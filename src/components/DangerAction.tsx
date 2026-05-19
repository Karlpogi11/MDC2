import { useState } from "react";

/**
 * DangerAction — inline confirm pattern for destructive actions.
 * Shows label + description, expands to confirm on first click.
 */
export function DangerAction({
  label,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  busy = false,
}: {
  label: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        style={{
          border: "1px solid #fecaca", background: "#fff", color: "#b91c1c",
          padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      border: "1px solid #fecaca", background: "#fef2f2", padding: "6px 10px",
    }}>
      {description && <span style={{ fontSize: 12, color: "#b91c1c" }}>{description}</span>}
      <button type="button" onClick={() => { setConfirming(false); onConfirm(); }} disabled={busy}
        style={{ border: "none", background: "#b91c1c", color: "#fff", padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        {busy ? "…" : confirmLabel}
      </button>
      <button type="button" onClick={() => setConfirming(false)}
        style={{ border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
        Cancel
      </button>
    </div>
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
    <div style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: "var(--radius)", padding: 16 }}>
      <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>⚠ {title}</p>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7a8d" }}>{description}</p>

      {done
        ? <p style={{ margin: 0, fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ {successMessage}</p>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {error && <p style={{ margin: 0, fontSize: 12, color: "#b91c1c" }}>{error}</p>}
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
                  border: "none", padding: "8px 18px", fontSize: 13, fontWeight: 600,
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
