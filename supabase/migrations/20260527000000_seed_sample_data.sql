-- Seed sample data for testing/demo
-- Safe to re-run. Only plain SQL, no DO blocks.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Ensure pgcrypto extension is available for digest() in audit_log_hash
-- ═══════════════════════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Temporarily disable audit/auto triggers that interfere with seeding
-- ═══════════════════════════════════════════════════════════════════════════════
alter table public.serial_numbers disable trigger trg_audit_serial_numbers;
alter table public.transfer_items   disable trigger trg_serial_status_on_transfer_item;
alter table public.transfers        disable trigger trg_audit_transfers;

-- Fix ensure_transfer_receipt_token() which uses gen_random_bytes (not available)
create or replace function public.ensure_transfer_receipt_token()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.receipt_token is null then
    NEW.receipt_token := md5(random()::text || clock_timestamp()::text);
  end if;
  return NEW;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Seed data
-- ═══════════════════════════════════════════════════════════════════════════════

-- 3a. Ensure DC site exists
insert into public.sites (id, site_code, site_name, is_dc, is_active, invoice_prefix)
select md5('dc-mnl-site')::uuid, 'DC-MNL', 'Makati Distribution Center', true, true, 'DC'
where not exists (select 1 from public.sites where is_dc = true);

-- 3b. Seed serial numbers (stock-in) — 15 per active part
insert into public.serial_numbers (id, serial_number, part_id, current_site_id, status, stock_in_at)
select
  md5(concat_ws('-', 'sn-seed', p.id::text, s.i::text))::uuid,
  'SN-TEST-' || p.part_number || '-' || s.i,
  p.id,
  dc.id,
  'in_stock',
  now() - ((random() * 180 || ' days')::interval)
from public.parts p
cross join (select generate_series(1, 15) as i) s
cross join lateral (select id from public.sites where is_dc = true limit 1) dc
where p.is_active = true
  and not exists (
    select 1 from public.serial_numbers sn
    where sn.part_id = p.id
      and sn.serial_number = 'SN-TEST-' || p.part_number || '-' || s.i
  );

-- 3c. Seed transfers — 1000 transfers, sites distributed by modulo
do $$
declare
  v_dc_id       uuid;
  v_site_ids    uuid[] := '{}';
  v_prof_ids    uuid[] := '{}';
  v_part_ids    uuid[] := '{}';
  v_prefix      text;
  v_dest_id     uuid;
  v_prof_id     uuid;
  v_created_at  timestamptz;
  v_status      text;
begin
  select id into v_dc_id from public.sites where is_dc = true limit 1;
  select array_agg(id order by id) into v_site_ids from public.sites where is_dc = false and is_active = true;
  select array_agg(id order by id) into v_prof_ids from public.profiles where role in ('dc_admin', 'dc_operator') and is_active = true;
  select array_agg(id order by id) into v_part_ids from public.parts where is_active = true;
  select invoice_prefix into v_prefix from public.sites where id = v_dc_id;

  if array_length(v_site_ids, 1) is null or array_length(v_prof_ids, 1) is null then
    raise exception 'Need at least one non-DC site and one dc_admin/dc_operator profile.';
  end if;

  if (select count(*) from public.transfers) >= 1000 then
    raise notice 'Already have 1000+ transfers, skipping.';
    return;
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
    )
    on conflict (transfer_no) do nothing;
  end loop;
  raise notice 'Seeded 1000 transfers.';
end;
$$;

-- 3d. Seed transfer items — 1-5 items per transfer
insert into public.transfer_items (id, transfer_id, part_id, qty)
select
  md5('ti-' || t.id::text || '-' || j::text)::uuid,
  t.id,
  parts.id,
  1 + (random() * 19)::int
from public.transfers t
cross join generate_series(1, 5) j
cross join lateral (select id from public.parts where is_active = true order by random() limit 1) parts
where j <= 1 + (random() * 4)::int
  and not exists (
    select 1 from public.transfer_items ti
    where ti.transfer_id = t.id
      and ti.id = md5('ti-' || t.id::text || '-' || j::text)::uuid
  )
limit 5000;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3e. Refresh inventory_snapshot
-- ═══════════════════════════════════════════════════════════════════════════════
refresh materialized view public.inventory_snapshot;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Re-enable triggers
-- ═══════════════════════════════════════════════════════════════════════════════
alter table public.serial_numbers enable trigger trg_audit_serial_numbers;
alter table public.transfers        enable trigger trg_audit_transfers;
alter table public.transfer_items   enable trigger trg_serial_status_on_transfer_item;
