import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";

export type UserRole = "system_admin" | "dc_admin" | "dc_operator" | "dc_viewer" | "shipping_coordinator";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  username: string | null;
  role: UserRole;
  force_password_change?: boolean;
};

type AuthState =
  | { status: "loading" }
  | { status: "connecting" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; profile: Profile; token: string };

type AuthContextValue = {
  state: AuthState;
  signInWithUsername: (username: string, password: string, rememberMe?: boolean) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const token = api.auth.getToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    const timeout = setTimeout(() => {
      setState((prev) => prev.status === "loading" ? { status: "connecting" } : prev);
    }, 3000);

    const cached = sessionStorage.getItem("mdc-profile-cache");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.ts < 5 * 60 * 1000) {
          clearTimeout(timeout);
          setState({ status: "authenticated", profile: parsed.profile, token });
          return;
        }
      } catch { /* ignore stale cache */ }
    }

    api.auth.me()
      .then((profile) => {
        clearTimeout(timeout);
        sessionStorage.setItem("mdc-profile-cache", JSON.stringify({ profile, ts: Date.now() }));
        setState({ status: "authenticated", profile, token });
      })
      .catch(() => {
        clearTimeout(timeout);
        setState({ status: "unauthenticated" });
      });
  }, []);

  async function signInWithUsername(username: string, password: string, rememberMe = false): Promise<string | null> {
    try {
      const res = await api.auth.signIn(username, password, rememberMe);
      setState({ status: "authenticated", profile: res.user, token: res.token });
      return null;
    } catch (err: any) {
      const msg = err.message?.toLowerCase() ?? "";
      if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed")) {
        return "No connection. Check your internet and try again.";
      }
      return err.message ?? "Invalid username or password.";
    }
  }

  async function signInWithGoogle(): Promise<string | null> {
    return "Google sign-in is not available in the MySQL version.";
  }

  async function signOut() {
    api.auth.signOut();
    document.documentElement.classList.remove("dark-theme");
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("mdc-theme");
    setState({ status: "unauthenticated" });
  }

  return (
    <AuthContext.Provider value={{ state, signInWithUsername, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}