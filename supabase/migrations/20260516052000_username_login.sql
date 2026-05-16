-- Add username to profiles and a secure lookup function for username→email login

alter table public.profiles
  add column if not exists username text unique;

create index if not exists idx_profiles_username on public.profiles (username);

-- Security definer function: resolves username to email without exposing other profile data.
-- Called from the client during login — returns only the email for the given username.
create or replace function public.get_email_for_username(p_username text)
returns text
language sql
security definer
stable
as $$
  select email
  from public.profiles
  where username = lower(trim(p_username))
    and is_active = true
  limit 1;
$$;

-- Allow unauthenticated callers (needed for login flow before session exists)
grant execute on function public.get_email_for_username(text) to anon, authenticated;
