import { friendlyError } from "@/lib/friendlyError";
import { useState, useEffect, type FormEvent } from "react";
import { Plus, Save, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useTableResize } from "@/components/ResizableColumns";
import { CSVDropZone } from "@/components/CSVDropZone";
import { ImportResult } from "@/components/ImportResult";
import { PartNumberInput } from "@/components/PartNumberInput";

type Part = {
  id: string;
  partNumber: string;
  partName: string;
  category: string | null;
  averageCost: number;
  isActive: boolean;
};

const PARTS_TEMPLATE = "part_number,part_name,category,average_cost\n923-03861,Display Assembly - iPhone 14 Pro,Display,\n661-18041,Battery - iPad 10th Gen,Battery,";

function downloadPartsTemplate() {
  const blob = new Blob([PARTS_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "mdc-parts-template.csv"; a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const firstLine = lines[0];
  const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  function splitLine(line: string): string[] {
    const result: string[] = []; let cur = ""; let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === delim && !inQuote) { result.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    result.push(cur.trim()); return result;
  }
  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

const fieldStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #93c5fd", borderRadius: "var(--radius-sm)",
  padding: "3px 7px", fontSize: 12, outline: "none",
  boxSizing: "border-box", fontFamily: "inherit", background: "var(--bg-surface)",
};

export function PartsTab() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pn, setPn] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [cost, setCost] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editCost, setEditCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; updated?: number; skipped: number; errors: string[] } | null>(null);

  const [csvRows, setCsvRows] = useState<Record<string, string>[] | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [importMode, setImportMode] = useState<"merge" | "deactivate_unlisted" | "replace_all">("merge");

  async function load() {
    const data: any[] = (await api.get("/parts?is_active=all")) ?? [];
    const parsed = data.map((p: any) => ({
      ...p,
      averageCost: typeof p.averageCost === "string" ? parseFloat(p.averageCost) : (p.averageCost ?? 0),
    }));
    setParts(parsed);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleImport(file: File) {
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    // Auto-guess mapping
    const guess = (hints: string[]) => headers.find((h) => hints.some((hint) => h.includes(hint))) ?? "";
    setCsvRows(rows);
    setCsvHeaders(headers);
    setColMap({
      partNumber: guess(["part_number", "part_no", "partno", "number"]),
      partName:   guess(["part_name", "name", "description", "desc"]),
      category:    guess(["cat"]),
      averageCost: guess(["cost", "price"]),
    });
    setImportResult(null);
  }

  async function handleConfirmImport() {
    if (!csvRows || !colMap.partNumber || !colMap.partName) return;
    setImporting(true);

    const valid = csvRows
      .filter((r) => r[colMap.partNumber]?.trim() && r[colMap.partName]?.trim())
      .map((r) => ({
        partNumber:  r[colMap.partNumber].trim(),
        partName:    r[colMap.partName].trim(),
        category:     colMap.category ? r[colMap.category]?.trim() || null : null,
        averageCost: colMap.averageCost ? parseFloat(r[colMap.averageCost]) || 0 : 0,
        part_type:    "product",
      }));

    try {
      const result = await api.post("/parts/import", { rows: valid, mode: importMode });
      setImportResult({
        added: result.added ?? 0,
        updated: result.updated ?? 0,
        skipped: csvRows.length - valid.length,
        errors: result.errors ?? [],
      });
    } catch (err: any) {
      setImportResult({ added: 0, updated: 0, skipped: csvRows.length - valid.length, errors: [friendlyError(err)] });
    }
    setCsvRows(null);
    setImporting(false);
    void load();
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null); setAdding(true);
    try {
      await api.post("/parts", {
        partNumber: pn.trim(), partName: name.trim(),
        category: category.trim() || null, averageCost: parseFloat(cost) || 0,
      });
      setPn(""); setName(""); setCategory(""); setCost("");
      setAddSuccess(true); setTimeout(() => setAddSuccess(false), 2000);
    } catch (err: any) {
      setAddError(friendlyError(err));
    }
    setAdding(false); void load();
  }

  async function handleSaveEdit(id: string) {
    setSaving(true);
    await api.put("/parts/" + id, {
      partName: editName.trim(), category: editCategory.trim() || null,
      averageCost: parseFloat(editCost) || 0,
    });
    setSaving(false); setEditId(null); void load();
  }

  async function toggleActive(part: Part) {
    await api.put("/parts/" + part.id, { isActive: !part.isActive });
    void load();
  }

  function startEdit(part: Part) {
    setEditId(part.id); setEditName(part.partName);
    setEditCategory(part.category ?? ""); setEditCost(String(part.averageCost));
  }

  const tableRef = useTableResize();
  const filtered = parts.filter((p) =>
    !search || p.partNumber.toLowerCase().includes(search.toLowerCase()) ||
    p.partName.toLowerCase().includes(search.toLowerCase())
  );

  const addInputStyle: React.CSSProperties = {
    border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit",
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <CSVDropZone onFile={(f) => void handleImport(f)} onTemplate={downloadPartsTemplate} importing={importing} />

      {/* Column mapping */}
      {csvRows && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 16 }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "#111" }}>
            Map columns — {csvRows.length} rows detected
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            {([
              { field: "part_number", label: "Part number *" },
              { field: "part_name",   label: "Part name *" },
              { field: "category",    label: "Category" },
              { field: "average_cost",label: "Avg cost" },
            ] as const).map(({ field, label }) => (
              <div key={field}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</label>
                <select
                  value={colMap[field] ?? ""}
                  onChange={(e) => setColMap((m) => ({ ...m, [field]: e.target.value }))}
                  style={{ width: "100%", border: "1px solid var(--line)", padding: "5px 8px", fontSize: 13, background: "var(--bg-surface)", outline: "none" }}
                >
                  <option value="">— skip —</option>
                  {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {/* Preview table — shows exactly what will be imported */}
          {colMap.partNumber && colMap.partName && (
            <div style={{ marginBottom: 12, border: "1px solid var(--line)", overflow: "auto", maxHeight: 220 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--bg-surface-elevated)", position: "sticky", top: 0 }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid #e5e7eb" }}>Part number</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid #e5e7eb" }}>Part name</th>
                    {colMap.category && <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid #e5e7eb" }}>Category</th>}
                  </tr>
                </thead>
                <tbody>
                  {csvRows.filter(r => r[colMap.partNumber]?.trim() && r[colMap.partName]?.trim()).slice(0, 10).map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                      <td style={{ padding: "5px 10px", fontFamily: "monospace", color: "var(--blue)" }}>{r[colMap.partNumber]}</td>
                      <td style={{ padding: "5px 10px", color: "#111" }}>{r[colMap.partName]}</td>
                      {colMap.category && <td style={{ padding: "5px 10px", color: "var(--muted)" }}>{r[colMap.category] || "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--line-soft)" }}>
                Showing first 10 of {csvRows.filter(r => r[colMap.partNumber]?.trim() && r[colMap.partName]?.trim()).length} valid rows
                {csvRows.length - csvRows.filter(r => r[colMap.partNumber]?.trim() && r[colMap.partName]?.trim()).length > 0 &&
                  <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                    · {csvRows.length - csvRows.filter(r => r[colMap.partNumber]?.trim() && r[colMap.partName]?.trim()).length} rows will be skipped (empty part number or name)
                  </span>
                }
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {([
              { value: "merge",               label: "Merge — add new, update existing, keep unlisted",                                    danger: false },
              { value: "deactivate_unlisted", label: "Deactivate unlisted — same as merge but hides parts not in this file",               danger: false },
              { value: "replace_all",         label: "Replace all — delete every existing part and re-import from scratch",                danger: true  },
            ] as const).map(({ value, label, danger }) => (
              <label key={value} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: danger ? "#b91c1c" : "#374151", cursor: "pointer" }}>
                <input type="radio" name="importMode" value={value} checked={importMode === value} onChange={() => setImportMode(value)} />
                {label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void handleConfirmImport()}
              disabled={importing || !colMap.partNumber || !colMap.partName}
              style={{ background: "var(--blue)", color: "#fff", border: "none", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (!colMap.partNumber || !colMap.partName) ? 0.5 : 1 }}>
              {importing ? "Importing…" : `Import ${csvRows.filter(r => r[colMap.partNumber]?.trim() && r[colMap.partName]?.trim()).length} rows`}
            </button>
            <button type="button" onClick={() => setCsvRows(null)}
              style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", padding: "5px 10px", fontSize: 13, color: "#666", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {importResult && <ImportResult added={importResult.added} updated={importResult.updated} skipped={importResult.skipped} errors={importResult.errors} />}

      {/* Add form */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #d0d0d0", background: "var(--bg-surface-elevated)", display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={15} color="var(--blue)" />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#444" }}>Add part</h3>
        </div>
        <form onSubmit={(e) => void handleAdd(e)} style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Part number *</label>
              <PartNumberInput
                value={pn}
                onChange={(v, part) => {
                  setPn(v);
                  if (part) { setName(part.partName); setCategory(part.category ?? ""); }
                }}
                required
                style={{ padding: "5px 8px", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Description *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} style={addInputStyle} placeholder="Display Assembly - iPhone 14 Pro" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} style={addInputStyle} placeholder="Display" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Avg cost</label>
              <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} style={addInputStyle} placeholder="0.00" />
            </div>
          </div>
          {addError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--negative)" }}>{addError}</p>}
          <button type="submit" disabled={adding}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: addSuccess ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {addSuccess ? <><Check size={14} /> Saved</> : adding ? "Saving…" : <><Plus size={14} /> Add part</>}
          </button>
        </form>
      </div>

      {/* Parts table */}
      <div className="table-card">
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>
            Parts {!loading && <span style={{ fontWeight: 400, color: "#888" }}>({filtered.length})</span>}
          </span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search part no. or name…"
            style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 12, outline: "none", width: 220, fontFamily: "inherit" }} />
        </div>
        <div className="table-scroll">
          <table ref={tableRef}>
            <thead>
              <tr>
                <th>Part number</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Avg cost</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="empty-row">Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="empty-row">No parts found.</td></tr>}
              {filtered.map((part) => {
                const isEditing = editId === part.id;
                return (
                  <tr key={part.id} style={{ opacity: part.isActive ? 1 : 0.5, background: isEditing ? "#f0f9ff" : undefined }}>
                    <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {part.partNumber}
                    </td>
                    <td title={part.partName} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing
                        ? <input value={editName} onChange={(e) => setEditName(e.target.value)} style={fieldStyle} />
                        : part.partName}
                    </td>
                    <td title={part.category ?? ""} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing
                        ? <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} style={fieldStyle} />
                        : part.category ?? <span style={{ color: "#aaa" }}>—</span>}
                    </td>
                    <td className="num">
                      {isEditing
                        ? <input type="number" value={editCost} onChange={(e) => setEditCost(e.target.value)} style={{ ...fieldStyle, textAlign: "right" }} />
                        : part.averageCost > 0 ? `$${part.averageCost}` : <span style={{ color: "#aaa" }}>—</span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                        background: part.isActive ? "#dcfce7" : "#f3f4f6",
                        color: part.isActive ? "#15803d" : "#9ca3af" }}>
                        {part.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {isEditing ? (
                          <>
                            <button type="button" onClick={() => void handleSaveEdit(part.id)} disabled={saving}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "var(--blue)", color: "#fff", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                              <Save size={12} /> {saving ? "…" : "Save"}
                            </button>
                            <button type="button" onClick={() => setEditId(null)}
                              style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "4px 8px", fontSize: 12, cursor: "pointer", color: "#666" }}>
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(part)}
                              style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#444", cursor: "pointer" }}>
                              Edit
                            </button>
                            <button type="button" onClick={() => void toggleActive(part)}
                              style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                                color: part.isActive ? "#b91c1c" : "#15803d" }}>
                              {part.isActive ? "Disable" : "Enable"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>


    </div>
  );
}




