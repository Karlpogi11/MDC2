-- ─────────────────────────────────────────────────────────────────────────────
-- RLS Security Fixes
-- 1. audit_logs INSERT: remove dc_viewer (viewers must not write audit records)
-- 2. serial_corrections: block UPDATE entirely (immutable audit trail)
-- 3. profiles UPDATE: only self-update allowed (cannot self-promote role)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Fix audit_logs INSERT — dc_viewer removed
drop policy if exists audit_logs_insert on public.audit_logs;
drop policy if exists audit_logs_write on public.audit_logs;

create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin', 'dc_admin', 'dc_operator'));

-- 2. Block UPDATE on serial_corrections (immutable — no policy = no access)
drop policy if exists serial_corrections_update on public.serial_corrections;
-- Explicitly deny: no UPDATE policy means RLS blocks it entirely when RLS is enabled.
-- Belt-and-suspenders: revoke via a deny policy is not needed in Postgres RLS —
-- absence of a permissive UPDATE policy is sufficient. Confirmed no UPDATE policy exists.

-- 3. profiles UPDATE: allow users to update only their own row,
--    but prevent self-promotion of role (role column must stay unchanged).
drop policy if exists profiles_update on public.profiles;

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    -- system_admin can update any profile
    public.get_my_claim_role() = 'system_admin'
    or
    -- others can only update their own row
    id = auth.uid()
  )
  with check (
    -- system_admin can set any role
    public.get_my_claim_role() = 'system_admin'
    or
    -- non-admins cannot change their own role (role must match current DB value)
    (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()))
  );
