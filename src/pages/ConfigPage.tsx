import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from "react";
import { Upload, Save, Check } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { notifyBrandingUpdated } from "@/lib/useBranding";
import { AppLayout } from "@/components/AppLayout";
import { PartsTab } from "@/components/PartsTab";
import { SitesTab } from "@/components/SitesTab";

type ConfigMap = Record<string, string | null>;

async function loadConfig(): Promise<ConfigMap> {
  const client = getSupabaseClient();
  if (!client) return {};
  const { data } = await client.from("app_config").select("key,value");
  const map: ConfigMap = {};
  for (const row of data ?? []) map[row.key] = row.value;
  return map;
}

async function saveConfig(key: string, value: string | null, actorId: string): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return "Supabase not configured.";
  const { error } = await client.from("app_config").upsert(
    { key, value, updated_by: actorId, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  return error ? error.message : null;
}

async function uploadLogo(file: File): Promise<{ url: string | null; error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { url: null, error: "Supabase not configured." };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `logos/${Date.now()}.${ext}`;

  // Try upload
  const { error: uploadError } = await client.storage
    .from("branding")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { url: null, error: `Storage error: ${uploadError.message}` };

  const { data } = client.storage.from("branding").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export function ConfigPage() {
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.user.id : "";
  const [tab, setTab] = useState<"branding" | "parts" | "sites" | "system" | "digest" | "webhooks">("branding");
  const [config, setConfig] = useState<ConfigMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConfig().then((map) => { setConfig(map); setLoading(false); });
  }, []);

  const val = (key: string) => config[key] ?? "";

  async function handleSave(e: FormEvent, key: string) {
    e.preventDefault();
    setSaving(key); setError(null);
    const err = await saveConfig(key, config[key] ?? null, actorId);
    setSaving(null);
    if (err) setError(err);
    else {
      setSaved(key); setTimeout(() => setSaved(null), 2000);
      // Apply branding immediately without reload
      const root = document.documentElement;
      if (key === "brand_primary_color" && config[key]) root.style.setProperty("--blue", config[key]!);
      if (key === "brand_accent_color" && config[key]) root.style.setProperty("--nav-active", config[key]!);
      notifyBrandingUpdated();
    }
  }

  async function handleLogoUpload(e: ChangeEvent<HTMLInputElement>, configKey: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/svg+xml", "image/webp"].includes(file.type)) {
      setError("Only PNG, JPG, SVG, or WebP allowed."); return;
    }
    if (file.size > 2 * 1024 * 1024) { setError("File must be under 2MB."); return; }
    setUploadingLogo(true); setError(null);
    const { url, error: uploadErr } = await uploadLogo(file);
    if (logoInputRef.current) logoInputRef.current.value = "";
    if (uploadErr) { setError(uploadErr); setUploadingLogo(false); return; }
    setConfig((c) => ({ ...c, [configKey]: url }));
    const err = await saveConfig(configKey, url, actorId);
    setUploadingLogo(false);
    if (err) setError(err);
    else { setSaved(configKey); setTimeout(() => setSaved(null), 2000); notifyBrandingUpdated(); }
  }

  const TABS = [
    { key: "branding", label: "Branding" },
    { key: "parts",    label: "Parts" },
    { key: "sites",    label: "Sites" },
    { key: "system",   label: "System" },
    { key: "digest",   label: "Email Digest" },
    { key: "webhooks", label: "Webhooks" },
  ] as const;

  return (
    <AppLayout>
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>Configuration</h1>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 2, borderBottom: "2px solid #e5e7eb", marginBottom: 24 }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              style={{
                border: "none", background: "transparent", padding: "10px 20px",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                color: tab === t.key ? "var(--blue)" : "#6b7a8d",
                borderBottom: tab === t.key ? "2px solid var(--blue)" : "2px solid transparent",
                marginBottom: -2,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" style={{ marginBottom: 20, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius)", color: "#b91c1c", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Branding tab */}
        {tab === "branding" && (
          loading ? <p style={{ color: "#6b7a8d", fontSize: 14 }}>Loading…</p> :
          <div style={{ display: "grid", gap: 20 }}>
            <Section title="Logo & Favicon" description="Upload your brand assets.">
              <Field label="Logo" hint="PNG, JPG, SVG or WebP · max 2MB · recommended 200×48px">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  {val("brand_logo_url") ? (
                    <img
                      src={val("brand_logo_url")}
                      alt="Logo"
                      onError={(e) => { (e.target as HTMLImageElement).style.outline = "2px solid #ef4444"; }}
                      style={{ height: 40, maxWidth: 160, objectFit: "contain", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", padding: 4, background: "#fff" }}
                    />
                  ) : (
                    <div style={{ width: 120, height: 40, border: "1px dashed #d1d5db", borderRadius: "var(--radius)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>No logo</span>
                    </div>
                  )}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
                    <Upload size={14} />{uploadingLogo ? "Uploading…" : "Upload logo"}
                    <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: "none" }} onChange={(e) => void handleLogoUpload(e, "brand_logo_url")} disabled={uploadingLogo} />
                  </label>
                  {saved === "brand_logo_url" && <Check size={16} color="#16a34a" />}
                </div>
              </Field>
              <ConfigTextField label="System name" hint="Shown in the browser tab and header."
                value={val("brand_name")} onChange={(v) => setConfig((c) => ({ ...c, brand_name: v }))}
                onSave={(e) => void handleSave(e, "brand_name")} saving={saving === "brand_name"} saved={saved === "brand_name"} />
            </Section>
            <Section title="Colors" description="Primary and accent colors.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <ColorField label="Primary color" value={val("brand_primary_color") || "#0b4fa8"}
                  onChange={(v) => setConfig((c) => ({ ...c, brand_primary_color: v }))}
                  onSave={(e) => void handleSave(e, "brand_primary_color")} saving={saving === "brand_primary_color"} saved={saved === "brand_primary_color"} />
                <ColorField label="Accent color" value={val("brand_accent_color") || "#d9f32b"}
                  onChange={(v) => setConfig((c) => ({ ...c, brand_accent_color: v }))}
                  onSave={(e) => void handleSave(e, "brand_accent_color")} saving={saving === "brand_accent_color"} saved={saved === "brand_accent_color"} />
              </div>
            </Section>
          </div>
        )}

        {tab === "parts" && <PartsTab />}
        {tab === "sites" && <SitesTab />}

        {/* System tab */}
        {tab === "system" && (
          loading ? <p style={{ color: "#6b7a8d", fontSize: 14 }}>Loading…</p> :
          <Section title="System" description="Operational settings visible to all users.">
            <ConfigTextField label="Support email" hint="Shown on the login page and error screens."
              value={val("support_email")} onChange={(v) => setConfig((c) => ({ ...c, support_email: v }))}
              onSave={(e) => void handleSave(e, "support_email")} saving={saving === "support_email"} saved={saved === "support_email"} type="email" />
            <ConfigTextField label="Login notice" hint="Optional message shown below the sign-in form."
              value={val("login_notice")} onChange={(v) => setConfig((c) => ({ ...c, login_notice: v }))}
              onSave={(e) => void handleSave(e, "login_notice")} saving={saving === "login_notice"} saved={saved === "login_notice"} multiline />
          </Section>
        )}

        {/* Email digest tab */}
        {tab === "digest" && (
          <DigestTab actorId={actorId} />
        )}

        {/* Webhooks tab */}
        {tab === "webhooks" && (
          <WebhooksTab actorId={actorId} />
        )}
      </main>
    </AppLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>{title}</h2>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>{description}</p>
      </div>
      <div style={{ padding: "20px", display: "grid", gap: 20 }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>{hint}</p>}
    </div>
  );
}

function ConfigTextField({ label, hint, value, onChange, onSave, saving, saved, type = "text", multiline = false }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  onSave: (e: FormEvent) => void; saving: boolean; saved: boolean; type?: string; multiline?: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)",
    padding: "9px 12px", fontSize: 13, color: "#111827", background: "#fff",
    outline: "none", boxSizing: "border-box", resize: multiline ? "vertical" : undefined,
    minHeight: multiline ? 72 : undefined,
  };
  return (
    <Field label={label} hint={hint}>
      <form onSubmit={onSave} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {multiline
          ? <textarea style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
          : <input style={inputStyle} type={type} value={value} onChange={(e) => onChange(e.target.value)} />}
        <button type="submit" disabled={saving}
          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, transition: "background 200ms" }}>
          {saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? "Saved" : saving ? "Saving…" : "Save"}
        </button>
      </form>
    </Field>
  );
}

