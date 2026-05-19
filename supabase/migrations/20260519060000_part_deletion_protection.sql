-- Part deletion protection
-- 1. Soft delete column on parts
-- 2. FK RESTRICT on transfer_items + serial_numbers (prevent hard delete if referenced)
-- 3. Denormalize part_number + part_name on transfer_items and stock_in_items

-- ─── 1. Soft delete on parts ────────────────────────────────────────────────
alter table public.parts
  add column if not exists deleted_at timestamptz;

-- Index for fast "active parts" queries
create index if not exists idx_parts_deleted_at
  on public.parts(deleted_at)
  where deleted_at is null;

-- ─── 2. FK RESTRICT on transfer_items ───────────────────────────────────────
-- Drop the existing unconstrained FK and re-add with RESTRICT
alter table public.transfer_items
  drop constraint if exists transfer_items_part_id_fkey;

alter table public.transfer_items
  add constraint transfer_items_part_id_fkey
  foreign key (part_id) references public.parts(id)
  on delete restrict;

-- ─── 3. FK RESTRICT on serial_numbers ───────────────────────────────────────
alter table public.serial_numbers
  drop constraint if exists serial_numbers_part_id_fkey;

alter table public.serial_numbers
  add constraint serial_numbers_part_id_fkey
  foreign key (part_id) references public.parts(id)
  on delete restrict;

-- ─── 4. FK RESTRICT on stock_in_items ───────────────────────────────────────
alter table public.stock_in_items
  drop constraint if exists stock_in_items_part_id_fkey;

alter table public.stock_in_items
  add constraint stock_in_items_part_id_fkey
  foreign key (part_id) references public.parts(id)
  on delete restrict;

-- ─── 5. Denormalize part_number + part_name on transfer_items ───────────────
alter table public.transfer_items
  add column if not exists part_number text,
  add column if not exists part_name   text;

-- ─── 6. Denormalize part_number + part_name on stock_in_items ───────────────
alter table public.stock_in_items
  add column if not exists part_number text,
  add column if not exists part_name   text;

-- ─── 7. Backfill denormalized columns from existing data ────────────────────
update public.transfer_items ti
set
  part_number = p.part_number,
  part_name   = p.part_name
from public.parts p
where p.id = ti.part_id
  and (ti.part_number is null or ti.part_name is null);

update public.stock_in_items si
set
  part_number = p.part_number,
  part_name   = p.part_name
from public.parts p
where p.id = si.part_id
  and (si.part_number is null or si.part_name is null);

-- ─── 8. Now enforce NOT NULL after backfill ──────────────────────────────────
alter table public.transfer_items
  alter column part_number set not null,
  alter column part_name   set not null;

alter table public.stock_in_items
  alter column part_number set not null,
  alter column part_name   set not null;

-- ─── 9. Trigger: auto-populate denormalized fields on insert ─────────────────
create or replace function public.fill_part_snapshot()
returns trigger
language plpgsql
as $$
declare
  v_part record;
begin
  select part_number, part_name into v_part
  from public.parts where id = new.part_id;

  new.part_number := v_part.part_number;
  new.part_name   := v_part.part_name;
  return new;
end;
$$;

create trigger trg_transfer_items_part_snapshot
  before insert on public.transfer_items
  for each row execute function public.fill_part_snapshot();

create trigger trg_stock_in_items_part_snapshot
  before insert on public.stock_in_items
  for each row execute function public.fill_part_snapshot();

-- ─── 10. RPC: retire_part (soft delete with guard) ───────────────────────────
create or replace function public.retire_part(
  p_part_id uuid,
  p_reason  text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part        record;
  v_active_serials int;
  v_transit_serials int;
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Only dc_admin can retire parts';
  end if;

  select * into v_part from public.parts where id = p_part_id;
  if not found then
    raise exception 'Part not found: %', p_part_id;
  end if;

  if v_part.deleted_at is not null then
    raise exception 'Part already retired';
  end if;

  -- Block if any serial is still in_stock or in transit
  select
    count(*) filter (where status = 'in_stock'),
    count(*) filter (where status = 'transit')
  into v_active_serials, v_transit_serials
  from public.serial_numbers
  where part_id = p_part_id;

  if v_active_serials > 0 then
    raise exception 'Cannot retire part: % serial(s) still in stock', v_active_serials;
  end if;

  if v_transit_serials > 0 then
    raise exception 'Cannot retire part: % serial(s) still in transit', v_transit_serials;
  end if;

  -- Soft delete
  update public.parts
  set deleted_at = now(), is_active = false
  where id = p_part_id;

  -- Audit
  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, old_value, new_value, note)
  values (
    p_actor_id, 'retire_part', 'parts', p_part_id,
    jsonb_build_object('is_active', true, 'deleted_at', null),
    jsonb_build_object('is_active', false, 'deleted_at', now()),
    p_reason
  );

  return jsonb_build_object('success', true, 'part_number', v_part.part_number);
end;
$$;

grant execute on function public.retire_part(uuid, text, uuid) to authenticated;
