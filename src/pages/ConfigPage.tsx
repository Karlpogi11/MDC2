import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Save, Check, Moon, Sun, ToggleLeft, ToggleRight, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { notifyBrandingUpdated } from "@/lib/useBranding";
import { AppLayout } from "@/components/AppLayout";
import { PartsTab } from "@/components/PartsTab";
import { SitesTab } from "@/components/SitesTab";
import { getTheme, applyTheme, type Theme } from "@/lib/theme";

type ConfigMap = Record<string, string | null>;

async function loadConfig(): Promise<ConfigMap> {
  const data = await api.get<ConfigMap>("/config");
  return data ?? {};
}

async function saveConfig(key: string, value: string | null, actorId: string): Promise<string | null> {
  try {
    await api.put(`/config/${key}`, { value, updated_by: actorId });
    // Immediately update localStorage cache so reload shows the latest
    try {
      const cached = JSON.parse(localStorage.getItem("mdc-branding-cache") ?? "{}");
      cached[key] = value;
      localStorage.setItem("mdc-branding-cache", JSON.stringify(cached));
    } catch { /* ignore */ }
    // Clear service worker cache so refresh shows new branding
    if ("caches" in window) {
      const cache = await caches.open("mdc-api");
      const requests = await cache.keys();
      for (const req of requests) {
        if (req.url.includes("/config")) {
          await cache.delete(req);
        }
      }
    }
    return null;
  } catch (e: any) {
    return e?.message ?? "Save failed.";
  }
}

