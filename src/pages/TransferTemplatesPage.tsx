import { useState, useEffect, useRef } from "react";
import { Plus, Play, Trash2, RepeatIcon, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { useNavigate } from "react-router-dom";

type Site = { id: string; siteName: string; siteCode: string };
type Part = { id: string; partNumber: string; partName: string };
type TemplateItem = { partId: string; partNumber: string; partName: string; qty: number };

type Template = {
  id: string;
  name: string;
  destinationSiteId: string;
  destName: string;
  schedule: string;
  isActive: boolean;
  createdAt: string;
  items: TemplateItem[];
};

const SCHEDULE_PRESETS = [
  { label: "Every Monday 8am",    value: "0 8 * * 1" },
  { label: "Every Wednesday 8am", value: "0 8 * * 3" },
  { label: "Every Friday 8am",    value: "0 8 * * 5" },
  { label: "Every day 8am",       value: "0 8 * * *" },
  { label: "Every Monday + Thursday", value: "0 8 * * 1,4" },
];

function scheduleLabel(cron: string): string {
  return SCHEDULE_PRESETS.find(p => p.value === cron)?.label ?? cron;
}

function PartSearch({ parts, value, onChange }: { parts: Part[]; value: string; onChange: (id: string) => void }) {
  const selected = parts.find(p => p.id === value);
  const [query, setQuery] = useState(selected ? `${selected.partNumber} — ${selected.partName}` : "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? parts.filter(p => `${p.partNumber} ${p.partName}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40)
    : parts.slice(0, 40);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ flex: 1, position: "relative" }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); onChange(""); }}
        onFocus={() => setOpen(true)}
        placeholder="Search part number or name…"
        style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 50, maxHeight: 220, overflowY: "auto" }}>
          {filtered.map(p => (
            <div key={p.id}
              onMouseDown={() => { onChange(p.id); setQuery(`${p.partNumber} — ${p.partName}`); setOpen(false); }}
              style={{ padding: "5px 8px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--line-soft)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
            >
              <span style={{ fontFamily: "monospace", color: "var(--blue)", marginRight: 8 }}>{p.partNumber}</span>
              <span style={{ color: "var(--text)" }}>{p.partName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TransferTemplatesPage() {
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.profile.id : null;
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSite, setFormSite] = useState("");
  const [formSchedule, setFormSchedule] = useState("0 8 * * 1");
  const [formItems, setFormItems] = useState<{ partId: string; qty: number }[]>([{ partId: "", qty: 1 }]);

  async function load() {
    const [tmplData, siteData, partData] = await Promise.all([
      api.get("/transfer-templates"),
      api.get("/sites?is_dc=false"),
      api.get("/parts"),
    ]);
    setSites((siteData ?? []) as Site[]);
    setParts((partData ?? []) as Part[]);
    setTemplates((tmplData ?? []) as Template[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleSave() {
    if (!actorId || !formName.trim() || !formSite) return;
    const validItems = formItems.filter(i => i.partId && i.qty > 0);
    if (!validItems.length) { setError("Add at least one item."); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/transfer-templates", {
        name: formName.trim(), destinationSiteId: formSite, schedule: formSchedule, createdBy: actorId,
        items: validItems,
      });
      setShowForm(false);
      setFormName(""); setFormSite(""); setFormSchedule("0 8 * * 1");
      setFormItems([{ partId: "", qty: 1 }]);
      void load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save.");
    }
    setSaving(false);
  }

  async function handleRunNow(templateId: string) {
    setRunningId(templateId); setError(null);
    try {
      const data = await api.post(`/transfer-templates/${templateId}/run`);
      if (data?.transferId) { navigate(`/transfers/${data.transferId}`); }
    } catch (e: any) {
      setError(e?.message ?? "Failed to run template.");
    }
    setRunningId(null);
  }

  async function handleToggle(id: string, current: boolean) {
    await api.put(`/transfer-templates/${id}/toggle`, { isActive: !current });
    void load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    await api.delete(`/transfer-templates/${id}`);
    void load();
  }

  return (
    <AppLayout>
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <RepeatIcon size={18} color="var(--blue)" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Recurring Templates</h1>
          </div>
          <button type="button" onClick={() => setShowForm(v => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> New template
          </button>
        </div>

        {error && <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: "1px solid var(--line)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>{error}</div>}

        {/* Create form */}
        {showForm && (
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 20, marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>New Template</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase" }}>Template name</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Weekly Podium Restock"
                  style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase" }}>Destination site</label>
                <select value={formSite} onChange={e => setFormSite(e.target.value)}
                  style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, outline: "none", background: "var(--bg-surface)" }}>
                  <option value="">— select site —</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.siteName} ({s.siteCode})</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase" }}>Schedule</label>
              <select value={formSchedule} onChange={e => setFormSchedule(e.target.value)}
                style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, outline: "none", background: "var(--bg-surface)" }}>
                {SCHEDULE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 8, textTransform: "uppercase" }}>Items</label>
              {formItems.map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <PartSearch parts={parts} value={item.partId} onChange={id => setFormItems(prev => prev.map((x, j) => j === i ? { ...x, partId: id } : x))} />
                  <input type="number" min={1} value={item.qty} onChange={e => setFormItems(prev => prev.map((x, j) => j === i ? { ...x, qty: parseInt(e.target.value) || 1 } : x))}
                    style={{ width: 64, border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 8px", fontSize: 13, outline: "none", textAlign: "center" }} />
                  <button type="button" onClick={() => setFormItems(prev => prev.filter((_, j) => j !== i))} disabled={formItems.length === 1}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setFormItems(prev => [...prev, { partId: "", qty: 1 }])}
                style={{ fontSize: 12, color: "var(--blue)", background: "none", border: "1px dashed var(--blue)", padding: "5px 12px", cursor: "pointer" }}>
                + Add item
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--text)" }}>Cancel</button>
              <button type="button" onClick={() => void handleSave()} disabled={saving || !formName.trim() || !formSite}
                style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {saving ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        )}

        {/* Template list */}
        {loading && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Loading…</div>}
        {!loading && templates.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", border: "1px dashed var(--line)", borderRadius: "var(--radius)" }}>
            <RepeatIcon size={32} color="#d1d5db" style={{ marginBottom: 12 }} />
            <p style={{ margin: 0 }}>No templates yet. Create one to auto-generate recurring draft transfers.</p>
          </div>
        )}
        {templates.map(t => (
          <div key={t.id} style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 20px", marginBottom: 12, opacity: t.isActive ? 1 : 0.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: "var(--bg-surface-elevated)", color: t.isActive ? "var(--link)" : "var(--muted)" }}>
                    {t.isActive ? "Active" : "Paused"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                  → <strong>{t.destName}</strong> · {scheduleLabel(t.schedule)}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {t.items.map((item, i) => (
                    <span key={i} style={{ fontSize: 11, padding: "2px 8px", background: "var(--bg-surface-elevated)", color: "var(--text)", borderRadius: "var(--radius-sm)" }}>
                      {item.qty}× {item.partNumber}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => void handleRunNow(t.id)} disabled={runningId === t.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: runningId === t.id ? 0.6 : 1 }}>
                  <Play size={12} /> {runningId === t.id ? "Creating…" : "Run now"}
                </button>
                <button type="button" onClick={() => void handleToggle(t.id, t.isActive)}
                  style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--text)" }}>
                  {t.isActive ? "Pause" : "Resume"}
                </button>
                <button type="button" onClick={() => void handleDelete(t.id)}
                  style={{ background: "none", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "6px 10px", cursor: "pointer", color: "var(--negative)" }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </main>
    </AppLayout>
  );
}






