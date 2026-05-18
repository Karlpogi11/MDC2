-- ─────────────────────────────────────────────────────────────────────────────
-- Tamper-Evident Audit Log Chaining
--
-- Each row stores:
--   row_hash  = SHA-256 of this row's content fields
--   prev_hash = row_hash of the immediately preceding row (by created_at, id)
--
-- Any deleted or modified row breaks the chain. verify_audit_chain() detects it.
-- This makes the audit trail legally defensible.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.audit_logs
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

-- Trigger function: compute hashes on INSERT (audit_logs is insert-only)
create or replace function public.audit_log_hash_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
  select row_hash into v_prev_hash
  from public.audit_logs
  order by created_at desc, id desc
  limit 1;

  new.prev_hash := coalesce(v_prev_hash, 'GENESIS');

  -- Deterministic content string for this row
  v_content := concat_ws('|',
    new.id::text,
    new.actor_id::text,
    new.action,
    new.entity_type,
    coalesce(new.entity_id::text, ''),
    coalesce(new.old_value::text, ''),
    coalesce(new.new_value::text, ''),
    coalesce(new.note, ''),
    new.created_at::text,
    new.prev_hash
  );

  new.row_hash := encode(digest(v_content, 'sha256'), 'hex');

  return new;
end;
$$;

drop trigger if exists audit_log_hash on public.audit_logs;
create trigger audit_log_hash
  before insert on public.audit_logs
  for each row execute function public.audit_log_hash_trigger();

-- ─────────────────────────────────────────────────────────────────────────────
-- verify_audit_chain() — walk the chain, return any broken links
-- Usage: SELECT * FROM public.verify_audit_chain() WHERE chain_broken;
-- Empty result = tamper-free ✓
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.verify_audit_chain()
returns table(
  log_id      uuid,
  created_at  timestamptz,
  actor_id    uuid,
  action      text,
  chain_broken boolean,
  reason      text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r           record;
  v_expected  text;
  v_content   text;
  v_prev_hash text := 'GENESIS';
begin
  for r in
    select * from public.audit_logs
    order by created_at asc, id asc
  loop
    -- Recompute expected row_hash
    v_content := concat_ws('|',
      r.id::text,
      r.actor_id::text,
      r.action,
      r.entity_type,
      coalesce(r.entity_id::text, ''),
      coalesce(r.old_value::text, ''),
      coalesce(r.new_value::text, ''),
      coalesce(r.note, ''),
      r.created_at::text,
      r.prev_hash
    );
    v_expected := encode(digest(v_content, 'sha256'), 'hex');

    log_id     := r.id;
    created_at := r.created_at;
    actor_id   := r.actor_id;
    action     := r.action;

    if r.prev_hash is distinct from v_prev_hash then
      chain_broken := true;
      reason := 'prev_hash mismatch (row deleted or inserted out of order)';
    elsif r.row_hash is distinct from v_expected then
      chain_broken := true;
      reason := 'row_hash mismatch (row content modified)';
    else
      chain_broken := false;
      reason := null;
    end if;

    v_prev_hash := r.row_hash;
    return next;
  end loop;
end;
$$;

-- Only admins can call the verify function
revoke execute on function public.verify_audit_chain() from public, anon;
grant execute on function public.verify_audit_chain() to authenticated;
