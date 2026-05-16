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
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: User; session: Session; profile: Profile };

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

    client.auth.getSession().then(({ data: { session } }) => {
      if (session) void loadProfile(session);
      else setState({ status: "unauthenticated" });
    });

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (session) void loadProfile(session);
      else setState({ status: "unauthenticated" });
    });

    return () => subscription.unsubscribe();
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

      setState({ status: "authenticated", user: session.user, session, profile: newProfile as Profile });
      return;
    }

    if (!data.is_active) {
      await client.auth.signOut();
      setState({ status: "unauthenticated" });
      return;
    }

    setState({ status: "authenticated", user: session.user, session, profile: data as Profile });
  }

  async function signInWithUsername(username: string, password: string): Promise<string | null> {
    const client = getSupabaseClient();
    if (!client) return "Supabase is not configured.";

    // Resolve username → email via security definer function
    const { data: email, error: lookupError } = await client
      .rpc("get_email_for_username", { p_username: username });

    if (lookupError) return lookupError.message;
    if (!email) return "Invalid username or password.";

    const { error } = await client.auth.signInWithPassword({ email, password });
    return error ? "Invalid username or password." : null;
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
