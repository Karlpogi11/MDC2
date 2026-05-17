-- Fix inventory_snapshot counts:
-- in_stock  = serials at DC (in_stock + transit — still DC's stock)
-- committed = serials in active outbound transfers (transit)
-- available = serials free, no operation assigned (in_stock status only)

drop view if exists public.inventory_snapshot;

create view public.inventory_snapshot
with (security_invoker = true)
as
with stocked_parts as (
  select distinct part_id from public.stock_in_items
),
serial_stats as (
  select
    s.part_id,
    count(*) filter (where s.status in ('in_stock', 'transit'))::int as in_stock,
    count(*) filter (where s.status = 'transit')::int                as committed,
    count(*) filter (where s.status = 'in_stock')::int               as available,
    max(s.stock_in_at)                                               as last_stock_in_at
  from public.serial_numbers s
  group by s.part_id
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
  p.id                              as part_id,
  p.part_number,
  p.part_name,
  coalesce(p.category, 'Uncategorized') as category,
  p.part_type,
  coalesce(ss.in_stock,   0)        as in_stock,
  coalesce(ss.committed,  0)        as committed,
  coalesce(ss.available,  0)        as available,
  ss.last_stock_in_at,
  ts.last_stock_out_at,
  ts.last_stock_out_at              as last_transfer_at
from public.parts p
inner join stocked_parts sp on sp.part_id = p.id
left join serial_stats ss   on ss.part_id = p.id
left join transfer_stats ts on ts.part_id = p.id
where p.is_active = true;

grant select on public.inventory_snapshot to authenticated;