async function uploadLogo(file: File): Promise<{ url: string | null; error: string | null }> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const result = await api.post("/storage/branding/upload", formData);
    return { url: result.url ?? null, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message ?? "Upload failed." };
  }
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const { state: authState } = useAuth();
  const actorId = authState.status === "authenticated" ? authState.profile.id : "";
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<"branding" | "parts" | "sites" | "system" | "account" | "digest" | "webhooks" | "danger">(() => {
    if (tabParam === "sites") return "sites";
    if (tabParam === "parts") return "parts";
    if (tabParam === "system") return "system";
    if (tabParam === "account") return "account";
    if (tabParam === "digest") return "digest";
    if (tabParam === "webhooks") return "webhooks";
    if (tabParam === "danger") return "danger";
    return "branding";
  });
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
      queryClient.setQueryData(["branding"], (old: any) => ({ ...old, [key]: config[key] }));
      queryClient.invalidateQueries({ queryKey: ["branding"] });
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
    else { setSaved(configKey); setTimeout(() => setSaved(null), 2000); queryClient.setQueryData(["branding"], (old: any) => ({ ...old, [configKey]: url })); queryClient.invalidateQueries({ queryKey: ["branding"] }); notifyBrandingUpdated(); }
  }

  const role = authState.status === "authenticated" ? authState.profile.role : null;

  const TABS = [
    { key: "branding", label: "Branding" },
    { key: "parts",    label: "Parts" },
    { key: "sites",    label: "Sites" },
    { key: "system",   label: "System" },
    { key: "account",  label: "Account" },
    { key: "digest",   label: "Email Digest" },
    { key: "webhooks", label: "Webhooks" },
    ...(role === "system_admin" ? [{ key: "danger" as const, label: "⚠ Danger Zone" }] : []),
  ] as const;

  return (
    <AppLayout>
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Configuration</h1>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--line)", marginBottom: 24 }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              style={{
                border: "none", background: "transparent", padding: "5px 12px",
                fontSize: 14, fontWeight: 600, cursor: "pointer", borderRadius: 0,
                color: tab === t.key
                  ? (t.key === "danger" ? "var(--negative)" : "var(--blue)")
                  : (t.key === "danger" ? "var(--negative)" : "var(--text)"),
                borderBottom: tab === t.key
                  ? `2px solid ${t.key === "danger" ? "var(--negative)" : "var(--blue)"}`
                  : "2px solid transparent",
                marginBottom: -2,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" style={{ marginBottom: 20, padding: "8px 12px", color: "var(--negative)", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Branding tab */}
        {tab === "branding" && (
          loading ? <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p> :
          <div style={{ display: "grid", gap: 20 }}>
            <Section title="Logo & Favicon" description="Upload your brand assets.">
              <Field label="Logo" hint="PNG, JPG, SVG or WebP · max 2MB · recommended 200×48px">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  {val("brand_logo_url") ? (
                    <img
                      src={val("brand_logo_url")}
                      alt="Logo"
                      onError={(e) => { (e.target as HTMLImageElement).style.outline = "2px solid #ef4444"; }}
                      style={{ height: 40, maxWidth: 160, objectFit: "contain", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 4 }}
                    />
                  ) : (
                    <div style={{ width: 120, height: 40, border: "1px dashed var(--line)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>No logo</span>
                    </div>
                  )}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                    <Upload size={14} />{uploadingLogo ? "Uploading…" : "Upload logo"}
                    <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: "none" }} onChange={(e) => void handleLogoUpload(e, "brand_logo_url")} disabled={uploadingLogo} />
                  </label>
                  {val("brand_logo_url") && (
                    <button type="button" onClick={async () => {
                      setConfig((c) => ({ ...c, brand_logo_url: null }));
                      const err = await saveConfig("brand_logo_url", null, actorId);
                      if (err) setError(err);
                      queryClient.setQueryData(["branding"], (old: any) => ({ ...old, brand_logo_url: null }));
                      queryClient.invalidateQueries({ queryKey: ["branding"] });
                      notifyBrandingUpdated();
                    }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--muted)", padding: "4px 6px", lineHeight: 1 }} title="Remove logo">✕</button>
                  )}
                  {saved === "brand_logo_url" && <Check size={16} color="#16a34a" />}
                </div>
              </Field>
              <ConfigTextField label="System name" hint="Shown in the browser tab and header."
                value={val("brand_name")} onChange={(v) => setConfig((c) => ({ ...c, brand_name: v }))}
                onSave={(e) => void handleSave(e, "brand_name")} saving={saving === "brand_name"} saved={saved === "brand_name"} />
            </Section>
            <AppearanceSection />
          </div>
        )}

        {tab === "parts" && <PartsTab />}
        {tab === "sites" && <SitesTab />}

        {/* System tab */}
        {tab === "system" && (
          loading ? <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p> :
          <Section title="System" description="Operational settings visible to all users.">
            <ConfigTextField label="Support email" hint="Shown on the login page and error screens."
              value={val("support_email")} onChange={(v) => setConfig((c) => ({ ...c, support_email: v }))}
              onSave={(e) => void handleSave(e, "support_email")} saving={saving === "support_email"} saved={saved === "support_email"} type="email" />
            <ConfigTextField label="Login notice" hint="Optional message shown below the sign-in form."
              value={val("login_notice")} onChange={(v) => setConfig((c) => ({ ...c, login_notice: v }))}
              onSave={(e) => void handleSave(e, "login_notice")} saving={saving === "login_notice"} saved={saved === "login_notice"} multiline />
            <Field label="Send email on dispatch" hint="When enabled, an email notification with packing list is sent to the destination site when a transfer is marked In Transit.">
              <button type="button" role="switch" aria-checked={config.send_email_on_dispatch !== "false"} onClick={() => void (async () => {
                const next = config.send_email_on_dispatch === "true" ? "false" : "true";
                setConfig((c) => ({ ...c, send_email_on_dispatch: next }));
                const err = await saveConfig("send_email_on_dispatch", next, actorId);
                if (err) setError(err);
                else { setSaved("send_email_on_dispatch"); setTimeout(() => setSaved(null), 2000); }
              })()}
                style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: 0, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "transparent", color: "var(--text)" }}>
                <span style={{ position: "relative", display: "inline-block", width: 40, height: 22, borderRadius: 11, background: config.send_email_on_dispatch !== "false" ? "#22c55e" : "#d1d5db", transition: "background 200ms", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 2, left: config.send_email_on_dispatch !== "false" ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)", transition: "left 200ms" }} />
                </span>
                <span style={{ color: config.send_email_on_dispatch !== "false" ? "var(--text)" : "var(--muted)" }}>{config.send_email_on_dispatch !== "false" ? "On" : "Off"}</span>
              </button>
            </Field>
          </Section>
        )}

        {/* Account tab */}
        {tab === "account" && (
          <Section title="Account" description="Manage your account security.">
            <Field label="Password" hint="Change your current password.">
              <a href="/change-password"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "none" }}>
                <Lock size={14} />
                Change password
              </a>
            </Field>
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

        {/* Danger Zone tab */}
        {tab === "danger" && (
          <DangerZoneTab role={role} />
        )}
      </main>
    </AppLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-soft)" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</h2>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>{description}</p>
      </div>
      <div style={{ padding: "20px", display: "grid", gap: 20 }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>{hint}</p>}
    </div>
  );
}

