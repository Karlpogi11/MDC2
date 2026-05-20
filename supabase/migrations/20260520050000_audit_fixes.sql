-- ============================================================
-- Audit fixes (tasks 7-14)
-- ============================================================

-- ── 1. serial_numbers.status: 'transit' → 'in_transit' ──────────────────────
-- Drop old check constraint, backfill, re-add with correct values.
alter table public.serial_numbers
  drop constraint if exists serial_numbers_status_check;

update public.serial_numbers
  set status = 'in_transit'
  where status = 'transit';

alter table public.serial_numbers
  add constraint serial_numbers_status_check
  check (status in ('in_stock','in_transit','transferred','consumed','void'));

-- ── 2. serial_corrections.serial_id NOT NULL ────────────────────────────────
-- Guard: delete any orphaned correction rows with no serial reference
-- (these are audit-dead rows — no serial to correct against).
delete from public.serial_corrections where serial_id is null;

alter table public.serial_corrections
  alter column serial_id set not null;

-- ── 3. UNIQUE INDEX stock_in_items(serial_id) ────────────────────────────────
-- Prevents the same serial appearing in two stock-in batches.
-- Partial: excludes bulk/part-only rows where serial_id is NULL.
create unique index if not exists uq_stock_in_items_serial_id
  on public.stock_in_items(serial_id)
  where serial_id is not null;

-- ── 4. updated_at + trigger on tables missing it ─────────────────────────────
-- set_updated_at() already exists from 20260516020000_mdc_phase1_hardening.sql
-- Using create or replace is safe (idempotent).

-- packing_lists
alter table public.packing_lists
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_packing_lists_updated_at on public.packing_lists;
create trigger trg_packing_lists_updated_at
  before update on public.packing_lists
  for each row execute function public.set_updated_at();

-- analytics_uploads
alter table public.analytics_uploads
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_analytics_uploads_updated_at on public.analytics_uploads;
create trigger trg_analytics_uploads_updated_at
  before update on public.analytics_uploads
  for each row execute function public.set_updated_at();

-- stock_in_batches
alter table public.stock_in_batches
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_stock_in_batches_updated_at on public.stock_in_batches;
create trigger trg_stock_in_batches_updated_at
  before update on public.stock_in_batches
  for each row execute function public.set_updated_at();

-- ── 5. Partial index: serial_numbers(part_id) WHERE in_stock ─────────────────
-- Avoids full-table scans when querying available stock.
-- Replaces the broad idx_serial_numbers_part_id from core schema.
create index if not exists idx_serial_numbers_part_id_in_stock
  on public.serial_numbers(part_id)
  where status = 'in_stock';

-- ── 6. Drop orphaned public.current_role() ───────────────────────────────────
-- Superseded by get_my_claim_role() in 20260516053000.
-- IF EXISTS guard: safe to run even if already dropped.
drop function if exists public.current_role();

-- ── 7. file_hash on analytics_uploads ────────────────────────────────────────
-- Enables duplicate file detection (SHA-256 computed in Edge Function).
-- Nullable: existing rows have no hash; new uploads must provide one.
alter table public.analytics_uploads
  add column if not exists file_hash text;

create unique index if not exists uq_analytics_uploads_file_hash
  on public.analytics_uploads(file_hash)
  where file_hash is not null;

-- ── 8. inventory_snapshot VIEW → MATERIALIZED VIEW ───────────────────────────
-- Plain VIEW re-aggregates every serial on every page load.
-- MATERIALIZED VIEW is refreshed on demand / by pg_cron.
--
-- Drop with CASCADE to handle any dependent grants/policies cleanly.
drop view if exists public.inventory_snapshot cascade;

create materialized view public.inventory_snapshot as
with serial_stats as (
  select
    s.part_id,
    count(*) filter (where s.status in ('in_stock','in_transit'))::int as in_stock,
    count(*) filter (where s.status = 'in_transit')::int               as committed,
    count(*) filter (where s.status = 'in_stock')::int                 as available,
    max(s.stock_in_at)                                                  as last_stock_in_at
  from public.serial_numbers s
  group by s.part_id
),
transfer_stats as (
  select
    ti.part_id,
    max(coalesce(t.packed_at, t.created_at)) as last_stock_out_at
  from public.transfer_items ti
  join public.transfers t on t.id = ti.transfer_id
  where t.status in ('packed','in_transit','received')
  group by ti.part_id
)
select
  p.id                                    as part_id,
  p.part_number,
  p.part_name,
  coalesce(p.category, 'Uncategorized')   as category,
  p.part_type,
  coalesce(ss.in_stock,  0)               as in_stock,
  coalesce(ss.committed, 0)               as committed,
  coalesce(ss.available, 0)               as available,
  ss.last_stock_in_at,
  ts.last_stock_out_at,
  ts.last_stock_out_at                    as last_transfer_at
from public.parts p
join serial_stats ss on ss.part_id = p.id   -- only parts that have serials
left join transfer_stats ts on ts.part_id = p.id
where p.is_active = true
with data;

-- Unique index required for REFRESH CONCURRENTLY (no table lock during refresh)
create unique index if not exists idx_inventory_snapshot_part_id
  on public.inventory_snapshot(part_id);

-- Restore grant (was dropped with CASCADE above)
grant select on public.inventory_snapshot to authenticated;

-- Refresh function — call via pg_cron or after any stock mutation
create or replace function public.refresh_inventory_snapshot()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.inventory_snapshot;
$$;

grant execute on function public.refresh_inventory_snapshot() to authenticated;
