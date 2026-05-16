-- ─────────────────────────────────────────────────────────────────────────────
-- JWT Custom Claims Hook + RLS Policy Rewrite
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Hook function injected into JWT on every token mint
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_claims jsonb;
begin
  select role into v_role
  from public.profiles
  where id = (event->>'user_id')::uuid and is_active = true
  limit 1;

  v_claims := coalesce(event->'claims', '{}'::jsonb);
  if v_role is not null then
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_role));
  end if;
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- 2. Helper: JWT claim with fallback to profiles SELECT for old sessions
create or replace function public.get_my_claim_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'user_role', ''),
    public.get_my_role()
  );
$$;

grant execute on function public.get_my_claim_role() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Drop ALL existing policies (every name from every prior migration)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists read_all_dc_profiles on public.profiles;
drop policy if exists profiles_select on public.profiles;

drop policy if exists read_all_dc_sites on public.sites;
drop policy if exists sites_select on public.sites;
drop policy if exists sites_insert on public.sites;
drop policy if exists sites_update on public.sites;
drop policy if exists sites_write on public.sites;

drop policy if exists read_all_dc_parts on public.parts;
drop policy if exists parts_select on public.parts;
drop policy if exists parts_insert on public.parts;
drop policy if exists parts_update on public.parts;
drop policy if exists parts_write on public.parts;

drop policy if exists read_all_dc_stock_batches on public.stock_in_batches;
drop policy if exists stock_batches_select on public.stock_in_batches;
drop policy if exists write_admin_operator_stock_batches on public.stock_in_batches;
drop policy if exists stock_batches_write on public.stock_in_batches;

drop policy if exists read_all_dc_serials on public.serial_numbers;
drop policy if exists serials_select on public.serial_numbers;
drop policy if exists write_admin_operator_serials on public.serial_numbers;
drop policy if exists serials_insert on public.serial_numbers;
drop policy if exists serials_update on public.serial_numbers;
drop policy if exists serials_write on public.serial_numbers;

drop policy if exists read_all_dc_stock_items on public.stock_in_items;
drop policy if exists stock_items_select on public.stock_in_items;
drop policy if exists write_admin_operator_stock_items on public.stock_in_items;
drop policy if exists stock_items_write on public.stock_in_items;

drop policy if exists read_all_dc_transfers on public.transfers;
drop policy if exists transfers_select on public.transfers;
drop policy if exists write_admin_operator_transfers on public.transfers;
drop policy if exists transfers_insert on public.transfers;
drop policy if exists transfers_update on public.transfers;
drop policy if exists transfers_delete on public.transfers;
drop policy if exists transfers_write on public.transfers;

drop policy if exists read_all_dc_transfer_items on public.transfer_items;
drop policy if exists transfer_items_select on public.transfer_items;
drop policy if exists write_admin_operator_transfer_items on public.transfer_items;
drop policy if exists transfer_items_write on public.transfer_items;

drop policy if exists read_all_dc_packing_lists on public.packing_lists;
drop policy if exists packing_lists_select on public.packing_lists;
drop policy if exists write_admin_operator_packing_lists on public.packing_lists;
drop policy if exists packing_lists_insert on public.packing_lists;
drop policy if exists packing_lists_write on public.packing_lists;

drop policy if exists read_all_dc_serial_corrections on public.serial_corrections;
drop policy if exists serial_corrections_select on public.serial_corrections;
drop policy if exists write_admin_only_serial_corrections on public.serial_corrections;
drop policy if exists serial_corrections_insert on public.serial_corrections;
drop policy if exists serial_corrections_write on public.serial_corrections;

drop policy if exists read_all_dc_analytics_uploads on public.analytics_uploads;
drop policy if exists analytics_uploads_select on public.analytics_uploads;
drop policy if exists write_admin_operator_analytics_uploads on public.analytics_uploads;
drop policy if exists analytics_uploads_write on public.analytics_uploads;

drop policy if exists read_all_dc_analytics_rows on public.analytics_rows;
drop policy if exists analytics_rows_select on public.analytics_rows;
drop policy if exists write_admin_operator_analytics_rows on public.analytics_rows;
drop policy if exists analytics_rows_write on public.analytics_rows;

drop policy if exists read_all_dc_audit_logs on public.audit_logs;
drop policy if exists audit_logs_select on public.audit_logs;
drop policy if exists write_all_dc_audit_logs on public.audit_logs;
drop policy if exists audit_logs_insert on public.audit_logs;
drop policy if exists audit_logs_write on public.audit_logs;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Recreate all policies using get_my_claim_role() (zero DB round-trip)
-- ─────────────────────────────────────────────────────────────────────────────

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.get_my_claim_role() in ('system_admin','dc_admin'));

create policy sites_select on public.sites
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy sites_insert on public.sites
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));
create policy sites_update on public.sites
  for update to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

create policy parts_select on public.parts
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy parts_insert on public.parts
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));
create policy parts_update on public.parts
  for update to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

create policy stock_batches_select on public.stock_in_batches
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy stock_batches_write on public.stock_in_batches
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy serials_select on public.serial_numbers
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy serials_insert on public.serial_numbers
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));
create policy serials_update on public.serial_numbers
  for update to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy stock_items_select on public.stock_in_items
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy stock_items_write on public.stock_in_items
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy transfers_select on public.transfers
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy transfers_insert on public.transfers
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));
create policy transfers_update on public.transfers
  for update to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));
create policy transfers_delete on public.transfers
  for delete to authenticated
  using (public.get_my_claim_role() = 'system_admin' and status = 'draft');

create policy transfer_items_select on public.transfer_items
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy transfer_items_write on public.transfer_items
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy packing_lists_select on public.packing_lists
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy packing_lists_insert on public.packing_lists
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy serial_corrections_select on public.serial_corrections
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy serial_corrections_insert on public.serial_corrections
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

create policy analytics_uploads_select on public.analytics_uploads
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy analytics_uploads_write on public.analytics_uploads
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy analytics_rows_select on public.analytics_rows
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy analytics_rows_write on public.analytics_rows
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));
