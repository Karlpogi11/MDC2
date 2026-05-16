-- Align inventory fields with parts-list classification and stock movement dates.

-- Drop existing view so we can recreate with updated column order
drop view if exists public.inventory_snapshot;

alter table public.parts
  add column if not exists part_type text;

alter table public.parts
  drop constraint if exists parts_part_type_check;

alter table public.parts
  add constraint parts_part_type_check
  check (part_type in ('product', 'material'));

update public.parts
set part_type = case
  when lower(coalesce(category, '')) like '%material%' then 'material'
  else 'product'
end
where part_type is null;

alter table public.parts
  alter column part_type set not null;

create index if not exists idx_parts_part_type
  on public.parts (part_type);

create or replace view public.inventory_snapshot
with (security_invoker = true)
as
with serial_stats as (
  select
    s.part_id,
    count(*) filter (where s.status = 'in_stock')::int as in_stock,
    count(*) filter (where s.status = 'transferred')::int as committed,
    max(s.stock_in_at) as last_stock_in_at
  from public.serial_numbers s
  group by s.part_id
),
transfer_stats as (
  select
    ti.part_id,
    max(coalesce(t.packed_at, t.created_at)) as last_stock_out_at
  from public.transfer_items ti
  join public.transfers t
    on t.id = ti.transfer_id
  where t.status in ('packed', 'in_transit', 'received')
  group by ti.part_id
)
select
  p.id as part_id,
  p.part_number,
  p.part_name,
  coalesce(p.category, 'Uncategorized') as category,
  p.part_type,
  coalesce(ss.in_stock, 0) as in_stock,
  coalesce(ss.committed, 0) as committed,
  greatest(coalesce(ss.in_stock, 0) - coalesce(ss.committed, 0), 0)::int as available,
  ss.last_stock_in_at,
  ts.last_stock_out_at,
  ts.last_stock_out_at as last_transfer_at
from public.parts p
left join serial_stats ss
  on ss.part_id = p.id
left join transfer_stats ts
  on ts.part_id = p.id
where p.is_active = true;

grant select on public.inventory_snapshot to authenticated;
