import { useState, useEffect, type FormEvent } from "react";
import { Plus, Save, Check, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { CSVDropZone } from "@/components/CSVDropZone";
import { ImportResult } from "@/components/ImportResult";
import { PartNumberInput } from "@/components/PartNumberInput";

type Part = {
  id: string;
  part_number: string;
  part_name: string;
  category: string | null;
  average_cost: number;
  is_active: boolean;
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
  boxSizing: "border-box", fontFamily: "inherit", background: "#fff",
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
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);

  async function load() {
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client.from("parts").select("*").order("part_name");
    setParts((data ?? []) as Part[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleImport(file: File) {
    setImporting(true); setImportResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const client = getSupabaseClient();
    if (!client || rows.length === 0) { setImporting(false); return; }
    const { data, error } = await client.rpc("batch_upsert_parts", { p_rows: rows });
    if (error) {
      setImportResult({ added: 0, skipped: 0, errors: [error.message] });
    } else {
      const result = data as { error_count: number; errors: { pn: string; reason: string }[] };
      const errCount = result.error_count ?? 0;
      setImportResult({ added: rows.length - errCount, skipped: 0, errors: (result.errors ?? []).map((e) => `${e.pn}: ${e.reason}`) });
    }
    setImporting(false);
    void load();
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null); setAdding(true);
    const client = getSupabaseClient();
    if (!client) { setAddError("Not configured."); setAdding(false); return; }
    const { error } = await client.from("parts").insert({
      part_number: pn.trim(), part_name: name.trim(),
      category: category.trim() || null, average_cost: parseFloat(cost) || 0,
    });
    if (error) { setAddError(error.message); setAdding(false); return; }
    setPn(""); setName(""); setCategory(""); setCost("");
    setAddSuccess(true); setTimeout(() => setAddSuccess(false), 2000);
    setAdding(false); void load();
  }

  async function handleSaveEdit(id: string) {
    setSaving(true);
    const client = getSupabaseClient();
    if (!client) { setSaving(false); return; }
    await client.from("parts").update({
      part_name: editName.trim(), category: editCategory.trim() || null,
      average_cost: parseFloat(editCost) || 0,
    }).eq("id", id);
    setSaving(false); setEditId(null); void load();
  }

  async function toggleActive(part: Part) {
    const client = getSupabaseClient();
    if (!client) return;
    await client.from("parts").update({ is_active: !part.is_active }).eq("id", part.id);
    void load();
  }

  function startEdit(part: Part) {
    setEditId(part.id); setEditName(part.part_name);
    setEditCategory(part.category ?? ""); setEditCost(String(part.average_cost));
  }

  const filtered = parts.filter((p) =>
    !search || p.part_number.toLowerCase().includes(search.toLowerCase()) ||
    p.part_name.toLowerCase().includes(search.toLowerCase())
  );

  const addInputStyle: React.CSSProperties = {
    border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "8px 10px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit",
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <CSVDropZone onFile={(f) => void handleImport(f)} onTemplate={downloadPartsTemplate} importing={importing} />
      {importResult && <ImportResult added={importResult.added} skipped={importResult.skipped} errors={importResult.errors} />}

      {/* Add form */}
      <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #d0d0d0", background: "#f2f2f2", display: "flex", alignItems: "center", gap: 8 }}>
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
                  if (part) { setName(part.part_name); setCategory(part.category ?? ""); }
                }}
                required
                style={{ padding: "8px 10px", fontSize: 13 }}
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
          {addError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "#b91c1c" }}>{addError}</p>}
          <button type="submit" disabled={adding}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: addSuccess ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
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
            style={{ border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 12, outline: "none", width: 220, fontFamily: "inherit" }} />
        </div>
        <div className="table-scroll">
          <table style={{ tableLayout: "fixed", minWidth: 800 }}>
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: "auto" }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 150 }} />
            </colgroup>
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
                  <tr key={part.id} style={{ opacity: part.is_active ? 1 : 0.5, background: isEditing ? "#f0f9ff" : undefined }}>
                    <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {part.part_number}
                    </td>
                    <td title={part.part_name} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing
                        ? <input value={editName} onChange={(e) => setEditName(e.target.value)} style={fieldStyle} />
                        : part.part_name}
                    </td>
                    <td title={part.category ?? ""} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing
                        ? <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} style={fieldStyle} />
                        : part.category ?? <span style={{ color: "#aaa" }}>—</span>}
                    </td>
                    <td className="num">
                      {isEditing
                        ? <input type="number" value={editCost} onChange={(e) => setEditCost(e.target.value)} style={{ ...fieldStyle, textAlign: "right" }} />
                        : part.average_cost > 0 ? `$${part.average_cost}` : <span style={{ color: "#aaa" }}>—</span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                        background: part.is_active ? "#dcfce7" : "#f3f4f6",
                        color: part.is_active ? "#15803d" : "#9ca3af" }}>
                        {part.is_active ? "Active" : "Inactive"}
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
                              style={{ border: "1px solid #d0d0d0", background: "#fff", borderRadius: "var(--radius)", padding: "4px 8px", fontSize: 12, cursor: "pointer", color: "#666" }}>
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(part)}
                              style={{ border: "1px solid #d0d0d0", background: "#fff", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#444", cursor: "pointer" }}>
                              Edit
                            </button>
                            <button type="button" onClick={() => void toggleActive(part)}
                              style={{ border: "1px solid #d0d0d0", background: "#fff", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                                color: part.is_active ? "#b91c1c" : "#15803d" }}>
                              {part.is_active ? "Disable" : "Enable"}
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
