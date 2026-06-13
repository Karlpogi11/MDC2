import { friendlyError } from "@/lib/friendlyError";
import { useState, useRef, useEffect, type ChangeEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Upload, Download, CheckCircle, XCircle, FileText, X, Plus, ScanLine } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { PartNumberInput } from "@/components/PartNumberInput";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useFeatureFlag } from "@/lib/useFeatureFlag";
import { useTableResize } from "@/components/ResizableColumns";
import { enqueueOp, getQueue, removeFromQueue } from "@/lib/offlineQueue";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

type BatchResult = {
  batchId: string;
  totalRows: number;
  successRows: number;
  failedRows: { row: number; serial: string; reason: string }[];
};

type PreviewRow = {
  row: number;
  serial_number: string;
  part_number: string;
  notes?: string;
  valid: boolean;
  error?: string;
};

type UploadState =
  | { status: "idle" }
  | { status: "selected"; file: File }
  | { status: "previewing"; file: File; rows: PreviewRow[]; totalRows: number }
  | { status: "uploading"; totalRows: number }
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
  const tableRef = useTableResize();
  const onlineStatus = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(() => getQueue().length);

  // Replay queued operations when connection is restored
  useEffect(() => {
    if (onlineStatus !== "restored") return;
    const queue = getQueue();
    if (queue.length === 0) return;

    void (async () => {
      for (const op of queue) {
        if (op.type !== "stock_in_batch") continue;
        try {
          await executeBatchInsert(op.payload.serials, op.payload.actorId);
          removeFromQueue(op.id);
        } catch {
          // still offline or failed — leave in queue
        }
      }
      setPendingCount(getQueue().length);
    })();
  }, [onlineStatus]);

  const navigate = useNavigate();
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.profile.id : null;

  async function executeBatchInsert(
    serials: { serial: string; partNumber: string; partName: string }[],
    actor: string
  ) {
    const dcSite = await api.get("/sites/dc");
    if (!dcSite) throw new Error("DC site not configured.");
    const uniqueParts = [...new Set(serials.map((r) => r.partNumber))];
    const allParts = await api.get("/parts");
    const existingParts = (allParts ?? []).filter((p: any) => uniqueParts.includes(p.part_number));
    const partMap = new Map(existingParts.map((p: any) => [p.part_number, p.id]));
    const missing = uniqueParts.filter((pn) => !partMap.has(pn));
    if (missing.length > 0) {
      throw new Error(`Unknown part number${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Add them in Config → Parts first.`);
    }
    const result = await api.post("/stock-in/batch", { serials, actor_id: actor, dc_site_id: (dcSite as any).id });
    const r = result as any;
    await api.post("/inventory/refresh-snapshot", {}).catch(() => {});
    return { ok: r.successRows ?? 0, failed: r.failedRows ?? [] };
  }

  // --- Bulk upload state ---
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Scan mode always-on: Tab/Enter advances serial → part ---
  const serialInputRef = useRef<HTMLInputElement>(null);
  const partInputRef = useRef<HTMLInputElement>(null);

  // --- Barcode camera scanner ---
  const [cameraOpen, setCameraOpen] = useState(false);
  const barcodeEnabled = useFeatureFlag("enable_barcode_scanner");

  // Parse CSV text into preview rows (first 10 + validation)
  function parseCSVPreview(text: string): { rows: PreviewRow[]; totalRows: number } {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return { rows: [], totalRows: 0 };
    const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
    const snIdx = header.findIndex((h) => h.includes("serial"));
    const pnIdx = header.findIndex((h) => h.includes("part"));
    const notesIdx = header.findIndex((h) => h.includes("note"));
    const dataLines = lines.slice(1);
    const totalRows = dataLines.filter(Boolean).length;

    const rows = dataLines.slice(0, 10).map((line, i) => {
      const cols = line.split(",").map((c) => c.trim().replace(/"/g, ""));
      const serial = snIdx >= 0 ? cols[snIdx] ?? "" : "";
      const part = pnIdx >= 0 ? cols[pnIdx] ?? "" : "";
      const notes = notesIdx >= 0 ? cols[notesIdx] : undefined;
      const errors: string[] = [];
      if (!serial) errors.push("missing serial");
      if (!part) errors.push("missing part number");
      return { row: i + 2, serial_number: serial, part_number: part, notes, valid: errors.length === 0, error: errors.join(", ") || undefined };
    });

    return { rows, totalRows };
  }

  async function buildPreview(file: File) {
    if (!file.name.endsWith(".csv")) {
      setState({ status: "selected", file });
      return;
    }
    const text = await file.text();
    const { rows, totalRows } = parseCSVPreview(text);
    setState({ status: "previewing", file, rows, totalRows });
  }

  // --- Batch draft: each row has serial + part number ---
  type DraftRow = { serial: string; partNumber: string; partName: string; error?: string };
  const [draftSerial, setDraftSerial] = useState("");
  const [draftPartNumber, setDraftPartNumber] = useState("");
  const [draftPartName, setDraftPartName] = useState("");
  const [draftPartConfirmed, setDraftPartConfirmed] = useState(false);
  const [draftList, setDraftList] = useState<DraftRow[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: number; failed: { serial: string; reason: string }[] } | null>(null);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  const [serialFocused, setSerialFocused] = useState(false);

  function handleSerialEnter(e: KeyboardEvent<HTMLInputElement>) {
    // Cmd/Ctrl + Enter → submit the batch
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (draftList.filter((r) => !r.error).length > 0 && !submitting) {
        void handleBatchSubmit();
      }
      return;
    }
    if (e.key !== "Enter" && e.key !== "Tab") return;
    e.preventDefault();
    const sn = draftSerial.replace(/\s/g, "");
    if (!sn) return;
    if (!draftPartNumber.trim()) { setDraftError("Set a part number first."); return; }
    if (!draftPartConfirmed) { setDraftError("Select a part number from the suggestions."); return; }
    // Reject duplicates inline (don't add)
    if (draftList.some((r) => r.serial === sn)) {
      setDraftError(`Duplicate: ${sn} already scanned in this batch.`);
      setDraftSerial("");
      serialInputRef.current?.focus();
      return;
    }
    setDraftError(null);
    const newIdx = draftList.length;
    setDraftList((prev) => [...prev, { serial: sn, partNumber: draftPartNumber.trim(), partName: draftPartName }]);
    setFlashIdx(newIdx);
    setTimeout(() => setFlashIdx((cur) => (cur === newIdx ? null : cur)), 600);
    setDraftSerial("");
    serialInputRef.current?.focus();
  }

  async function handleBatchSubmit() {
    if (!actorId) return;
    const valid = draftList.filter((r) => !r.error);
    if (valid.length === 0) return;
    setSubmitting(true);
    try {
      const result = await executeBatchInsert(valid, actorId);
      setSubmitResult({ ok: result.ok, failed: result.failed.map((r: { serial: string }) => ({ serial: r.serial, reason: "duplicate or constraint" })) });
      setDraftList([]);
      setDraftPartNumber(""); setDraftPartName(""); setDraftPartConfirmed(false);
    } catch (err) {
      const msg = (err instanceof Error ? friendlyError(err) : "").toLowerCase();
      const isNetwork = msg.includes("fetch") || msg.includes("network") || msg.includes("failed") || !navigator.onLine;
      if (isNetwork) {
        // Queue for replay when connection restores
        enqueueOp({ type: "stock_in_batch", payload: { serials: valid, actorId } });
        setPendingCount(getQueue().length);
        setDraftError("No connection. Batch saved — will auto-submit when connection restores.");
      } else {
        setDraftError(err instanceof Error ? friendlyError(err) : "Batch submit failed.");
      }
    }
    setSubmitting(false);
  }
  function selectFile(file: File) {
    const err = validateFile(file);
    if (err) { setState({ status: "error", message: err }); return; }
    void buildPreview(file);
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
    if (state.status !== "selected" && state.status !== "previewing") return;
    const file = state.file;
    const totalRows = state.status === "previewing" ? state.totalRows : 0;
    setState({ status: "uploading", totalRows });

    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api.post("/stock-in/upload", formData);

      setState({ status: "done", result: data as BatchResult });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? friendlyError(err) : "Upload failed." });
    }
  }

  function reset() {
    setState({ status: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <AppLayout>
      {cameraOpen && (
        <BarcodeScanner
          onScan={(val) => {
            setDraftSerial(val);
            setCameraOpen(false);
            serialInputRef.current?.focus();
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
      <main style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Stock-In</h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Scan serials manually or upload a CSV/XLSX file.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {barcodeEnabled && (
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                <ScanLine size={14} /> Camera scan
              </button>
            )}
            <button
              type="button"
              onClick={downloadTemplate}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              <Download size={14} /> Download template
            </button>
          </div>
        </div>

        {/* Upload card */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-soft)" }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Upload file</h2>
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
                  border: `2px dashed ${dragging ? "var(--blue)" : "var(--line)"}`,
                  borderRadius: "var(--radius)", padding: "40px 20px", textAlign: "center",
                  cursor: "pointer", background: dragging ? "var(--accent-glow)" : "var(--bg-surface-elevated)",
                  transition: "all 150ms",
                }}
              >
                <ArrowUp size={28} color="var(--muted)" style={{ marginBottom: 12 }} />
                <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                  Drop file here or click to browse
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
                <FileText size={20} color="#0284c7" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {state.file.name}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                    {(state.file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button type="button" onClick={reset} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)" }}>
                  <X size={16} />
                </button>
              </div>
            )}

            {/* CSV Preview */}
            {state.status === "previewing" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", marginBottom: 12 }}>
                  <FileText size={18} color="#0284c7" />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{state.file.name}</span>
                  <button type="button" onClick={reset} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={16} /></button>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  Preview — first {state.rows.length} of {state.totalRows.toLocaleString()} rows
                  {state.rows.some((r) => !r.valid) && (
                    <span style={{ marginLeft: 8, color: "var(--negative)" }}>⚠ {state.rows.filter((r) => !r.valid).length} invalid row(s) in preview</span>
                  )}
                </p>
                {state.totalRows > 500 && (
                  <div style={{ marginBottom: 10, padding: "5px 8px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--muted)" }}>
                    ⚠ Large file ({state.totalRows.toLocaleString()} rows) — import may take 30–60 seconds. Do not close this tab.
                  </div>
                )}
                <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "var(--bg-surface-elevated)" }}>
                        {["Row", "Serial", "Part #", "Status"].map((h) => (
                          <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "var(--muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {state.rows.map((r) => (
                        <tr key={r.row} style={{ borderTop: "1px solid var(--line-soft)", background: r.valid ? "transparent" : "rgba(255,69,58,0.08)" }}>
                          <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{r.row}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "var(--text)" }}>{r.serial_number || <span style={{ color: "var(--negative)" }}>—</span>}</td>
                          <td style={{ padding: "6px 10px", color: "var(--text)" }}>{r.part_number || <span style={{ color: "var(--negative)" }}>—</span>}</td>
                          <td style={{ padding: "6px 10px" }}>
                            {r.valid
                              ? <span style={{ color: "var(--text)", fontWeight: 600 }}>✓ OK</span>
                              : <span style={{ color: "var(--negative)", fontSize: 11 }}>{r.error}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Uploading */}
            {state.status === "uploading" && (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div className="circle" style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "var(--blue)", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                <p style={{ margin: 0, fontSize: 14, color: "var(--text)", fontWeight: 600 }}>Processing import…</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  {state.totalRows > 0 ? `Importing ${state.totalRows.toLocaleString()} rows — this may take a moment` : "Validating and inserting rows"}
                </p>
                {state.totalRows > 200 && (
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", background: "var(--bg-surface-elevated)", display: "inline-block", padding: "4px 12px", borderRadius: "var(--radius)" }}>
                    Large file — do not close this tab
                  </p>
                )}
              </div>
            )}

            {/* Error */}
            {state.status === "error" && (
              <div role="alert" style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <XCircle size={16} />
                {state.message}
              </div>
            )}

            {/* Actions */}
            {(state.status === "selected" || state.status === "previewing" || state.status === "error") && (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                {(state.status === "selected" || state.status === "previewing") && (
                  <button
                    type="button"
                    onClick={() => void handleUpload()}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    <Upload size={14} /> Import now
                  </button>
                )}
                <button type="button" onClick={reset}
                  style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                  {state.status === "error" ? "Try again" : "Cancel"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Result card */}
        {state.status === "done" && (
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle size={16} color="#16a34a" />
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Import complete</h2>
            </div>
            <div style={{ padding: 20 }}>
              {/* Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "Total rows", value: state.result.totalRows, color: "var(--text)" },
                  { label: "Imported", value: state.result.successRows, color: "var(--text)" },
                  { label: "Failed", value: state.result.failedRows.length, color: state.result.failedRows.length > 0 ? "#b91c1c" : "#9ca3af" },
                ].map((s) => (
                  <div key={s.label} style={{ border: "1px solid var(--line-soft)", borderRadius: "var(--radius)", padding: "12px 16px" }}>
                    <p style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Failed rows */}
              {state.result.failedRows.length > 0 && (
                <div>
                  <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "var(--negative)" }}>
                    Failed rows — fix and re-upload:
                  </p>
                  <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden", overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "var(--bg-surface-elevated)" }}>
                          {["Row", "Serial", "Reason"].map((h) => (
                            <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "var(--negative)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {state.result.failedRows.map((r) => (
                          <tr key={r.row} style={{ borderTop: "1px solid var(--line)" }}>
                            <td style={{ padding: "5px 8px", color: "var(--text)" }}>{r.row}</td>
                            <td style={{ padding: "5px 8px", fontFamily: "monospace", color: "var(--text)" }}>{r.serial}</td>
                            <td style={{ padding: "5px 8px", color: "var(--negative)" }}>{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={reset}
                  style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Import another file
                </button>
                <button type="button" onClick={() => navigate("/inventory")}
                  style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                  Back to Inventory
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lock + Batch Serial Entry */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={15} color="var(--blue)" />
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Scan serials</h2>
            {pendingCount > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--bg-surface-elevated)", padding: "2px 8px", borderRadius: "var(--radius)" }}>
                {pendingCount} pending — will sync on reconnect
              </span>
            )}
          </div>
          <div style={{ padding: 20 }}>
            {/* Part + Serial inputs side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
                  Part number <span style={{ color: "var(--negative)" }}>*</span>
                </label>
                <PartNumberInput
                  ref={partInputRef}
                  value={draftPartNumber}
                  disabled={draftList.length > 0}
                  onChange={(pn, part) => {
                    setDraftPartNumber(pn);
                    if (part) { setDraftPartName(part.part_name); setDraftPartConfirmed(true); }
                    else { setDraftPartConfirmed(false); }
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
                  Serial number
                </label>
                <input
                  ref={serialInputRef}
                  type="text"
                  value={draftSerial}
                  onChange={(e) => setDraftSerial(e.target.value)}
                  onKeyDown={handleSerialEnter}
                  onFocus={() => setSerialFocused(true)}
                  onBlur={() => setSerialFocused(false)}
                  placeholder={draftPartConfirmed ? "Ready to scan…" : "Set part number first"}
                  autoFocus
                  autoComplete="off"
                  style={{
                    width: "100%",
                    border: `2px solid ${serialFocused && draftPartConfirmed ? "#15803d" : "#d1d5db"}`,
                    borderRadius: "var(--radius)",
                    padding: "5px 8px",
                    fontSize: 13,
                    fontFamily: "monospace",
                    fontWeight: 400,
                    outline: "none",
                    boxSizing: "border-box" as const,
                    background: "var(--bg-surface)",
                    transition: "border-color 120ms, background 120ms",
                  }}
                />
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>Enter to add · {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to submit</p>
              </div>
            </div>

            {draftError && <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--negative)" }}>{draftError}</p>}

            {/* Draft list */}
            {draftList.length > 0 && (
              <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 14 }}>
                <div style={{ padding: "5px 8px", background: "var(--bg-surface-elevated)", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                    {draftList.filter((r) => !r.error).length} ready · {draftList.filter((r) => r.error).length} errors
                  </span>
                  <button type="button" onClick={() => { setDraftList([]); setDraftPartNumber(""); setDraftPartName(""); setDraftPartConfirmed(false); }}
                    style={{ fontSize: 11, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>
                    Clear all
                  </button>
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {[...draftList].reverse().map((row, i) => {
                    const realIdx = draftList.length - 1 - i;
                    const isFlash = flashIdx === realIdx;
                    return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "5px 8px",
                      borderBottom: "1px solid var(--line-soft)",
                      background: isFlash ? "var(--accent-glow)" : row.error ? "rgba(255,69,58,0.08)" : "transparent",
                      transition: "background 600ms",
                    }}>
                      <span style={{ fontSize: 12, fontFamily: "monospace", minWidth: 120, color: row.error ? "var(--negative)" : "var(--text)" }}>{row.serial}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", flex: 1 }}>{row.partNumber}</span>
                      {row.error
                        ? <span style={{ fontSize: 11, color: "var(--negative)" }}>{row.error}</span>
                        : <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>✓</span>}
                      <button type="button" onClick={() => setDraftList((prev) => prev.filter((_, j) => j !== realIdx))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0 }}>
                        <X size={12} />
                      </button>
                    </div>
                  );})}
                </div>
              </div>
            )}

            {submitResult && (
              <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 12 }}>
                <span><CheckCircle size={14} style={{ display: "inline", marginRight: 6 }} />
                {submitResult.ok} serial{submitResult.ok !== 1 ? "s" : ""} stocked in.
                {submitResult.failed.length > 0 && <span style={{ color: "var(--negative)", marginLeft: 8 }}>{submitResult.failed.length} failed.</span>}
                </span>
                <button type="button" onClick={() => navigate("/inventory")}
                  style={{ marginLeft: "auto", background: "none", color: "var(--blue)", border: "none", padding: 0, fontSize: 13, fontWeight: 400, cursor: "pointer", whiteSpace: "nowrap" }}>
                  View
                </button>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button"
              onClick={() => void handleBatchSubmit()}
              disabled={submitting || draftList.filter((r) => !r.error).length === 0}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: draftList.filter((r) => !r.error).length === 0 ? 0.5 : 1 }}>
              <CheckCircle size={14} />
              {submitting ? "Stocking in…" : `Stock in ${draftList.filter((r) => !r.error).length} serial${draftList.filter((r) => !r.error).length !== 1 ? "s" : ""}`}
            </button>
            </div>
          </div>
        </div>

        {/* Template info */}
        <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Required CSV columns</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["serial_number", "part_number"].map((col) => (
              <code key={col} style={{ background: "var(--bg-surface-elevated)", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text)" }}>{col}</code>
            ))}
            <code style={{ background: "var(--bg-surface-elevated)", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--muted)" }}>notes (optional)</code>
          </div>
        </div>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  );
}












