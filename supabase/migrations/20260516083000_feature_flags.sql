-- ─────────────────────────────────────────────────────────────────────────────
-- Feature Flags
--
-- New features ship behind flags. Admin toggles without deployment.
-- roles = null means flag applies to all roles.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  roles       text[],   -- null = all roles; ['dc_admin'] = admin only
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

alter table public.feature_flags enable row level security;

-- Everyone can read flags (needed client-side to gate UI)
create policy feature_flags_select on public.feature_flags
  for select to authenticated
  using (true);

-- Only admins can toggle flags
create policy feature_flags_write on public.feature_flags
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

-- updated_at trigger
create trigger feature_flags_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- Seed initial flags (all off by default — flip in dashboard when ready)
insert into public.feature_flags (key, enabled, roles, description) values
  ('enable_barcode_scanner',  false, null,           'Web camera barcode/QR scanning on stock-in and transfers'),
  ('enable_approvals',        false, null,           'Approval workflow for high-risk corrections and large transfers'),
  ('enable_realtime',         false, null,           'Supabase Realtime live inventory updates'),
  ('enable_notifications',    false, null,           'In-app notification center'),
  ('enable_physical_count',   false, null,           'Physical stock count / reconciliation module'),
  ('enable_webhooks',         false, array['dc_admin','system_admin'], 'Outbound webhook event dispatch')
on conflict (key) do nothing;
