import { useState, useRef, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Download, CheckCircle, XCircle, FileText, X, Plus } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { PartNumberInput } from "@/components/PartNumberInput";

type BatchResult = {
  batchId: string;
  totalRows: number;
  successRows: number;
  failedRows: { row: number; serial: string; reason: string }[];
};

type UploadState =
  | { status: "idle" }
  | { status: "selected"; file: File }
  | { status: "uploading" }
  | { status: "done"; result: BatchResult }
  | { status: "error"; message: string };

const ACCEPTED = [".csv", ".xlsx"];
const MAX_SIZE_MB = 10;

const CSV_TEMPLATE = [
  "serial_number,part_number,notes",
  "SN-000001,923-03861,",
  "SN-000002,661-18041,optional note",
].join("\n");

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mdc-stockin-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function validateFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["csv", "xlsx"].includes(ext)) return "Only .csv and .xlsx files are accepted.";
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `File must be under ${MAX_SIZE_MB}MB.`;
  return null;
}

export function StockInPage() {
  const navigate = useNavigate();
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.user.id : null;

  // --- Bulk upload state ---
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Manual entry state ---
  const [manualSerial, setManualSerial] = useState("");
  const [manualPartNumber, setManualPartNumber] = useState("");
  const [manualPartName, setManualPartName] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualResolving, setManualResolving] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);

  async function resolvePartBySerial(sn: string) {
    if (!sn.trim()) return;
    setManualResolving(true);
    setManualError(null);
    const client = getSupabaseClient();
    if (!client) { setManualResolving(false); return; }

    // Check if serial already exists
    const { data: existing } = await client
      .from("serial_numbers")
      .select("serial_number, status")
      .eq("serial_number", sn.trim())
      .maybeSingle();

    if (existing) {
      const statusLabel: Record<string, string> = {
        in_stock: "In Stock", transit: "In Transit", transferred: "Stocked Out",
        consumed: "Consumed", void: "Void",
      };
      const label = statusLabel[existing.status] ?? existing.status;
      setManualError(`Serial "${sn.trim()}" already exists in inventory (status: ${label}).`);
      setManualResolving(false);
      return;
    }
    setManualResolving(false);
  }

  async function resolvePartByNumber(pn: string) {
    if (!pn.trim()) return;
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client
      .from("parts")
      .select("part_name")
      .eq("part_number", pn.trim())
      .maybeSingle();
    if (data?.part_name) setManualPartName(data.part_name);
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) { setManualError("Not authenticated."); return; }
    if (!manualSerial.trim()) { setManualError("Serial number is required."); return; }
    if (!manualPartNumber.trim()) { setManualError("Part number is required."); return; }

    setManualSubmitting(true);
    setManualError(null);
    setManualSuccess(null);

    const client = getSupabaseClient();
    if (!client) { setManualError("Supabase not configured."); setManualSubmitting(false); return; }

    try {
      // Get or create DC site
      const { data: dcSite } = await client.from("sites").select("id").eq("is_dc", true).single();
      if (!dcSite) throw new Error("DC site not configured. Add a site with is_dc=true.");

      // Resolve part
      let partId: string;
      const { data: existingPart } = await client
        .from("parts").select("id,part_name").eq("part_number", manualPartNumber.trim()).maybeSingle();

      if (existingPart) {
        partId = existingPart.id;
        if (!manualPartName) setManualPartName(existingPart.part_name);
      } else {
        // Auto-create part if not found
        const { data: newPart, error: partErr } = await client
          .from("parts")
          .insert({ part_number: manualPartNumber.trim(), part_name: manualPartName.trim() || manualPartNumber.trim() })
          .select("id").single();
        if (partErr || !newPart) throw new Error(partErr?.message ?? "Failed to create part.");
        partId = newPart.id;
      }

      // Create batch record
      const { data: batch, error: batchErr } = await client
        .from("stock_in_batches")
        .insert({ source_type: "manual", imported_by: actorId, total_rows: 1, success_rows: 1, failed_rows: 0 })
        .select("id").single();
      if (batchErr || !batch) throw new Error(batchErr?.message ?? "Failed to create batch.");

      // Insert serial
      const { data: newSerial, error: serialErr } = await client.from("serial_numbers").insert({
        serial_number: manualSerial.trim(),
        part_id: partId,
        current_site_id: dcSite.id,
        status: "in_stock",
        stock_in_batch_id: batch.id,
      }).select("id").single();
      if (serialErr || !newSerial) throw new Error(serialErr?.message ?? "Failed to insert serial.");

      // Insert stock_in_items so inventory_snapshot picks up this part
      const { error: itemErr } = await client.from("stock_in_items").insert({
        batch_id: batch.id,
        part_id: partId,
        serial_id: newSerial.id,
        quantity: 1,
      });
      if (itemErr) throw new Error(itemErr.message);

      setManualSuccess(`Serial ${manualSerial.trim()} stocked in successfully.`);
      setManualSerial(""); setManualPartNumber(""); setManualPartName(""); setManualNotes("");
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Stock-in failed.");
    }
    setManualSubmitting(false);
  }

  function selectFile(file: File) {
    const err = validateFile(file);
    if (err) { setState({ status: "error", message: err }); return; }
    setState({ status: "selected", file });
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) selectFile(file);
  }

  async function handleUpload() {
    if (state.status !== "selected") return;
    const file = state.file;
    setState({ status: "uploading" });

    const client = getSupabaseClient();
    if (!client) { setState({ status: "error", message: "Supabase not configured." }); return; }

    try {
      // 1. Upload file to storage
      const path = `stockin/${Date.now()}-${file.name}`;
      const { error: uploadError } = await client.storage
        .from("imports-stockin")
        .upload(path, file);

      if (uploadError) throw new Error(uploadError.message);

      // 2. Call Edge Function to parse + import
      const { data, error: fnError } = await client.functions.invoke("import-stockin", {
        body: { filePath: path, fileName: file.name },
      });

      if (fnError) throw new Error(fnError.message);

      setState({ status: "done", result: data as BatchResult });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  function reset() {
    setState({ status: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <AppLayout>
      <main style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>Stock-In Import</h1>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7a8d" }}>
              Upload a CSV or XLSX file to batch-import serials into DC inventory.
            </p>
          </div>
          <button
            type="button"
            onClick={downloadTemplate}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <Download size={14} /> Download template
          </button>
        </div>

        {/* Upload card */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6" }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>Upload file</h2>
          </div>
          <div style={{ padding: 20 }}>

            {/* Drop zone */}
            {(state.status === "idle" || state.status === "error") && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? "var(--blue)" : "#d1d5db"}`,
                  borderRadius: "var(--radius)", padding: "40px 20px", textAlign: "center",
                  cursor: "pointer", background: dragging ? "#eff6ff" : "#fafafa",
                  transition: "all 150ms",
                }}
              >
                <Upload size={28} color="#9ca3af" style={{ marginBottom: 12 }} />
                <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Drop file here or click to browse
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
                  CSV or XLSX · max {MAX_SIZE_MB}MB
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  style={{ display: "none" }}
                  onChange={handleFileInput}
                />
              </div>
            )}

            {/* File selected */}
            {state.status === "selected" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8 }}>
                <FileText size={20} color="#0284c7" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#0c4a6e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {state.file.name}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "#0369a1" }}>
                    {(state.file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button type="button" onClick={reset} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#6b7a8d" }}>
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Uploading */}
            {state.status === "uploading" && (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "var(--blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                <p style={{ margin: 0, fontSize: 14, color: "#374151", fontWeight: 600 }}>Processing import…</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>Validating and inserting rows</p>
              </div>
            )}

            {/* Error */}
            {state.status === "error" && (
              <div role="alert" style={{ marginTop: 12, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <XCircle size={16} />
                {state.message}
              </div>
            )}

            {/* Actions */}
            {(state.status === "selected" || state.status === "error") && (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                {state.status === "selected" && (
                  <button
                    type="button"
                    onClick={() => void handleUpload()}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    <Upload size={14} /> Import now
                  </button>
                )}
                <button type="button" onClick={reset}
                  style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
                  {state.status === "error" ? "Try again" : "Cancel"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Result card */}
        {state.status === "done" && (
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle size={16} color="#16a34a" />
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>Import complete</h2>
            </div>
            <div style={{ padding: 20 }}>
              {/* Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "Total rows", value: state.result.totalRows, color: "#374151" },
                  { label: "Imported", value: state.result.successRows, color: "#15803d" },
                  { label: "Failed", value: state.result.failedRows.length, color: state.result.failedRows.length > 0 ? "#b91c1c" : "#9ca3af" },
                ].map((s) => (
                  <div key={s.label} style={{ border: "1px solid #f3f4f6", borderRadius: "var(--radius)", padding: "12px 16px" }}>
                    <p style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7a8d" }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Failed rows */}
              {state.result.failedRows.length > 0 && (
                <div>
                  <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "#b91c1c" }}>
                    Failed rows — fix and re-upload:
                  </p>
                  <div style={{ border: "1px solid #fecaca", borderRadius: "var(--radius)", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#fef2f2" }}>
                          {["Row", "Serial", "Reason"].map((h) => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#991b1b" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {state.result.failedRows.map((r) => (
                          <tr key={r.row} style={{ borderTop: "1px solid #fecaca" }}>
                            <td style={{ padding: "8px 12px", color: "#374151" }}>{r.row}</td>
                            <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#374151" }}>{r.serial}</td>
                            <td style={{ padding: "8px 12px", color: "#b91c1c" }}>{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={reset}
                  style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Import another file
                </button>
                <button type="button" onClick={() => navigate("/")}
                  style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
                  Back to Inventory
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual single entry */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={15} color="var(--blue)" />
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>Manual single entry</h2>
          </div>
          <form onSubmit={(e) => void handleManualSubmit(e)} style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>
                  Serial number <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={manualSerial}
                  onChange={(e) => { setManualSerial(e.target.value); setManualError(null); }}
                  onBlur={(e) => void resolvePartBySerial(e.target.value)}
                  placeholder="e.g. F2LWX2QC4J9N"
                  style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" as const }}
                />
                {manualResolving && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#6b7a8d" }}>Checking…</p>}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>
                  Part number <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <PartNumberInput
                  value={manualPartNumber}
                  onChange={(pn, part) => {
                    setManualPartNumber(pn);
                    if (part) setManualPartName(part.part_name);
                  }}
                  required
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>
                  Description <span style={{ fontSize: 11, color: "#9ca3af" }}>(auto-filled)</span>
                </label>
                <input
                  type="text"
                  value={manualPartName}
                  onChange={(e) => setManualPartName(e.target.value)}
                  placeholder="Auto-filled from part number"
                  style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, background: "#f9fafb", outline: "none", boxSizing: "border-box" as const }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Notes</label>
                <input
                  type="text"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Optional"
                  style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" as const }}
                />
              </div>
            </div>

            {manualError && (
              <div role="alert" style={{ marginBottom: 14, padding: "9px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>
                {manualError}
              </div>
            )}
            {manualSuccess && (
              <div role="status" style={{ marginBottom: 14, padding: "9px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", color: "#15803d", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle size={14} /> {manualSuccess}
              </div>
            )}

            <button type="submit" disabled={manualSubmitting}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: manualSubmitting ? "#6b8fc4" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: manualSubmitting ? "not-allowed" : "pointer" }}>
              <Plus size={14} />
              {manualSubmitting ? "Saving…" : "Stock in"}
            </button>
          </form>
        </div>

        {/* Template info */}
        <div style={{ marginTop: 20, padding: "14px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#374151" }}>Required CSV columns</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["serial_number", "part_number"].map((col) => (
              <code key={col} style={{ background: "#e2e8f0", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, color: "#1e293b" }}>{col}</code>
            ))}
            <code style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, color: "#64748b" }}>notes (optional)</code>
          </div>
        </div>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  );
}
