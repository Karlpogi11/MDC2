import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type Part = { id: string; part_number: string; part_name: string; category: string | null };

type Props = {
  value: string;
  onChange: (partNumber: string, part?: Part) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  required?: boolean;
};

export function PartNumberInput({ value, onChange, placeholder = "e.g. 923-03861", style, required }: Props) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Part[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
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
        .limit(8);
      setSuggestions((data ?? []) as Part[]);
      setOpen((data ?? []).length > 0);
      setActiveIdx(0);
    }, 200);
  }, [query]);

  function select(part: Part) {
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

  function handleChange(v: string) {
    setQuery(v);
    onChange(v);
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const baseStyle: React.CSSProperties = {
    border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "8px 10px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
    fontFamily: "monospace", background: "#fff",
    ...style,
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        required={required}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        style={baseStyle}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)", marginTop: 2, overflow: "hidden",
        }}>
          {suggestions.map((part, i) => (
            <div
              key={part.id}
              onMouseDown={() => select(part)}
              style={{
                padding: "8px 12px", cursor: "pointer", fontSize: 12,
                background: i === activeIdx ? "#eff6ff" : "#fff",
                borderBottom: i < suggestions.length - 1 ? "1px solid #f3f4f6" : undefined,
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <code style={{ fontWeight: 700, color: "var(--blue)", minWidth: 110, fontSize: 12 }}>{part.part_number}</code>
              <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{part.part_name}</span>
              {part.category && <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 11, whiteSpace: "nowrap" }}>{part.category}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
