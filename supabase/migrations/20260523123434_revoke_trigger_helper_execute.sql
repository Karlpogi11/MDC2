-- Trigger helpers should run only through their owning triggers, not as
-- directly callable client RPC functions.

revoke execute on function public.fill_part_snapshot() from anon, authenticated, public;
grant execute on function public.fill_part_snapshot() to service_role;
