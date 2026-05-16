-- Allow system_admin to write to parts and sites tables

create policy parts_write on public.parts
  for all to authenticated
  using (public.get_my_role() in ('system_admin', 'dc_admin'))
  with check (public.get_my_role() in ('system_admin', 'dc_admin'));

create policy sites_write on public.sites
  for all to authenticated
  using (public.get_my_role() in ('system_admin', 'dc_admin'))
  with check (public.get_my_role() in ('system_admin', 'dc_admin'));
