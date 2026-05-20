-- Fix create_transfer_from_template: use generate_invoice_ref instead of TPL-NNNN
create or replace function public.create_transfer_from_template(p_template_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  tmpl          record;
  dc_site_id    uuid;
  new_id        uuid;
  v_invoice_ref text;
  v_transfer_no text;
  item          record;
begin
  select t.*
  into tmpl
  from public.transfer_templates t
  where t.id = p_template_id and t.is_active = true;

  if not found then return null; end if;

  select id into dc_site_id from public.sites where is_dc = true limit 1;

  v_transfer_no := 'TR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((floor(random()*9000)+1000)::text, 4, '0');

  insert into public.transfers (
    transfer_no, source_site_id, destination_site_id, status, requested_by
  ) values (
    v_transfer_no, dc_site_id, tmpl.destination_site_id, 'draft', tmpl.created_by
  ) returning id into new_id;

  select public.generate_invoice_ref(dc_site_id) into v_invoice_ref;
  if v_invoice_ref is not null then
    update public.transfers set invoice_ref = v_invoice_ref where id = new_id;
  end if;

  for item in
    select * from public.transfer_template_items where template_id = p_template_id
  loop
    insert into public.transfer_items (transfer_id, part_id, qty)
    values (new_id, item.part_id, item.qty);
  end loop;

  return new_id;
end;
$$;
