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
  const [tab, setTab] = useState<"branding" | "parts" | "sites" | "system">("branding");
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
