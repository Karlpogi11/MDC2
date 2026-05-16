-- Fix: rename public.current_role() to avoid conflict with Postgres built-in current_role
-- Drop all dependent policies first, then drop the function, then recreate everything

-- Drop ALL old policies that depend on current_role()
drop policy if exists read_all_dc_profiles on public.profiles;
drop policy if exists read_profiles_system_admin on public.profiles;
drop policy if exists write_profiles_system_admin on public.profiles;
drop policy if exists read_all_dc_sites on public.sites;
drop policy if exists read_all_dc_parts on public.parts;
drop policy if exists read_all_dc_stock_batches on public.stock_in_batches;
drop policy if exists write_admin_operator_stock_batches on public.stock_in_batches;
drop policy if exists read_all_dc_serials on public.serial_numbers;
drop policy if exists write_admin_operator_serials on public.serial_numbers;
drop policy if exists read_all_dc_stock_items on public.stock_in_items;
drop policy if exists write_admin_operator_stock_items on public.stock_in_items;
drop policy if exists read_all_dc_transfers on public.transfers;
drop policy if exists write_admin_operator_transfers on public.transfers;
drop policy if exists read_all_dc_transfer_items on public.transfer_items;
drop policy if exists write_admin_operator_transfer_items on public.transfer_items;
drop policy if exists read_all_dc_packing_lists on public.packing_lists;
drop policy if exists write_admin_operator_packing_lists on public.packing_lists;
drop policy if exists read_all_dc_serial_corrections on public.serial_corrections;
drop policy if exists write_admin_only_serial_corrections on public.serial_corrections;
drop policy if exists read_all_dc_analytics_uploads on public.analytics_uploads;
drop policy if exists write_admin_operator_analytics_uploads on public.analytics_uploads;
drop policy if exists read_all_dc_analytics_rows on public.analytics_rows;
drop policy if exists write_admin_operator_analytics_rows on public.analytics_rows;
drop policy if exists read_all_dc_audit_logs on public.audit_logs;
drop policy if exists write_all_dc_audit_logs on public.audit_logs;
drop policy if exists app_config_read on public.app_config;
drop policy if exists app_config_write on public.app_config;

-- Now safe to drop the conflicting function
drop function if exists public.current_role();

-- Recreate with a non-conflicting name
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
as $$
  select role from public.profiles where id = auth.uid() limit 1;
$$;

grant execute on function public.get_my_role() to authenticated;

-- Drop and recreate all RLS policies that used current_role()

-- profiles
drop policy if exists read_all_dc_profiles on public.profiles;
drop policy if exists read_profiles_system_admin on public.profiles;
drop policy if exists write_profiles_system_admin on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.get_my_role() in ('system_admin', 'dc_admin', 'dc_operator', 'dc_viewer')
  );

create policy profiles_insert_system_admin on public.profiles
  for insert to authenticated
  with check (public.get_my_role() = 'system_admin');

create policy profiles_update_system_admin on public.profiles
  for update to authenticated
  using (public.get_my_role() = 'system_admin')
  with check (public.get_my_role() = 'system_admin');

-- sites
drop policy if exists read_all_dc_sites on public.sites;
create policy sites_select on public.sites
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

-- parts
drop policy if exists read_all_dc_parts on public.parts;
create policy parts_select on public.parts
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

-- stock_in_batches
drop policy if exists read_all_dc_stock_batches on public.stock_in_batches;
drop policy if exists write_admin_operator_stock_batches on public.stock_in_batches;
create policy stock_batches_select on public.stock_in_batches
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy stock_batches_write on public.stock_in_batches
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- serial_numbers
drop policy if exists read_all_dc_serials on public.serial_numbers;
drop policy if exists write_admin_operator_serials on public.serial_numbers;
create policy serials_select on public.serial_numbers
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy serials_write on public.serial_numbers
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- stock_in_items
drop policy if exists read_all_dc_stock_items on public.stock_in_items;
drop policy if exists write_admin_operator_stock_items on public.stock_in_items;
create policy stock_items_select on public.stock_in_items
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy stock_items_write on public.stock_in_items
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- transfers
drop policy if exists read_all_dc_transfers on public.transfers;
drop policy if exists write_admin_operator_transfers on public.transfers;
create policy transfers_select on public.transfers
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy transfers_write on public.transfers
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- transfer_items
drop policy if exists read_all_dc_transfer_items on public.transfer_items;
drop policy if exists write_admin_operator_transfer_items on public.transfer_items;
create policy transfer_items_select on public.transfer_items
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy transfer_items_write on public.transfer_items
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- packing_lists
drop policy if exists read_all_dc_packing_lists on public.packing_lists;
drop policy if exists write_admin_operator_packing_lists on public.packing_lists;
create policy packing_lists_select on public.packing_lists
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy packing_lists_write on public.packing_lists
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- serial_corrections
drop policy if exists read_all_dc_serial_corrections on public.serial_corrections;
drop policy if exists write_admin_only_serial_corrections on public.serial_corrections;
create policy serial_corrections_select on public.serial_corrections
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy serial_corrections_write on public.serial_corrections
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin'))
  with check (public.get_my_role() in ('system_admin','dc_admin'));

-- analytics_uploads
drop policy if exists read_all_dc_analytics_uploads on public.analytics_uploads;
drop policy if exists write_admin_operator_analytics_uploads on public.analytics_uploads;
create policy analytics_uploads_select on public.analytics_uploads
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy analytics_uploads_write on public.analytics_uploads
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- analytics_rows
drop policy if exists read_all_dc_analytics_rows on public.analytics_rows;
drop policy if exists write_admin_operator_analytics_rows on public.analytics_rows;
create policy analytics_rows_select on public.analytics_rows
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy analytics_rows_write on public.analytics_rows
  for all to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- audit_logs
drop policy if exists read_all_dc_audit_logs on public.audit_logs;
drop policy if exists write_all_dc_audit_logs on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

-- app_config
drop policy if exists app_config_read on public.app_config;
drop policy if exists app_config_write on public.app_config;
create policy app_config_select on public.app_config
  for select to authenticated
  using (true);
create policy app_config_write on public.app_config
  for all to authenticated
  using (public.get_my_role() = 'system_admin')
  with check (public.get_my_role() = 'system_admin');
