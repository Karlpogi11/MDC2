-- Allow dc_admin to update other users' profiles (including role changes)
drop policy if exists profiles_update on public.profiles;

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    public.get_my_claim_role() in ('system_admin', 'dc_admin')
    or id = auth.uid()
  )
  with check (
    -- system_admin and dc_admin can set any role
    public.get_my_claim_role() in ('system_admin', 'dc_admin')
    or
    -- non-admins cannot change their own role
    (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()))
  );
