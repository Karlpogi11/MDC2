import ReactDatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Calendar } from "lucide-react";

type Props = {
  value: string;           // ISO date string "YYYY-MM-DD" or ""
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  popperPlacement?:
    | "top"
    | "top-start"
    | "top-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "right"
    | "right-start"
    | "right-end"
    | "left"
    | "left-start"
    | "left-end";
  popperClassName?: string;
};

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  label,
  popperPlacement = "bottom-start",
  popperClassName,
}: Props) {
  const selected = value ? new Date(value + "T00:00:00") : null;

  return (
    <div>
      {label && (
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {label}
        </label>
      )}
      <div style={{ position: "relative", display: "inline-block" }}>
        <ReactDatePicker
          selected={selected}
          onChange={(date) => onChange(date ? date.toISOString().slice(0, 10) : "")}
          placeholderText={placeholder}
          dateFormat="MMM dd, yyyy"
          isClearable
          showPopperArrow={false}
          popperPlacement={popperPlacement}
          popperClassName={popperClassName}
          customInput={
            <input
              readOnly
              style={{
                border: "1px solid #d0d0d0",
                padding: "8px 32px 8px 10px",
                fontSize: 13,
                fontFamily: "inherit",
                background: "#fff",
                outline: "none",
                width: 148,
                cursor: "pointer",
                color: selected ? "#111" : "#9ca3af",
              }}
            />
          }
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
