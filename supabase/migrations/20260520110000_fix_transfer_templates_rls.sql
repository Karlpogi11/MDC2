-- Fix transfer_templates RLS: allow dc_admin + dc_operator + system_admin to write
-- Previously only dc_admin could insert/update/delete templates

drop policy if exists transfer_templates_write on public.transfer_templates;
drop policy if exists transfer_template_items_write on public.transfer_template_items;

create policy transfer_templates_write on public.transfer_templates
  for all to authenticated
  using (get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy transfer_template_items_write on public.transfer_template_items
  for all to authenticated
  using (get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));
