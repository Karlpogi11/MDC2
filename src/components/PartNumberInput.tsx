import { useState, useEffect, useRef, forwardRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";
import { toCapitalized } from "@/lib/format";

type Part = { id: string; part_number: string; part_name: string; category: string | null };

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
      const client = getSupabaseClient();
      if (!client) return;
      const { data } = await client
        .from("parts")
        .select("id,part_number,part_name,category")
        .or(`part_number.ilike.%${query}%,part_name.ilike.%${query}%`)
        .eq("is_active", true)
        .order("part_number")
        .limit(20);

      // Sort: exact prefix on part_number first, then contains
      const q = query.toLowerCase();
      const sorted = ((data ?? []) as Part[]).sort((a, b) => {
        const aPrefix = a.part_number.toLowerCase().startsWith(q) ? 0 : 1;
        const bPrefix = b.part_number.toLowerCase().startsWith(q) ? 0 : 1;
        return aPrefix - bPrefix || a.part_number.localeCompare(b.part_number);
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
    setQuery(part.part_number);
    setSuggestions([]);
    setOpen(false);
    onChange(part.part_number, part);
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
    border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
    fontFamily: "monospace", background: disabled ? "#f9fafb" : "#fff",
    color: disabled ? "#6b7a8d" : undefined,
    ...style,
  };

  const dropdown = open && suggestions.length > 0 && createPortal(
    <div style={{
      position: "absolute",
      top: dropdownPos.top,
      left: dropdownPos.left,
      width: dropdownPos.width,
      zIndex: 9999,
      background: "#fff",
      border: "1px solid #d0d0d0",
      borderRadius: "var(--radius)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
      overflow: "hidden",
      maxHeight: 280,
      overflowY: "auto",
    }}>
      {suggestions.map((part, i) => (
        <div
          key={part.id}
          onMouseDown={(e) => { e.preventDefault(); select(part); }}
          style={{
            padding: "8px 12px", cursor: "pointer", fontSize: 12,
            background: i === activeIdx ? "#eff6ff" : "#fff",
            borderBottom: i < suggestions.length - 1 ? "1px solid #f3f4f6" : undefined,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ fontWeight: 700, color: "var(--blue)", flexShrink: 0 }}>{part.part_number}</code>
            {part.category && <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>{toCapitalized(part.category)}</span>}
          </div>
          <div style={{ color: "#374151", marginTop: 2 }}>{part.part_name}</div>
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
