-- Chain-of-custody: write an audit_logs entry for every serial stocked in.
-- actor_id is resolved from the batch's imported_by; falls back to a system
-- sentinel UUID when the batch row is not yet visible (e.g. bulk insert order).

create or replace function public.audit_serial_stock_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  -- Resolve actor from the batch that owns this serial
  select imported_by into v_actor_id
  from public.stock_in_batches
  where id = NEW.stock_in_batch_id;

  -- Skip if no actor can be resolved (bulk seed rows, etc.)
  if v_actor_id is null then
    return NEW;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (
    v_actor_id,
    'stock_in',
    'serial_number',
    NEW.id,
    jsonb_build_object(
      'serial_number', NEW.serial_number,
      'part_id',       NEW.part_id,
      'site_id',       NEW.current_site_id,
      'batch_id',      NEW.stock_in_batch_id,
      'status',        NEW.status
    )
  );

  return NEW;
end;
$$;

drop trigger if exists trg_audit_serial_stock_in on public.serial_numbers;
create trigger trg_audit_serial_stock_in
  after insert on public.serial_numbers
  for each row
  when (NEW.stock_in_batch_id is not null)
  execute function public.audit_serial_stock_in();
