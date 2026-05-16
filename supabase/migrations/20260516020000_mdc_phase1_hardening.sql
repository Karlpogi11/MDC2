-- Phase 1 hardening: data integrity, write timestamps, and optimized read model.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_serial_numbers_updated_at on public.serial_numbers;
create trigger set_serial_numbers_updated_at
before update on public.serial_numbers
for each row
execute function public.set_updated_at();

drop trigger if exists set_transfers_updated_at on public.transfers;
create trigger set_transfers_updated_at
before update on public.transfers
for each row
execute function public.set_updated_at();

alter table public.transfers
  drop constraint if exists transfers_source_destination_diff;

alter table public.transfers
  add constraint transfers_source_destination_diff
  check (source_site_id <> destination_site_id);

create index if not exists idx_serial_numbers_part_status_site
  on public.serial_numbers (part_id, status, current_site_id);

create index if not exists idx_transfers_status_created_at
  on public.transfers (status, created_at desc);

create index if not exists idx_transfers_destination_created_at
  on public.transfers (destination_site_id, created_at desc);

create index if not exists idx_stock_in_items_batch_id
  on public.stock_in_items (batch_id);

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
    max(t.created_at) as last_transfer_at
  from public.transfer_items ti
  join public.transfers t
    on t.id = ti.transfer_id
  where t.status <> 'cancelled'
  group by ti.part_id
)
select
  p.id as part_id,
  p.part_number,
  p.part_name,
  coalesce(p.category, 'Uncategorized') as category,
  coalesce(ss.in_stock, 0) as in_stock,
  coalesce(ss.committed, 0) as committed,
  greatest(coalesce(ss.in_stock, 0) - coalesce(ss.committed, 0), 0)::int as available,
  ss.last_stock_in_at,
  ts.last_transfer_at
from public.parts p
left join serial_stats ss
  on ss.part_id = p.id
left join transfer_stats ts
  on ts.part_id = p.id
where p.is_active = true;

grant select on public.inventory_snapshot to authenticated;
