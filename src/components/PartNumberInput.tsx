import { useState, useEffect, useRef, forwardRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { toCapitalized } from "@/lib/format";

type Part = { id: string; partNumber: string; partName: string; category: string | null };

type Props = {
  value: string;
  onChange: (partNumber: string, part?: Part) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  required?: boolean;
  disabled?: boolean;
};

export const PartNumberInput = forwardRef<HTMLInputElement, Props>(
function PartNumberInput({ value, onChange, placeholder = "e.g. 923-03861", style, required, disabled }, ref) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Part[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justSelected = useRef(false);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    if (justSelected.current) { justSelected.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) { setSuggestions([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      const data: Part[] = await api.get("/parts/search?q=" + encodeURIComponent(query));

      // Sort: exact prefix on part_number first, then contains
      const q = query.toLowerCase();
      const sorted = (data ?? []).sort((a, b) => {
        const aPrefix = a.partNumber.toLowerCase().startsWith(q) ? 0 : 1;
        const bPrefix = b.partNumber.toLowerCase().startsWith(q) ? 0 : 1;
        return aPrefix - bPrefix || a.partNumber.localeCompare(b.partNumber);
      }).slice(0, 10);
      setSuggestions(sorted);
      if (sorted.length > 0) {
        // Position dropdown below the input
        const rect = inputRef.current?.getBoundingClientRect();
        if (rect) setDropdownPos({ top: rect.bottom + window.scrollY + 2, left: rect.left + window.scrollX, width: Math.max(rect.width, 320) });
        setOpen(true);
      } else {
        setOpen(false);
      }
      setActiveIdx(0);
    }, 200);
  }, [query]);

  function select(part: Part) {
    justSelected.current = true;
    setQuery(part.partNumber);
    setSuggestions([]);
    setOpen(false);
    onChange(part.partNumber, part);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && suggestions[activeIdx]) { e.preventDefault(); select(suggestions[activeIdx]); }
    if (e.key === "Escape") { setOpen(false); }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!inputRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const baseStyle: React.CSSProperties = {
    border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
    fontFamily: "monospace", background: "var(--bg-surface)",
    color: "var(--text)",
    ...style,
  };

  const dropdown = open && suggestions.length > 0 && createPortal(
    <div style={{
      position: "absolute",
      top: dropdownPos.top,
      left: dropdownPos.left,
      width: dropdownPos.width,
      zIndex: 9999,
      background: "var(--bg-surface)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
      overflow: "hidden",
      maxHeight: 240,
      overflowY: "auto",
    }}>
      {suggestions.map((part, i) => (
        <div
          key={part.id}
          onMouseDown={(e) => { e.preventDefault(); select(part); }}
          style={{
            padding: "6px 10px", cursor: "pointer", fontSize: 12,
            background: i === activeIdx ? "var(--accent-glow)" : "transparent",
            borderBottom: i < suggestions.length - 1 ? "1px solid var(--line-soft)" : undefined,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ fontWeight: 600, color: "var(--blue)", flexShrink: 0 }}>{part.partNumber}</code>
            {part.category && <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>{toCapitalized(part.category)}</span>}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 1 }}>{part.partName}</div>
        </div>
      ))}
    </div>,
    document.body
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={(node) => {
          (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }}
        type="text"
        value={query}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        style={baseStyle}
        autoComplete="off"
      />
      {dropdown}
    </div>
  );
});




