-- Bootstrap: create the first system_admin account
-- Run this in Supabase Dashboard → SQL Editor AFTER creating the user
-- via Authentication → Users → Add User.
--
-- Replace the values below before running.

do $$
declare
  v_user_id uuid;
begin
  -- Look up the auth user by email
  select id into v_user_id
  from auth.users
  where email = 'YOUR_ADMIN_EMAIL@example.com'  -- ← change this
  limit 1;

  if v_user_id is null then
    raise exception 'User not found. Create the user in Supabase Auth first (Authentication → Users → Add User).';
  end if;

  insert into public.profiles (id, email, username, full_name, role, is_active, force_password_change)
  values (
    v_user_id,
    'YOUR_ADMIN_EMAIL@example.com',  -- ← change this
    'admin',                          -- ← change this (login username)
    'System Admin',                   -- ← change this (display name)
    'system_admin',
    true,
    true   -- forces password change on first login
  )
  on conflict (id) do update
    set role = 'system_admin',
        is_active = true,
        force_password_change = true;

  raise notice 'system_admin profile created for user %', v_user_id;
end;
$$;
