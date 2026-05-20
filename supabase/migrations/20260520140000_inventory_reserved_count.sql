-- Fix inventory_snapshot:
-- reserved = serials assigned to draft/packed transfers (not yet in_transit)
-- available = in_stock serials minus reserved
-- in_stock = serials with status in_stock (unchanged, only moves on in_transit)

drop materialized view if exists public.inventory_snapshot cascade;

create materialized view public.inventory_snapshot as
with serial_stats as (
  select
    s.part_id,
    count(*) filter (where s.status = 'in_stock')::int  as in_stock,
    max(s.stock_in_at)                                   as last_stock_in_at
  from public.serial_numbers s
  group by s.part_id
),
reserved_stats as (
  -- Serials committed to draft or packed transfers (not yet dispatched)
  select
    ti.part_id,
    count(distinct ti.serial_id) filter (where ti.serial_id is not null)::int as reserved
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
  where t.status in ('packed', 'in_transit', 'received')
  group by ti.part_id
)
select
  p.id                                                          as part_id,
  p.part_number,
  p.part_name,
  coalesce(p.category, 'Uncategorized')                        as category,
  p.part_type,
  coalesce(ss.in_stock, 0)                                     as in_stock,
  coalesce(rs.reserved, 0)                                     as reserved,
  greatest(coalesce(ss.in_stock, 0) - coalesce(rs.reserved, 0), 0) as available,
  ss.last_stock_in_at,
  ts.last_stock_out_at,
  ts.last_stock_out_at                                         as last_transfer_at
from public.parts p
join serial_stats ss on ss.part_id = p.id   -- only parts that have been stocked in
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
