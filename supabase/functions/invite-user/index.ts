import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  // Only allow authenticated admins
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401 });

  const { email, username, full_name, role } = await req.json();
  if (!email || !username || !role) {
    return new Response(JSON.stringify({ error: "email, username, role required" }), { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify caller is dc_admin or system_admin
  const { data: { user: caller } } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!caller) return new Response("Unauthorized", { status: 401 });
  const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.id).single();
  if (!["system_admin", "dc_admin"].includes(callerProfile?.role ?? "")) {
    return new Response("Forbidden", { status: 403 });
  }

  // Create auth user and send invite email
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { full_name },
  });

  if (createErr || !newUser.user) {
    return new Response(JSON.stringify({ error: createErr?.message ?? "Failed to create user" }), { status: 400 });
  }

  // Create profile with role + username immediately
  const { error: profileErr } = await admin.from("profiles").upsert({
    id: newUser.user.id,
    email,
    full_name: full_name ?? null,
    username,
    role,
    is_active: true,
  }, { onConflict: "id" });

  if (profileErr) {
    return new Response(JSON.stringify({ error: profileErr.message }), { status: 400 });
  }

  // Send invite link
  await admin.auth.admin.inviteUserByEmail(email);

  return new Response(JSON.stringify({ id: newUser.user.id }), {
    headers: { "Content-Type": "application/json" },
  });
});
