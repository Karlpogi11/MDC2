-- Fix inventory_snapshot: remove dependency on stock_in_items
-- Root cause: serials exist in serial_numbers but stock_in_items is empty,
-- so the stocked_parts CTE JOIN was filtering out everything.
-- Now drives directly from serial_numbers (source of truth for stock).

create or replace view public.inventory_snapshot as
with serial_stats as (
  select
    s.part_id,
    count(*) filter (where s.status in ('in_stock','transit'))::int as in_stock,
    count(*) filter (where s.status = 'transit')::int               as committed,
    count(*) filter (where s.status = 'in_stock')::int              as available,
    max(s.stock_in_at)                                               as last_stock_in_at
  from serial_numbers s
  group by s.part_id
),
transfer_stats as (
  select
    ti.part_id,
    max(coalesce(t.packed_at, t.created_at)) as last_stock_out_at
  from transfer_items ti
  join transfers t on t.id = ti.transfer_id
  where t.status in ('packed','in_transit','received')
  group by ti.part_id
)
select
  p.id            as part_id,
  p.part_number,
  p.part_name,
  coalesce(p.category, 'Uncategorized') as category,
  p.part_type,
  coalesce(ss.in_stock,   0) as in_stock,
  coalesce(ss.committed,  0) as committed,
  coalesce(ss.available,  0) as available,
  ss.last_stock_in_at,
  ts.last_stock_out_at,
  ts.last_stock_out_at       as last_transfer_at
from parts p
join serial_stats ss on ss.part_id = p.id   -- only parts that have serials
left join transfer_stats ts on ts.part_id = p.id
where p.is_active = true;
