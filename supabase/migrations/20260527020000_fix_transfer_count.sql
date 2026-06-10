-- Re-seed 1000 sample transfers and items (plain SQL produced only ~100)
-- Removes existing TR-SAMPLE-* transfers first, then inserts 1000.

-- Silence audit triggers during bulk manipulation
alter table public.serial_numbers disable trigger trg_audit_serial_numbers;
alter table public.transfers        disable trigger trg_audit_transfers;
alter table public.transfer_items   disable trigger trg_serial_status_on_transfer_item;

do $$
declare
  v_dc_id       uuid;
  v_site_ids    uuid[] := '{}';
  v_prof_ids    uuid[] := '{}';
  v_part_ids    uuid[] := '{}';
  v_prefix      text;
  v_dest_id     uuid;
  v_prof_id     uuid;
  v_part_id     uuid;
  v_created_at  timestamptz;
  v_status      text;
  v_count       int;
begin
  -- Clean up old sample transfers
  delete from public.transfer_items
  where transfer_id in (select id from public.transfers where transfer_no like 'TR-SAMPLE-%');
  delete from public.transfers where transfer_no like 'TR-SAMPLE-%';

  select id into v_dc_id from public.sites where is_dc = true limit 1;
  select array_agg(id order by id) into v_site_ids from public.sites where is_dc = false and is_active = true;
  select array_agg(id order by id) into v_prof_ids from public.profiles where role in ('dc_admin', 'dc_operator') and is_active = true;
  select array_agg(id order by id) into v_part_ids from public.parts where is_active = true;
  select invoice_prefix into v_prefix from public.sites where id = v_dc_id;

  if array_length(v_site_ids, 1) is null then
    raise exception 'No non-DC sites found.';
  end if;
  if array_length(v_prof_ids, 1) is null then
    raise exception 'No dc_admin/dc_operator profiles found.';
  end if;
  if array_length(v_part_ids, 1) is null then
    raise exception 'No active parts found.';
  end if;

  for i in 1..1000 loop
    v_dest_id    := v_site_ids[1 + ((i - 1) % array_length(v_site_ids, 1))];
    v_prof_id    := v_prof_ids[1 + ((i - 1) % array_length(v_prof_ids, 1))];
    v_created_at := now() - ((random() * 120 || ' days')::interval);
    v_status     := case
      when random() < 0.35 then 'received'
      when random() < 0.60 then 'in_transit'
      when random() < 0.80 then 'packed'
      when random() < 0.92 then 'draft'
      else 'cancelled'
    end;

    insert into public.transfers (id, transfer_no, source_site_id, destination_site_id,
      status, requested_by, packed_by, packed_at, invoice_ref, created_at, updated_at)
    values (
      md5('transfer-' || i::text || '-seed')::uuid,
      'TR-SAMPLE-' || lpad(i::text, 4, '0'),
      v_dc_id, v_dest_id, v_status,
      v_prof_id,
      case when v_status in ('packed', 'in_transit', 'received') then v_prof_id else null end,
      case when v_status in ('packed', 'in_transit', 'received') then v_created_at + interval '1 hour' else null end,
      case when v_status in ('packed', 'in_transit', 'received')
        then v_prefix || '-' || to_char(v_created_at, 'YYYYMMDD') || '-' || chr(65 + (i % 26)) || lpad((i % 999)::text, 3, '0')
        else null end,
      v_created_at, v_created_at
    );
  end loop;

  -- Re-add transfer items (1-5 per transfer)
  for i in 1..1000 loop
    for j in 1..(1 + floor(random() * 5)) loop
      v_part_id := v_part_ids[1 + floor(random() * array_length(v_part_ids, 1))];
      insert into public.transfer_items (id, transfer_id, part_id, qty)
      values (
        md5('ti-seed-' || i::text || '-' || j::text)::uuid,
        md5('transfer-' || i::text || '-seed')::uuid,
        v_part_id,
        1 + floor(random() * 19)
      );
    end loop;
  end loop;

  select count(*) into v_count from public.transfers where transfer_no like 'TR-SAMPLE-%';
  raise notice 'Seeded % transfers and items.', v_count;
end;
$$;

-- Refresh snapshot
refresh materialized view public.inventory_snapshot;

-- Re-enable triggers
alter table public.serial_numbers enable trigger trg_audit_serial_numbers;
alter table public.transfers        enable trigger trg_audit_transfers;
alter table public.transfer_items   enable trigger trg_serial_status_on_transfer_item;
