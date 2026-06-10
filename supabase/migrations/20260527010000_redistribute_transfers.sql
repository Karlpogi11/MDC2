-- Redistribute existing sample transfers across different destination sites

do $$
declare
  v_dc_id       uuid;
  v_site_ids    uuid[] := '{}';
  v_prof_ids    uuid[] := '{}';
  v_prefix      text;
  v_idx         int;
  rec           record;
begin
  select id into v_dc_id from public.sites where is_dc = true limit 1;
  select array_agg(id order by id) into v_site_ids from public.sites where is_dc = false and is_active = true;
  select array_agg(id order by id) into v_prof_ids from public.profiles where role in ('dc_admin', 'dc_operator') and is_active = true;
  select invoice_prefix into v_prefix from public.sites where id = v_dc_id;

  if array_length(v_site_ids, 1) is null then
    raise notice 'No non-DC sites found, skipping.';
    return;
  end if;

  for rec in select id, transfer_no, status, created_at
             from public.transfers
             where transfer_no like 'TR-SAMPLE-%'
             order by transfer_no
  loop
    v_idx := substring(rec.transfer_no from 'TR-SAMPLE-(\d{4})')::int;
    if v_idx is null then continue; end if;

    update public.transfers
    set
      destination_site_id = v_site_ids[1 + ((v_idx - 1) % array_length(v_site_ids, 1))],
      requested_by        = v_prof_ids[1 + ((v_idx - 1) % array_length(v_prof_ids, 1))],
      packed_by           = case
                              when rec.status in ('packed', 'in_transit', 'received')
                                then v_prof_ids[1 + ((v_idx - 1) % array_length(v_prof_ids, 1))]
                              else null
                            end,
      invoice_ref         = case
                              when rec.status in ('packed', 'in_transit', 'received')
                                then v_prefix || '-' || to_char(rec.created_at, 'YYYYMMDD') || '-' ||
                                     chr(65 + (v_idx % 26)) || lpad((v_idx % 999)::text, 3, '0')
                              else null
                            end
    where id = rec.id;
  end loop;

  raise notice 'Redistributed transfers across sites.';
end;
$$;
