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
    signIn: async (username: string, password: string) => {
      const res = await request<{ token: string; user: any }>("POST", "/auth/signin", { username, password });
      storeToken(res.token, res.user);
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
