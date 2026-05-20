-- Fix audit_log_trigger: old_value was null for UPDATE rows.
-- Correct: capture OLD for both UPDATE and DELETE.

create or replace function public.audit_log_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_old   jsonb;
  v_new   jsonb;
begin
  begin
    v_actor := auth.uid();
  exception when others then
    v_actor := null;
  end;

  v_old := case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end;
  v_new := case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end;

  -- Skip no-op updates
  if TG_OP = 'UPDATE' and v_old = v_new then
    return NEW;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    v_actor,
    lower(TG_OP),
    TG_TABLE_NAME,
    coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid),
    v_old,
    v_new
  );

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;
