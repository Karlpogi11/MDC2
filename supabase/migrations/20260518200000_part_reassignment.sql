-- Audit table for part reassignments (wrong part on correct serial)
create table if not exists public.serial_part_reassignments (
  id              uuid primary key default gen_random_uuid(),
  serial_id       uuid not null references public.serial_numbers(id),
  serial_number   text not null,
  old_part_id     uuid not null references public.parts(id),
  new_part_id     uuid not null references public.parts(id),
  reason          text not null,
  reassigned_by   uuid not null references public.profiles(id),
  reassigned_at   timestamptz not null default now()
);

alter table public.serial_part_reassignments enable row level security;

create policy read_part_reassignments on public.serial_part_reassignments
  for select to authenticated using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

create policy write_part_reassignments on public.serial_part_reassignments
  for insert to authenticated with check (public.get_my_role() in ('system_admin','dc_admin'));

-- RPC: atomically reassign a serial to the correct part
create or replace function public.apply_part_reassignment(
  p_serial_id   uuid,
  p_new_part_id uuid,
  p_reason      text,
  p_actor_id    uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_serial record;
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges for part reassignment';
  end if;

  select sn.*, p.part_number as old_part_number
  into v_serial
  from public.serial_numbers sn
  join public.parts p on p.id = sn.part_id
  where sn.id = p_serial_id
  for update;

  if not found then
    raise exception 'Serial not found: %', p_serial_id;
  end if;

  if v_serial.part_id = p_new_part_id then
    raise exception 'New part is the same as current part';
  end if;

  -- Reassign part
  update public.serial_numbers
  set part_id = p_new_part_id, updated_at = now()
  where id = p_serial_id;

  -- Audit record
  insert into public.serial_part_reassignments
    (serial_id, serial_number, old_part_id, new_part_id, reason, reassigned_by)
  values
    (p_serial_id, v_serial.serial_number, v_serial.part_id, p_new_part_id, p_reason, p_actor_id);

  -- Audit log
  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, old_value, new_value, note)
  values (
    p_actor_id, 'part_reassignment', 'serial_numbers', p_serial_id,
    jsonb_build_object('part_id', v_serial.part_id, 'part_number', v_serial.old_part_number),
    jsonb_build_object('part_id', p_new_part_id),
    p_reason
  );

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.apply_part_reassignment(uuid, uuid, text, uuid) to authenticated;
