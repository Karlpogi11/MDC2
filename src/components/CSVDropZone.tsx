import { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import { ArrowUp, Download } from "lucide-react";

type Props = {
  onFile: (file: File) => void;
  onTemplate: () => void;
  importing: boolean;
  label?: string;
};

export function CSVDropZone({ onFile, onTemplate, importing, label = "Import CSV" }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  function handleInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { onFile(file); e.target.value = ""; }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !importing && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--blue)" : "var(--line)"}`,
          borderRadius: "var(--radius)", padding: "20px 16px", textAlign: "center",
          cursor: importing ? "not-allowed" : "pointer",
          background: dragging ? "var(--accent-glow)" : "var(--bg-surface-elevated)",
          transition: "all 150ms",
        }}
      >
        <ArrowUp size={22} color={dragging ? "var(--blue)" : "var(--muted)"} style={{ marginBottom: 8 }} />
        <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {importing ? "Importing…" : "Drop CSV here or click to browse"}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Only .csv files</p>
        <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleInput} disabled={importing} />
      </div>

      {/* Template link */}
      <button type="button" onClick={onTemplate}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "none", color: "var(--blue)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, alignSelf: "flex-start" }}>
        <Download size={12} /> Download template
      </button>
    </div>
  );
}


