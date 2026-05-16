-- RLS Security Hardening
-- Fixes: N+1 role lookup, over-permissive profile reads, missing delete blocks,
--        serial void protection, and consolidates all policies cleanly.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Replace get_my_role() with a session-cached version to eliminate N+1
--    Each request calls this once; result is cached for the transaction.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_role()
returns text
language plpgsql
stable
security definer
as $$
declare
  v_role text;
begin
  -- Try session cache first (set per request by auth hook or first call)
  v_role := current_setting('app.user_role', true);
  if v_role is not null and v_role <> '' then
    return v_role;
  end if;
  -- Cache miss: query profiles and store in session
  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active = true
  limit 1;
  if v_role is not null then
    perform set_config('app.user_role', v_role, true); -- true = local to transaction
  end if;
  return v_role;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. profiles — tighten read: own row always; others only if admin/operator
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()  -- always can read own row (needed for session load)
    or public.get_my_role() in ('system_admin', 'dc_admin')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. serial_numbers — block hard delete; status='void' is the soft-delete
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists serials_write on public.serial_numbers;
drop policy if exists serials_select on public.serial_numbers;
drop policy if exists serials_insert on public.serial_numbers;
drop policy if exists serials_update on public.serial_numbers;

create policy serials_select on public.serial_numbers
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

create policy serials_insert on public.serial_numbers
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

create policy serials_update on public.serial_numbers
  for update to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- No DELETE policy = hard deletes blocked for everyone via RLS

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. serial_corrections — insert only (immutable); no update/delete
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists serial_corrections_write on public.serial_corrections;
drop policy if exists serial_corrections_select on public.serial_corrections;
drop policy if exists serial_corrections_insert on public.serial_corrections;

create policy serial_corrections_insert on public.serial_corrections
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin'));

-- No UPDATE or DELETE = corrections are immutable

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. audit_logs — insert only (immutable); no update/delete
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists audit_logs_insert on public.audit_logs;

create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

-- No UPDATE or DELETE = audit trail is immutable

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. transfers
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists transfers_write on public.transfers;
drop policy if exists transfers_insert on public.transfers;
drop policy if exists transfers_update on public.transfers;
drop policy if exists transfers_delete on public.transfers;

create policy transfers_insert on public.transfers
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

create policy transfers_update on public.transfers
  for update to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator'))
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- Only system_admin can delete draft transfers (cleanup); packed+ cannot be deleted
create policy transfers_delete on public.transfers
  for delete to authenticated
  using (
    public.get_my_role() = 'system_admin'
    and status = 'draft'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. parts
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists parts_write on public.parts;
drop policy if exists parts_insert on public.parts;
drop policy if exists parts_update on public.parts;

create policy parts_insert on public.parts
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin'));

create policy parts_update on public.parts
  for update to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin'))
  with check (public.get_my_role() in ('system_admin','dc_admin'));

-- No DELETE = parts are disabled via is_active, never hard-deleted

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. sites
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists sites_write on public.sites;
drop policy if exists sites_insert on public.sites;
drop policy if exists sites_update on public.sites;

create policy sites_insert on public.sites
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin'));

create policy sites_update on public.sites
  for update to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin'))
  with check (public.get_my_role() in ('system_admin','dc_admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. packing_lists — insert by operator+; no update/delete (immutable docs)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists packing_lists_write on public.packing_lists;
drop policy if exists packing_lists_select on public.packing_lists;
drop policy if exists packing_lists_insert on public.packing_lists;

create policy packing_lists_insert on public.packing_lists
  for insert to authenticated
  with check (public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

create policy packing_lists_select on public.packing_lists
  for select to authenticated
  using (public.get_my_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Ensure anon role cannot access any table (belt-and-suspenders)
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Re-grant only what anon legitimately needs (app_config for login branding)
grant select on public.app_config to anon;

-- get_my_role and get_email_for_username remain callable by anon
-- (already granted in previous migrations)