function ColorField({ label, value, onChange, onSave, saving, saved }: {
  label: string; value: string; onChange: (v: string) => void;
  onSave: (e: FormEvent) => void; saving: boolean; saved: boolean;
}) {
  return (
    <Field label={label}>
      <form onSubmit={onSave} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 36, border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: 2, cursor: "pointer", background: "#fff" }} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, color: "#111827", outline: "none" }} />
        <button type="submit" disabled={saving}
          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, transition: "background 200ms" }}>
          {saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? "Saved" : saving ? "…" : "Save"}
        </button>
      </form>
    </Field>
  );
}

function DigestTab({ actorId }: { actorId: string }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState("");
  const [schedule, setSchedule] = useState("0 8 * * 1");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    client.from("report_jobs").select("*").order("created_at", { ascending: false })
      .then(({ data }) => { setJobs(data ?? []); setLoading(false); });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    setSaving(true);
    const client = getSupabaseClient();
    if (!client) { setSaving(false); return; }
    const recipientList = recipients.split(/[\n,]/).map((r) => r.trim()).filter(Boolean);
    await client.from("report_jobs").insert({
      type: "weekly_digest", schedule, recipients: recipientList,
      is_active: true, created_by: actorId,
    });
    setSaved(true); setSaving(false);
    setTimeout(() => setSaved(false), 2000);
    const { data } = await client.from("report_jobs").select("*").order("created_at", { ascending: false });
    setJobs(data ?? []);
  }

  async function toggleJob(id: string, is_active: boolean) {
    const client = getSupabaseClient();
    if (!client) return;
    await client.from("report_jobs").update({ is_active }).eq("id", id);
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, is_active } : j));
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Section title="New digest job" description="Schedule automatic inventory summary emails.">
        <form onSubmit={(e) => void handleSave(e)} style={{ display: "grid", gap: 16 }}>
          <Field label="Recipients" hint="One email per line or comma-separated.">
            <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={3}
              placeholder="admin@company.com&#10;manager@company.com"
              style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          </Field>
          <Field label="Cron schedule" hint="Default: Monday 8AM. Use crontab.guru to build expressions.">
            <input type="text" value={schedule} onChange={(e) => setSchedule(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, fontFamily: "monospace", outline: "none", width: 200 }} />
          </Field>
          <div>
            <button type="submit" disabled={saving}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> {saving ? "Saving…" : "Create job"}</>}
            </button>
          </div>
        </form>
      </Section>
      {!loading && jobs.length > 0 && (
        <Section title="Active jobs" description="">
          {jobs.map((j) => (
            <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "monospace" }}>{j.schedule}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7a8d" }}>{(j.recipients ?? []).join(", ")}</p>
              </div>
              <button type="button" onClick={() => void toggleJob(j.id, !j.is_active)}
                style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: j.is_active ? "#dcfce7" : "#f3f4f6", color: j.is_active ? "#15803d" : "#6b7a8d", cursor: "pointer" }}>
                {j.is_active ? "Active" : "Paused"}
              </button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function WebhooksTab({ actorId }: { actorId: string }) {
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState("transfer.received,stock_in.completed");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const ALL_EVENTS = ["transfer.received", "transfer.created", "stock_in.completed", "correction.approved", "physical_count.submitted"];

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    client.from("webhooks").select("*").order("created_at", { ascending: false })
      .then(({ data }) => { setWebhooks(data ?? []); setLoading(false); });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!actorId || !url.trim() || !secret.trim()) return;
    setSaving(true);
    const client = getSupabaseClient();
    if (!client) { setSaving(false); return; }
    const eventList = events.split(",").map((ev) => ev.trim()).filter(Boolean);
    await client.from("webhooks").insert({ url: url.trim(), secret: secret.trim(), events: eventList, created_by: actorId });
    setSaved(true); setSaving(false);
    setTimeout(() => setSaved(false), 2000);
    setUrl(""); setSecret(""); setEvents("transfer.received,stock_in.completed");
    const { data } = await client.from("webhooks").select("*").order("created_at", { ascending: false });
    setWebhooks(data ?? []);
  }

  async function toggleWebhook(id: string, is_active: boolean) {
    const client = getSupabaseClient();
    if (!client) return;
    await client.from("webhooks").update({ is_active }).eq("id", id);
    setWebhooks((prev) => prev.map((w) => w.id === id ? { ...w, is_active } : w));
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Section title="Register webhook" description="Receive outbound events when inventory actions occur.">
        <form onSubmit={(e) => void handleSave(e)} style={{ display: "grid", gap: 16 }}>
          <Field label="Endpoint URL" hint="Must be HTTPS.">
            <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-system.com/webhook"
              style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </Field>
          <Field label="Signing secret" hint="Used to compute X-MDC-Signature HMAC header.">
            <input type="text" required value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="whsec_..."
              style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "var(--radius)", padding: "9px 12px", fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }} />
          </Field>
          <Field label="Events" hint="Comma-separated event names.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {ALL_EVENTS.map((ev) => (
                <button key={ev} type="button"
                  onClick={() => setEvents((prev) => {
                    const list = prev.split(",").map((e) => e.trim()).filter(Boolean);
                    return list.includes(ev) ? list.filter((e) => e !== ev).join(",") : [...list, ev].join(",");
                  })}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 8, border: "1px solid #d1d5db", cursor: "pointer",
                    background: events.includes(ev) ? "var(--blue)" : "#fff",
                    color: events.includes(ev) ? "#fff" : "#374151" }}>
                  {ev}
                </button>
              ))}
            </div>
          </Field>
          <div>
            <button type="submit" disabled={saving}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> {saving ? "Saving…" : "Register"}</>}
            </button>
          </div>
        </form>
      </Section>
      {!loading && webhooks.length > 0 && (
        <Section title="Registered webhooks" description="">
          {webhooks.map((w) => (
            <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid #f3f4f6", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.url}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{(w.events ?? []).join(", ")}</p>
              </div>
              <button type="button" onClick={() => void toggleWebhook(w.id, !w.is_active)}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: w.is_active ? "#dcfce7" : "#f3f4f6", color: w.is_active ? "#15803d" : "#6b7a8d", cursor: "pointer" }}>
                {w.is_active ? "Active" : "Paused"}
              </button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
