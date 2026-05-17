import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";

export type UserRole = "system_admin" | "dc_admin" | "dc_operator" | "dc_viewer";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  username: string | null;
  role: UserRole;
};

type AuthState =
  | { status: "loading" }
  | { status: "connecting" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: User; session: Session; profile: Profile; aal: "aal1" | "aal2" };

type AuthContextValue = {
  state: AuthState;
  signInWithUsername: (username: string, password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) { setState({ status: "unauthenticated" }); return; }

    // If loading takes >8s, DB is likely unreachable — show connecting overlay
    const timeout = setTimeout(() => {
      setState((prev) => prev.status === "loading" ? { status: "connecting" } : prev);
    }, 3000);

    client.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeout);
      if (session) void loadProfile(session);
      else setState({ status: "unauthenticated" });
    });

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      clearTimeout(timeout);
      if (session) void loadProfile(session);
      else setState({ status: "unauthenticated" });
    });

    return () => { clearTimeout(timeout); subscription.unsubscribe(); };
  }, []);

  async function loadProfile(session: Session) {
    const client = getSupabaseClient()!;
    const { data } = await client
      .from("profiles")
      .select("id,full_name,email,username,role,is_active")
      .eq("id", session.user.id)
      .maybeSingle();

    if (!data) {
      // Google OAuth first login — create profile row
      const meta = session.user.user_metadata;
      const { data: newProfile, error } = await client
        .from("profiles")
        .insert({
          id: session.user.id,
          email: session.user.email,
          full_name: meta?.full_name ?? meta?.name ?? null,
          username: null,
          role: "dc_viewer", // default role; system_admin promotes as needed
        })
        .select("id,full_name,email,username,role")
        .single();

      if (error || !newProfile) {
        await client.auth.signOut();
        setState({ status: "unauthenticated" });
        return;
      }

      setState({ status: "authenticated", user: session.user, session, profile: newProfile as Profile, aal: "aal1" });
      return;
    }

    if (!data.is_active) {
      await client.auth.signOut();
      setState({ status: "unauthenticated" });
      return;
    }

    const { data: aalData } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    const aal = aalData?.currentLevel === "aal2" ? "aal2" : "aal1";

    setState({ status: "authenticated", user: session.user, session, profile: data as Profile, aal });
  }

  async function signInWithUsername(username: string, password: string): Promise<string | null> {
    const client = getSupabaseClient();
    if (!client) return "Supabase is not configured.";

    // Resolve username → email via security definer function
    const { data: email, error: lookupError } = await client
      .rpc("get_email_for_username", { p_username: username });

    if (lookupError) {
      const msg = lookupError.message.toLowerCase();
      if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed")) {
        return "No connection. Check your internet and try again.";
      }
      return lookupError.message;
    }
    if (!email) return "Invalid username or password.";

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed")) {
        return "No connection. Check your internet and try again.";
      }
      return "Invalid username or password.";
    }
    return null;
  }

  async function signInWithGoogle(): Promise<string | null> {
    const client = getSupabaseClient();
    if (!client) return "Supabase is not configured.";

    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    return error ? error.message : null;
  }

  async function signOut() {
    const client = getSupabaseClient();
    await client?.auth.signOut();
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
