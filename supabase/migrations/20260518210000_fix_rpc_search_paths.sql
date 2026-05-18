-- Fix search_path on RPCs that call digest() via pgcrypto (installed in extensions schema)

create or replace function public.apply_serial_correction(
  p_old_serial_id   uuid,
  p_new_serial_number text,
  p_reason          text,
  p_actor_id        uuid,
  p_transfer_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_old_serial  record;
  v_new_id      uuid;
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges for serial correction';
  end if;

  select * into v_old_serial from public.serial_numbers
  where id = p_old_serial_id for update;

  if not found then raise exception 'Serial not found: %', p_old_serial_id; end if;

  if exists (select 1 from public.serial_numbers where serial_number = p_new_serial_number) then
    raise exception 'Serial "%" already exists in inventory', p_new_serial_number;
  end if;

  update public.serial_numbers set status = 'void', updated_at = now() where id = p_old_serial_id;

  insert into public.serial_numbers (serial_number, part_id, current_site_id, status, stock_in_batch_id)
  values (
    p_new_serial_number, v_old_serial.part_id, v_old_serial.current_site_id,
    case when v_old_serial.status = 'transferred' then 'transferred' else 'in_stock' end,
    v_old_serial.stock_in_batch_id
  ) returning id into v_new_id;

  insert into public.serial_corrections (transfer_id, serial_id, old_serial_number, new_serial_number, reason, corrected_by)
  values (p_transfer_id, p_old_serial_id, v_old_serial.serial_number, p_new_serial_number, p_reason, p_actor_id);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, note)
  values (
    p_actor_id, 'serial_correction', 'serial_numbers', p_old_serial_id,
    jsonb_build_object('serial_number', v_old_serial.serial_number, 'status', v_old_serial.status),
    jsonb_build_object('serial_number', p_new_serial_number, 'new_id', v_new_id),
    p_reason
  );

  return jsonb_build_object('success', true, 'new_serial_id', v_new_id);
end;
$$;

-- Fix audit_log_hash_trigger search_path
create or replace function public.audit_log_hash_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_prev_hash text;
  v_content   text;
begin
  select row_hash into v_prev_hash
  from public.audit_logs
  order by created_at desc, id desc
  limit 1;

  new.prev_hash := coalesce(v_prev_hash, 'GENESIS');

  v_content := concat_ws('|',
    new.id::text, new.actor_id::text, new.action, new.entity_type,
    coalesce(new.entity_id::text, ''), coalesce(new.old_value::text, ''),
    coalesce(new.new_value::text, ''), coalesce(new.note, ''),
    new.created_at::text, new.prev_hash
  );

  new.row_hash := encode(digest(v_content, 'sha256'), 'hex');
  return new;
end;
$$;
