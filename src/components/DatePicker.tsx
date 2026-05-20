import { Calendar } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
};

export function DatePicker({ value, onChange, placeholder = "Select date", label }: Props) {
  return (
    <div>
      {label && (
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {label}
        </label>
      )}
      <div style={{ position: "relative", display: "inline-block" }}>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            padding: "7px 32px 7px 10px",
            fontSize: 13,
            fontFamily: "inherit",
            background: "#fff",
            outline: "none",
            width: 148,
            cursor: "pointer",
            color: value ? "#0f172a" : "#94a3b8",
            height: 34,
            boxSizing: "border-box",
            appearance: "none",
          }}
          placeholder={placeholder}
        />
        <Calendar
          size={14}
          color="#9ca3af"
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}
