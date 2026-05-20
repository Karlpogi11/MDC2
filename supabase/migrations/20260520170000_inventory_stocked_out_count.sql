-- Add explicit stocked_out count to inventory_snapshot.
-- "Reserved" remains draft/packed transfer demand; "Stocked Out" is transferred serials.

drop materialized view if exists public.inventory_snapshot cascade;

create materialized view public.inventory_snapshot as
with serial_stats as (
  select
    s.part_id,
    count(*) filter (where s.status = 'in_stock')::int     as in_stock,
    count(*) filter (where s.status = 'transferred')::int  as stocked_out,
    max(s.stock_in_at)                                      as last_stock_in_at
  from public.serial_numbers s
  group by s.part_id
),
reserved_stats as (
  select
    ti.part_id,
    (
      count(distinct ti.serial_id) filter (where ti.serial_id is not null)
      + coalesce(sum(ti.qty) filter (where ti.serial_id is null), 0)
    )::int as reserved
  from public.transfer_items ti
  join public.transfers t on t.id = ti.transfer_id
  where t.status in ('draft', 'packed')
  group by ti.part_id
),
transfer_stats as (
  select
    ti.part_id,
    max(coalesce(t.packed_at, t.created_at)) as last_stock_out_at
  from public.transfer_items ti
  join public.transfers t on t.id = ti.transfer_id
  where t.status in ('in_transit', 'received')
  group by ti.part_id
)
select
  p.id                                                              as part_id,
  p.part_number,
  p.part_name,
  coalesce(p.category, 'Uncategorized')                            as category,
  p.part_type,
  coalesce(ss.in_stock, 0)                                         as in_stock,
  coalesce(ss.stocked_out, 0)                                      as stocked_out,
  coalesce(rs.reserved, 0)                                         as reserved,
  greatest(coalesce(ss.in_stock, 0) - coalesce(rs.reserved, 0), 0) as available,
  ss.last_stock_in_at,
  ts.last_stock_out_at,
  ts.last_stock_out_at                                             as last_transfer_at
from public.parts p
join serial_stats ss on ss.part_id = p.id
left join reserved_stats rs on rs.part_id = p.id
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
