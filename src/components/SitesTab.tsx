import { useState, useEffect, type FormEvent } from "react";
import { Plus, Check, Save, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { CSVDropZone } from "@/components/CSVDropZone";
import { ImportResult } from "@/components/ImportResult";

type Site = {
  id: string;
  site_code: string;
  site_name: string;
  is_dc: boolean;
  is_active: boolean;
  invoice_prefix: string | null;
  address: string | null;
};

const SITES_TEMPLATE = "site_code,site_name,is_dc,invoice_prefix,address\nDC-MNL,Main Distribution Center,true,,123 DC Street Manila\nPODIUM,Podium Site,false,PODSSR#,\"Podium Mall, Ortigas Center\"\nBGC-01,BGC Service Center,false,BGCSSR#,\"BGC High Street, Taguig\"";

function downloadSitesTemplate() {
  const blob = new Blob([SITES_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "mdc-sites-template.csv"; a.click();
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

export function SitesTab() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isDC, setIsDC] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrefix, setEditPrefix] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editIsDC, setEditIsDC] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  async function load() {
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client.from("sites").select("*").order("site_name");
    setSites((data ?? []) as Site[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleImport(file: File) {
    setImporting(true); setImportResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const client = getSupabaseClient();
    if (!client || rows.length === 0) { setImporting(false); return; }
    const { data, error } = await client.rpc("batch_upsert_sites", { p_rows: rows });
    if (error) {
      setImportResult({ added: 0, skipped: 0, errors: [error.message] });
    } else {
      const result = data as { error_count: number; errors: { code: string; reason: string }[] };
      const errCount = result.error_count ?? 0;
      setImportResult({ added: rows.length - errCount, skipped: 0, errors: (result.errors ?? []).map((e) => `${e.code}: ${e.reason}`) });
    }
    setImporting(false); void load();
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null); setAdding(true);
    const client = getSupabaseClient();
    if (!client) { setAddError("Not configured."); setAdding(false); return; }
    const { error } = await client.from("sites").insert({
      site_code: code.trim().toUpperCase(), site_name: name.trim(),
      is_dc: isDC, invoice_prefix: prefix.trim() || null, address: address.trim() || null,
    });
    if (error) { setAddError(error.message); setAdding(false); return; }
    setCode(""); setName(""); setIsDC(false); setPrefix(""); setAddress("");
    setAddSuccess(true); setTimeout(() => setAddSuccess(false), 2000);
    setAdding(false); void load();
  }

  function startEdit(site: Site) {
    setEditId(site.id); setEditName(site.site_name);
    setEditPrefix(site.invoice_prefix ?? ""); setEditAddress(site.address ?? "");
    setEditIsDC(site.is_dc);
  }

  async function handleSaveEdit(id: string) {
    setEditSaving(true);
    const client = getSupabaseClient();
    if (!client) { setEditSaving(false); return; }
    await client.from("sites").update({
      site_name: editName.trim(), invoice_prefix: editPrefix.trim() || null,
      address: editAddress.trim() || null, is_dc: editIsDC,
    }).eq("id", id);
    setEditSaving(false); setEditId(null); void load();
  }

  async function toggleActive(site: Site) {
    const client = getSupabaseClient();
    if (!client) return;
    await client.from("sites").update({ is_active: !site.is_active }).eq("id", site.id);
    void load();
  }

  const addInputStyle: React.CSSProperties = {
    border: "1px solid #d0d0d0", borderRadius: "var(--radius)", padding: "8px 10px",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit",
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <CSVDropZone onFile={(f) => void handleImport(f)} onTemplate={downloadSitesTemplate} importing={importing} />
      {importResult && <ImportResult added={importResult.added} skipped={importResult.skipped} errors={importResult.errors} />}

      {/* Add form */}
      <div style={{ background: "#fff", border: "1px solid #d0d0d0", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #d0d0d0", background: "#f2f2f2", display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={15} color="var(--blue)" />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#444" }}>Add site</h3>
        </div>
        <form onSubmit={(e) => void handleAdd(e)} style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 140px auto", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Site code *</label>
              <input required value={code} onChange={(e) => setCode(e.target.value)} style={addInputStyle} placeholder="DC-MNL" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Site name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} style={addInputStyle} placeholder="Main Distribution Center" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Invoice prefix</label>
              <input value={prefix} onChange={(e) => setPrefix(e.target.value)} style={addInputStyle} placeholder="e.g. PODSSR#" />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#444", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={isDC} onChange={(e) => setIsDC(e.target.checked)} style={{ width: 15, height: 15 }} />
                Is DC
              </label>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} style={addInputStyle} placeholder="Full address for packing list" />
          </div>
          {addError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "#b91c1c" }}>{addError}</p>}
          <button type="submit" disabled={adding}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: addSuccess ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {addSuccess ? <><Check size={14} /> Saved</> : adding ? "Saving…" : <><Plus size={14} /> Add site</>}
          </button>
        </form>
      </div>

      {/* Sites table */}
      <div className="table-card">
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #d0d0d0" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>
            Sites {!loading && <span style={{ fontWeight: 400, color: "#888" }}>({sites.length})</span>}
          </span>
        </div>
        <div className="table-scroll">
          <table style={{ tableLayout: "fixed", minWidth: 960 }}>
            <colgroup>
              <col style={{ width: 110 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 150 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Invoice Prefix</th>
                <th>Address</th>
                <th>Type</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="empty-row">Loading…</td></tr>}
              {!loading && sites.length === 0 && <tr><td colSpan={7} className="empty-row">No sites yet.</td></tr>}
              {sites.map((site) => {
                const isEditing = editId === site.id;
                return (
                  <tr key={site.id} style={{ opacity: site.is_active ? 1 : 0.5, background: isEditing ? "#f0f9ff" : undefined }}>
                    <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {site.site_code}
                    </td>
                    <td title={site.site_name} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing
                        ? <input value={editName} onChange={(e) => setEditName(e.target.value)} style={fieldStyle} />
                        : <strong>{site.site_name}</strong>}
                    </td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing
                        ? <input value={editPrefix} onChange={(e) => setEditPrefix(e.target.value)} placeholder="e.g. PODSSR#" style={{ ...fieldStyle, fontFamily: "monospace" }} />
                        : site.invoice_prefix
                          ? <code style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "var(--radius-sm)", padding: "2px 7px", fontSize: 12 }}>{site.invoice_prefix}</code>
                          : <span style={{ color: "#aaa" }}>—</span>}
                    </td>
                    <td title={site.address ?? ""} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing
                        ? <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="Full address" style={fieldStyle} />
                        : site.address ?? <span style={{ color: "#aaa" }}>—</span>}
                    </td>
                    <td>
                      {isEditing
                        ? <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#444" }}>
                            <input type="checkbox" checked={editIsDC} onChange={(e) => setEditIsDC(e.target.checked)} style={{ width: 13, height: 13 }} />
                            DC
                          </label>
                        : <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                            background: site.is_dc ? "#dbeafe" : "#f3f4f6",
                            color: site.is_dc ? "#1d4ed8" : "#6b7a8d" }}>
                            {site.is_dc ? "DC" : "Dest."}
                          </span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                        background: site.is_active ? "#dcfce7" : "#f3f4f6",
                        color: site.is_active ? "#15803d" : "#9ca3af" }}>
                        {site.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {isEditing ? (
                          <>
                            <button type="button" onClick={() => void handleSaveEdit(site.id)} disabled={editSaving}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "var(--blue)", color: "#fff", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                              <Save size={12} /> {editSaving ? "…" : "Save"}
                            </button>
                            <button type="button" onClick={() => setEditId(null)}
                              style={{ border: "1px solid #d0d0d0", background: "#fff", borderRadius: "var(--radius)", padding: "4px 8px", fontSize: 12, cursor: "pointer", color: "#666" }}>
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(site)}
                              style={{ border: "1px solid #d0d0d0", background: "#fff", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#444", cursor: "pointer" }}>
                              Edit
                            </button>
                            <button type="button" onClick={() => void toggleActive(site)}
                              style={{ border: "1px solid #d0d0d0", background: "#fff", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                                color: site.is_active ? "#b91c1c" : "#15803d" }}>
                              {site.is_active ? "Disable" : "Enable"}
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
