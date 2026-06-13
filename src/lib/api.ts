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

async function request<T = any>(
  method: string,
  path: string,
  body?: any,
  options?: { raw?: boolean },
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `Request failed: ${res.status}`);
  }

  if (options?.raw) return res as any;
  return res.json();
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
