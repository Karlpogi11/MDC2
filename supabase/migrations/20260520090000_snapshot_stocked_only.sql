-- Fix inventory_snapshot: only show parts that have ever been stocked in.
-- The LEFT JOIN added in 20260520080000 caused all 700 catalog parts to appear.
-- Revert to INNER JOIN on serial_stats — only parts with at least one serial record show.
-- Zero-stock parts that WERE stocked in still appear (their serial_stats row exists with 0 in_stock).

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
join serial_stats ss on ss.part_id = p.id    -- INNER JOIN: only parts with serials
left join transfer_stats ts on ts.part_id = p.id
where p.is_active = true
with data;

create unique index if not exists idx_inventory_snapshot_part_id
  on public.inventory_snapshot(part_id);

grant select on public.inventory_snapshot to authenticated;

create or replace function public.refresh_inventory_snapshot()
returns void language sql security definer set search_path = public as $$
  refresh materialized view concurrently public.inventory_snapshot;
$$;
grant execute on function public.refresh_inventory_snapshot() to authenticated;
