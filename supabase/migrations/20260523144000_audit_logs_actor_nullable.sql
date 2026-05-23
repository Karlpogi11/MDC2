-- Allow audit log entries from unauthenticated actions (e.g. token-based receipt confirmation).
alter table public.audit_logs
  alter column actor_id drop not null;
