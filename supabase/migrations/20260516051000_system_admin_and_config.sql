-- Add system_admin role and app_config table for branding/system settings

-- 1. Extend profiles role check to include system_admin
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('system_admin', 'dc_admin', 'dc_operator', 'dc_viewer'));

-- 2. App config table — one row per key, system_admin only
create table if not exists public.app_config (
  key   text primary key,
  value text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- Seed default branding keys (no-op if already exist)
insert into public.app_config (key, value) values
  ('brand_name',       'MDC Inventory'),
  ('brand_logo_url',   null),
  ('brand_favicon_url',null),
  ('brand_primary_color', '#0b4fa8'),
  ('brand_accent_color',  '#d9f32b'),
  ('support_email',    null),
  ('login_notice',     null)
on conflict (key) do nothing;

-- 3. RLS
alter table public.app_config enable row level security;

-- Everyone authenticated can read config (needed for branding on login page)
create policy app_config_read on public.app_config
  for select to authenticated
  using (true);

-- Only system_admin can write
create policy app_config_write on public.app_config
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'system_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'system_admin'
    )
  );

-- 4. system_admin can read all profiles (for user management)
create policy read_profiles_system_admin on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p2
      where p2.id = auth.uid() and p2.role = 'system_admin'
    )
  );

-- system_admin can insert/update profiles (create/manage users)
create policy write_profiles_system_admin on public.profiles
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p2
      where p2.id = auth.uid() and p2.role = 'system_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p2
      where p2.id = auth.uid() and p2.role = 'system_admin'
    )
  );
