const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

function getToken(): string | null {
  const stored = localStorage.getItem("mdc-auth");
  if (!stored) return null;
  try {
    const { token } = JSON.parse(stored);
    return token ?? null;
  } catch {
    return null;
  }
}

function storeToken(token: string, user: any) {
  localStorage.setItem("mdc-auth", JSON.stringify({ token, user }));
}

function clearToken() {
  localStorage.removeItem("mdc-auth");
}

// ── Saved profiles (remember me) ──────────────────────────────────────────────
// Stores multiple saved profiles as an array for one-click login.
// This is intentionally simple obfuscation (not true encryption) — appropriate
// for an internal trusted-device app, matching the Facebook/Netflix pattern.
const SAVED_PROFILES_KEY = "mdc-saved-profiles";
const SAVED_PROFILE_LEGACY_KEY = "mdc-saved-profile";

function obfuscate(value: string): string {
  const key = 0x5a;
  const bytes = Array.from(value).map((c) => c.charCodeAt(0) ^ key);
  return btoa(String.fromCharCode(...bytes));
}

function deobfuscate(value: string): string {
  const key = 0x5a;
  try {
    const bytes = Array.from(atob(value)).map((c) => c.charCodeAt(0) ^ key);
    return String.fromCharCode(...bytes);
  } catch {
    return "";
  }
}

export type SavedProfile = {
  username: string;
  fullName: string | null;
  role: string | null;
  _p: string; // obfuscated password
  lastUsedAt: number; // timestamp
};

export const PROFILE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function isProfileExpired(profile: { lastUsedAt: number }): boolean {
  return Date.now() - profile.lastUsedAt > PROFILE_EXPIRY_MS;
}

function migrateLegacyProfile() {
  try {
    const raw = localStorage.getItem(SAVED_PROFILE_LEGACY_KEY);
    if (!raw) return;
    const stored = { ...JSON.parse(raw), lastUsedAt: Date.now() };
    if (stored.username && stored._p) {
      localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify([stored]));
    }
    localStorage.removeItem(SAVED_PROFILE_LEGACY_KEY);
  } catch {
    // ignore
  }
}

export function getSavedProfiles(): (SavedProfile & { password: string })[] {
  migrateLegacyProfile();
  try {
    const raw = localStorage.getItem(SAVED_PROFILES_KEY);
    if (!raw) return [];
    const stored: SavedProfile[] = JSON.parse(raw);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((p) => p.username && p._p)
      .map((p) => ({ ...p, lastUsedAt: p.lastUsedAt ?? Date.now(), password: deobfuscate(p._p) }));
  } catch {
    return [];
  }
}

export function getSavedProfile(): (SavedProfile & { password: string }) | null {
  return getSavedProfiles()[0] ?? null;
}

export function saveProfile(username: string, password: string, fullName: string | null, role: string | null) {
  const profiles = getSavedProfiles();
  const idx = profiles.findIndex((p) => p.username.toLowerCase() === username.toLowerCase());
  const entry = { username, fullName, role, _p: obfuscate(password), password, lastUsedAt: Date.now() };
  if (idx >= 0) {
    profiles[idx] = entry;
  } else {
    profiles.push(entry);
  }
  const toStore: SavedProfile[] = profiles.map(({ password: _pw, ...rest }) => rest);
  localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(toStore));
}

export function removeSavedProfile(username: string) {
  const profiles = getSavedProfiles();
  const filtered = profiles.filter((p) => p.username.toLowerCase() !== username.toLowerCase());
  const toStore: SavedProfile[] = filtered.map(({ password: _pw, ...rest }) => rest);
  localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(toStore));
}

export function clearSavedProfile() {
  localStorage.removeItem(SAVED_PROFILES_KEY);
}

function camelizeKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

function snakeizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1_$2")
    .toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeResponse<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeResponse(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizeResponse(raw);
    out[key] = normalized;

    const camelKey = camelizeKey(key);
    if (camelKey !== key && !(camelKey in out)) {
      out[camelKey] = normalized;
    }

    const snakeKey = snakeizeKey(key);
    if (snakeKey !== key && !(snakeKey in out)) {
      out[snakeKey] = normalized;
    }
  }

  return out as T;
}

async function request<T = any>(
  method: string,
  path: string,
  body?: any,
  options?: { raw?: boolean },
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const hasBody = body !== undefined && body !== null;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isUrlEncoded = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;
  const isBinaryBody =
    typeof Blob !== "undefined" && body instanceof Blob ||
    typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer;

  if (hasBody && !isFormData && !isUrlEncoded && !isBinaryBody) {
    headers["Content-Type"] = "application/json";
  } else if (isUrlEncoded) {
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: !hasBody ? undefined : isFormData || isUrlEncoded || isBinaryBody ? body : JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (errText) {
      try {
        const errBody = normalizeResponse(JSON.parse(errText));
        throw new Error((errBody as any)?.error ?? errText);
      } catch {
        throw new Error(errText);
      }
    }
    throw new Error(`Request failed: ${res.status}`);
  }

  if (options?.raw) return res as any;

  if (res.status === 204) return null as T;

  const text = await res.text();
  if (!text) return null as T;

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || text.startsWith("{") || text.startsWith("[")) {
    return normalizeResponse(JSON.parse(text)) as T;
  }

  return text as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>("GET", path),
  post: <T = any>(path: string, body?: any) => request<T>("POST", path, body),
  put: <T = any>(path: string, body?: any) => request<T>("PUT", path, body),
  delete: <T = any>(path: string) => request<T>("DELETE", path),

  auth: {
    signIn: async (username: string, password: string, rememberMe = false) => {
      const res = await request<{ token: string; user: any }>("POST", "/auth/signin", { username, password });
      storeToken(res.token, res.user);
      if (rememberMe) {
        saveProfile(username, password, res.user?.fullName ?? res.user?.full_name ?? null, res.user?.role ?? null);
      }
      return res;
    },
    register: (email: string, username: string, fullName: string, password: string, role?: string) =>
      request("POST", "/auth/register", { email, username, fullName, password, role }),
    me: () => request<any>("GET", "/auth/me"),
    updatePassword: (currentPassword: string, newPassword: string) =>
      request("PUT", "/auth/update-password", { currentPassword, newPassword }),
    signOut: () => {
      clearToken();
    },
    getToken,
    getUser: () => {
      const stored = localStorage.getItem("mdc-auth");
      if (!stored) return null;
      try {
        return JSON.parse(stored).user ?? null;
      } catch {
        return null;
      }
    },
  },
};

export { getToken, storeToken, clearToken };