import { useState } from "react";
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

type Props = {
  added: number;
  skipped: number;
  errors: string[];
};

const MAX_VISIBLE = 5;

export function ImportResult({ added, skipped, errors }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = errors.length > 0;
  const visibleErrors = expanded ? errors : errors.slice(0, MAX_VISIBLE);
  const hiddenCount = errors.length - MAX_VISIBLE;

  return (
    <div style={{
      padding: "10px 14px",
      background: hasErrors ? "#fef2f2" : "#f0fdf4",
      border: `1px solid ${hasErrors ? "#fecaca" : "#bbf7d0"}`,
      borderRadius: "var(--radius)", fontSize: 13,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: hasErrors ? 8 : 0 }}>
        {hasErrors
          ? <AlertCircle size={15} color="#b91c1c" />
          : <CheckCircle size={15} color="#15803d" />}
        <span style={{ fontWeight: 600, color: hasErrors ? "#b91c1c" : "#15803d" }}>
          {added} imported
          {skipped > 0 && `, ${skipped} skipped`}
          {hasErrors && `, ${errors.length} error${errors.length > 1 ? "s" : ""}`}
        </span>
      </div>

      {hasErrors && (
        <div>
          {visibleErrors.map((e, i) => (
            <div key={i} style={{ color: "#991b1b", fontSize: 12, padding: "2px 0", borderTop: i === 0 ? "1px solid #fecaca" : undefined, marginTop: i === 0 ? 6 : 0 }}>
              {e}
            </div>
          ))}
          {errors.length > MAX_VISIBLE && (
            <button type="button" onClick={() => setExpanded((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, background: "transparent", border: "none", color: "#b91c1c", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
              {expanded
                ? <><ChevronUp size={12} /> Show less</>
                : <><ChevronDown size={12} /> +{hiddenCount} more errors</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
