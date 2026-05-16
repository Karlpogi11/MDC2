-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3+4: physical_counts, webhooks, report_jobs, materialized analytics
-- ─────────────────────────────────────────────────────────────────────────────

-- Physical stock count / reconciliation
create table if not exists public.physical_counts (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'open' check (status in ('open','submitted','approved','rejected')),
  notes        text,
  created_by   uuid not null references public.profiles(id),
  reviewed_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists public.physical_count_items (
  id               uuid primary key default gen_random_uuid(),
  count_id         uuid not null references public.physical_counts(id) on delete cascade,
  serial_id        uuid references public.serial_numbers(id),
  part_id          uuid not null references public.parts(id),
  expected_status  text,   -- status in system at time of count
  actual_status    text,   -- what operator physically found
  serial_number    text,   -- denormalized for export/import
  variance         text,   -- 'match','surplus','missing','status_mismatch'
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_physical_count_items_count
  on public.physical_count_items(count_id);

alter table public.physical_counts enable row level security;
alter table public.physical_count_items enable row level security;

create policy physical_counts_select on public.physical_counts
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy physical_counts_write on public.physical_counts
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy physical_count_items_select on public.physical_count_items
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy physical_count_items_write on public.physical_count_items
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create trigger physical_counts_updated_at
  before update on public.physical_counts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Outbound webhooks
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.webhooks (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  secret      text not null,  -- HMAC signing secret
  events      text[] not null default '{}',  -- ['transfer.received','stock_in.completed',...]
  is_active   boolean not null default true,
  description text,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.webhooks enable row level security;
create policy webhooks_select on public.webhooks
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'));
create policy webhooks_write on public.webhooks
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

create trigger webhooks_updated_at
  before update on public.webhooks
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduled report jobs (digest email config)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.report_jobs (
  id          uuid primary key default gen_random_uuid(),
  type        text not null default 'weekly_digest',
  schedule    text not null default '0 8 * * 1',  -- cron expression
  recipients  text[] not null default '{}',
  is_active   boolean not null default false,
  last_run_at timestamptz,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.report_jobs enable row level security;
create policy report_jobs_select on public.report_jobs
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'));
create policy report_jobs_write on public.report_jobs
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

create trigger report_jobs_updated_at
  before update on public.report_jobs
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Materialized view: analytics_summary
-- Refreshed every 15 min via pg_cron (set up after enabling pg_cron extension)
-- ─────────────────────────────────────────────────────────────────────────────
create materialized view if not exists public.analytics_summary as
select
  ar.part_number,
  p.part_name,
  ar.site_code,
  ar.source_type,
  date_trunc('month', ar.used_at) as month,
  sum(ar.qty)::int                as total_qty,
  count(*)::int                   as repair_count,
  max(ar.used_at)                 as last_used
from public.analytics_rows ar
left join public.parts p on p.part_number = ar.part_number
where ar.used_at is not null
group by ar.part_number, p.part_name, ar.site_code, ar.source_type, date_trunc('month', ar.used_at)
with data;

create unique index if not exists idx_analytics_summary_pk
  on public.analytics_summary(part_number, coalesce(site_code,''), source_type, month);

create index if not exists idx_analytics_summary_part
  on public.analytics_summary(part_number, total_qty desc);

-- Function to refresh (called by pg_cron or manually)
create or replace function public.refresh_analytics_summary()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.analytics_summary;
$$;

-- pg_cron: refresh every 15 minutes
-- Requires pg_cron extension enabled in Supabase Dashboard → Database → Extensions
-- Run manually if pg_cron not yet enabled:
--   SELECT cron.schedule('refresh-analytics', '*/15 * * * *', 'SELECT public.refresh_analytics_summary()');
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'refresh-analytics-summary',
      '*/15 * * * *',
      'SELECT public.refresh_analytics_summary()'
    );
  end if;
exception when others then
  null; -- pg_cron not available, skip silently
end;
$$;