function ConfigTextField({ label, hint, value, onChange, onSave, saving, saved, type = "text", multiline = false }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  onSave: (e: FormEvent) => void; saving: boolean; saved: boolean; type?: string; multiline?: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)",
    padding: "5px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)",
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
          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, transition: "background 200ms" }}>
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
          style={{ width: 40, height: 36, border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 2, cursor: "pointer", background: "var(--bg-surface)" }} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, color: "var(--text)", outline: "none" }} />
        <button type="submit" disabled={saving}
          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, transition: "background 200ms" }}>
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
    api.get("/report-jobs").then((data) => { setJobs(data ?? []); setLoading(false); });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    setSaving(true);
    const recipientList = recipients.split(/[\n,]/).map((r) => r.trim()).filter(Boolean);
    await api.post("/report-jobs", {
      type: "weekly_digest", schedule, recipients: recipientList,
      is_active: true, created_by: actorId,
    });
    setSaved(true); setSaving(false);
    setTimeout(() => setSaved(false), 2000);
    const data = await api.get("/report-jobs");
    setJobs(data ?? []);
  }

  async function toggleJob(id: string, is_active: boolean) {
    await api.put(`/report-jobs/${id}/toggle`, { is_active });
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, is_active } : j));
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Section title="New digest job" description="Schedule automatic inventory summary emails.">
        <form onSubmit={(e) => void handleSave(e)} style={{ display: "grid", gap: 16 }}>
          <Field label="Recipients" hint="One email per line or comma-separated.">
            <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={3}
              placeholder="admin@company.com&#10;manager@company.com"
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          </Field>
          <Field label="Cron schedule" hint="Default: Monday 8AM. Use crontab.guru to build expressions.">
            <input type="text" value={schedule} onChange={(e) => setSchedule(e.target.value)}
              style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontFamily: "monospace", outline: "none", width: 200 }} />
          </Field>
          <div>
            <button type="submit" disabled={saving}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> {saving ? "Saving…" : "Create job"}</>}
            </button>
          </div>
        </form>
      </Section>
      {!loading && jobs.length > 0 && (
        <Section title="Active jobs" description="">
          {jobs.map((j) => (
            <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--line-soft)" }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" }}>{j.schedule}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>{(j.recipients ?? []).join(", ")}</p>
              </div>
              <button type="button" onClick={() => void toggleJob(j.id, !j.is_active)}
                style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--bg-surface-elevated)", color: j.is_active ? "var(--link)" : "var(--muted)", cursor: "pointer" }}>
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
    api.get("/webhooks").then((data) => { setWebhooks(data ?? []); setLoading(false); });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!actorId || !url.trim() || !secret.trim()) return;
    setSaving(true);
    const eventList = events.split(",").map((ev) => ev.trim()).filter(Boolean);
    await api.post("/webhooks", { url: url.trim(), secret: secret.trim(), events: eventList, created_by: actorId });
    setSaved(true); setSaving(false);
    setTimeout(() => setSaved(false), 2000);
    setUrl(""); setSecret(""); setEvents("transfer.received,stock_in.completed");
    const data = await api.get("/webhooks");
    setWebhooks(data ?? []);
  }

  async function toggleWebhook(id: string, is_active: boolean) {
    await api.put(`/webhooks/${id}/toggle`, { is_active });
    setWebhooks((prev) => prev.map((w) => w.id === id ? { ...w, is_active } : w));
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Section title="Register webhook" description="Receive outbound events when inventory actions occur.">
        <form onSubmit={(e) => void handleSave(e)} style={{ display: "grid", gap: 16 }}>
          <Field label="Endpoint URL" hint="Must be HTTPS.">
            <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-system.com/webhook"
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </Field>
          <Field label="Signing secret" hint="Used to compute X-MDC-Signature HMAC header.">
            <input type="text" required value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="whsec_..."
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }} />
          </Field>
          <Field label="Events" hint="Comma-separated event names.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {ALL_EVENTS.map((ev) => (
                <button key={ev} type="button"
                  onClick={() => setEvents((prev) => {
                    const list = prev.split(",").map((e) => e.trim()).filter(Boolean);
                    return list.includes(ev) ? list.filter((e) => e !== ev).join(",") : [...list, ev].join(",");
                  })}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: "var(--radius)", border: "1px solid var(--line)", cursor: "pointer",
                    background: events.includes(ev) ? "var(--blue)" : "#fff",
                    color: events.includes(ev) ? "#fff" : "#374151" }}>
                  {ev}
                </button>
              ))}
            </div>
          </Field>
          <div>
            <button type="submit" disabled={saving}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: saved ? "#16a34a" : "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> {saving ? "Saving…" : "Register"}</>}
            </button>
          </div>
        </form>
      </Section>
      {!loading && webhooks.length > 0 && (
        <Section title="Registered webhooks" description="">
          {webhooks.map((w) => (
            <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "5px 0", borderBottom: "1px solid var(--line-soft)", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--blue)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.url}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>{(w.events ?? []).join(", ")}</p>
              </div>
              <button type="button" onClick={() => void toggleWebhook(w.id, !w.is_active)}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--bg-surface-elevated)", color: w.is_active ? "var(--link)" : "var(--muted)", cursor: "pointer" }}>
                {w.is_active ? "Active" : "Paused"}
              </button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
function DangerZoneTab({ role }: { role: string | null }) {
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (role !== "system_admin") {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--negative)", fontSize: 14 }}>
        Only <strong>system_admin</strong> can access this section.
      </div>
    );
  }

  async function handleReset() {
    if (confirm !== "RESET") return;
    setRunning(true); setErr(null);
    try {
      await api.post("/config/reset");
      setDone(true);
    } catch (e: any) {
      setErr(e?.message ?? "Reset failed.");
    }
    setRunning(false);
  }

  if (done) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>✓ Test data cleared.</p>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Sites, parts, and system admin accounts are intact. Ready for go-live.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ background: "var(--bg-surface)", border: "2px solid #fca5a5", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #fecaca", background: "var(--bg-surface-elevated)" }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--negative)" }}>Go-Live Data Reset</h2>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--negative)" }}>
            Permanently deletes all test/sample transactional data. Cannot be undone.
          </p>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text)" }}>
            <strong>Will delete:</strong> all serials, transfers, stock-in batches, corrections, audit logs, analytics, test user profiles.
          </p>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text)" }}>
            <strong>Will keep:</strong> sites, parts list, your admin account, branding, config.
          </p>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
              Type <code style={{ background: "var(--bg-surface-elevated)", padding: "1px 6px", borderRadius: "var(--radius)" }}>RESET</code> to confirm
            </label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="RESET"
              style={{ border: "1px solid #fca5a5", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontFamily: "monospace", outline: "none", width: 200 }}
            />
          </div>
          {err && <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--negative)" }}>{err}</p>}
          <button
            type="button"
            disabled={confirm !== "RESET" || running}
            onClick={() => void handleReset()}
            style={{
              background: confirm === "RESET" ? "#b91c1c" : "#d1d5db",
              color: "#fff", border: "none", borderRadius: "var(--radius)",
              padding: "5px 12px", fontSize: 13, fontWeight: 700,
              cursor: confirm === "RESET" && !running ? "pointer" : "not-allowed",
            }}
          >
            {running ? "Clearing data…" : "Clear all test data"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(getTheme);

  const toggle = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };

  return (
    <Section title="Appearance" description="Choose the interface theme for this device.">
      <div style={{ display: "flex", gap: 12 }}>
        {(["light", "dark"] as Theme[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `2px solid ${theme === t ? "var(--blue)" : "var(--line)"}`,
              background: theme === t ? "var(--blue)" : "var(--bg-surface)",
              color: theme === t ? "#fff" : "var(--text)",
            }}
          >
            {t === "light" ? <Sun size={15} /> : <Moon size={15} />}
            {t === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
    </Section>
  );
}






