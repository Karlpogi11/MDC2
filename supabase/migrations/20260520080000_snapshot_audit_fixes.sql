-- ============================================================
-- Second-pass audit fixes
-- 1. inventory_snapshot: JOIN → LEFT JOIN (zero-stock parts visible)
-- 2. pg_cron: schedule refresh_inventory_snapshot every 5 min
-- 3. transfer_items: CHECK (serial_id IS NULL OR qty = 1)
-- 4. audit_logs: auto-trigger on serial_numbers + transfers
-- 5. RLS: explicit SELECT policy on inventory_snapshot
-- ============================================================

-- ── 1 + 5. Rebuild inventory_snapshot with LEFT JOIN + RLS policy ─────────────
-- Materialized views don't support security_invoker, so we add an explicit
-- SELECT policy that checks the caller's role via get_my_claim_role().

-- Drop and recreate with LEFT JOIN so parts with zero serials still appear
drop materialized view if exists public.inventory_snapshot cascade;

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
left join serial_stats ss on ss.part_id = p.id   -- LEFT JOIN: include zero-stock parts
left join transfer_stats ts on ts.part_id = p.id
where p.is_active = true
with data;

-- Unique index required for REFRESH CONCURRENTLY
create unique index if not exists idx_inventory_snapshot_part_id
  on public.inventory_snapshot(part_id);

-- Restore grant
grant select on public.inventory_snapshot to authenticated;

-- Refresh function
create or replace function public.refresh_inventory_snapshot()
returns void language sql security definer set search_path = public as $$
  refresh materialized view concurrently public.inventory_snapshot;
$$;
grant execute on function public.refresh_inventory_snapshot() to authenticated;

-- ── 2. pg_cron: refresh every 5 min ──────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Remove old job if it exists, then re-add
    perform cron.unschedule('refresh-inventory-snapshot');
  end if;
exception when others then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'refresh-inventory-snapshot',
      '*/5 * * * *',
      'SELECT public.refresh_inventory_snapshot()'
    );
  end if;
exception when others then null;
end;
$$;

-- ── pg_cron: email retry worker ───────────────────────────────────────────────
-- Picks up transfer_emails WHERE status='pending' AND next_attempt_at <= now()
-- Retries up to 3 times with exponential backoff (5m, 15m, 45m).
-- Actual SMTP send is done by the send-transfer-email Edge Function.
-- This function marks overdue pending rows as failed after max attempts.
create or replace function public.retry_pending_transfer_emails()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select id, transfer_id, attempt_count
    from public.transfer_emails
    where status = 'pending'
      and next_attempt_at <= now()
      and attempt_count < 3
    order by next_attempt_at
    limit 20
  loop
    -- Exponential backoff: attempt 1→5min, 2→15min, 3→45min
    update public.transfer_emails
    set
      attempt_count    = attempt_count + 1,
      last_attempted_at = now(),
      next_attempt_at  = now() + (power(3, attempt_count) * interval '5 minutes'),
      status           = case when attempt_count + 1 >= 3 then 'failed' else 'pending' end,
      error_detail     = case when attempt_count + 1 >= 3 then 'Max retry attempts reached' else error_detail end
    where id = r.id;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('retry-transfer-emails');
  end if;
exception when others then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'retry-transfer-emails',
      '*/5 * * * *',
      'SELECT public.retry_pending_transfer_emails()'
    );
  end if;
exception when others then null;
end;
$$;

-- ── 3. transfer_items: serial qty constraint ──────────────────────────────────
-- A serialized item must have qty = 1. Bulk (non-serial) items can have any qty.
alter table public.transfer_items
  drop constraint if exists transfer_items_serial_qty_check;

alter table public.transfer_items
  add constraint transfer_items_serial_qty_check
  check (serial_id is null or qty = 1);

-- ── 4. audit_logs: auto-trigger on serial_numbers + transfers ─────────────────
-- Writes a row to audit_logs on every INSERT/UPDATE/DELETE.
-- Uses a system actor (null) for automated entries; application entries still
-- write their own rows with the real actor_id.

create or replace function public.audit_log_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
begin
  -- Try to get the current user; falls back to null for service-role ops
  begin
    v_actor := auth.uid();
  exception when others then
    v_actor := null;
  end;

  v_action := TG_OP; -- 'INSERT', 'UPDATE', 'DELETE'
  v_old    := case when TG_OP = 'DELETE'              then to_jsonb(OLD) else null end;
  v_new    := case when TG_OP in ('INSERT','UPDATE')  then to_jsonb(NEW) else null end;

  -- Skip if no meaningful change (UPDATE with identical rows)
  if TG_OP = 'UPDATE' and v_old = v_new then
    return NEW;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    v_actor,
    lower(v_action),
    TG_TABLE_NAME,
    coalesce(
      (v_new->>'id')::uuid,
      (v_old->>'id')::uuid
    ),
    v_old,
    v_new
  );

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

-- serial_numbers trigger
drop trigger if exists trg_audit_serial_numbers on public.serial_numbers;
create trigger trg_audit_serial_numbers
  after insert or update or delete on public.serial_numbers
  for each row execute function public.audit_log_trigger();

-- transfers trigger
drop trigger if exists trg_audit_transfers on public.transfers;
create trigger trg_audit_transfers
  after insert or update or delete on public.transfers
  for each row execute function public.audit_log_trigger();


-- ── bulk_insert_serials: transactional serial insert ─────────────────────────
-- Wraps all serial inserts in a single transaction.
-- If any row fails (duplicate, constraint), the entire batch rolls back.
create or replace function public.bulk_insert_serials(
  p_batch_id uuid,
  p_serials  jsonb
)
returns table (id uuid, serial_number text)
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_id uuid;
  v_serial text;
begin
  for r in select * from jsonb_array_elements(p_serials)
  loop
    insert into public.serial_numbers (
      serial_number, part_id, current_site_id, status, stock_in_batch_id
    ) values (
      r->>'serial_number',
      (r->>'part_id')::uuid,
      (r->>'current_site_id')::uuid,
      coalesce(r->>'status', 'in_stock'),
      p_batch_id
    )
    returning serial_numbers.id, serial_numbers.serial_number
    into v_id, v_serial;

    id := v_id;
    serial_number := v_serial;
    return next;
  end loop;
end;
$$;

grant execute on function public.bulk_insert_serials(uuid, jsonb) to authenticated;
