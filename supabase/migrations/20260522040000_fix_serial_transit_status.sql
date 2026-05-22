-- Fix: trigger was using 'transit' but constraint requires 'in_transit'
create or replace function public.sync_serial_status_on_transfer()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.serial_id is not null then
      update public.serial_numbers
      set status = 'in_transit', updated_at = now()
      where id = NEW.serial_id and status = 'in_stock';
    end if;
    return NEW;

  elsif TG_OP = 'DELETE' then
    if OLD.serial_id is not null then
      update public.serial_numbers
      set status = 'in_stock', updated_at = now()
      where id = OLD.serial_id and status = 'in_transit';
    end if;
    return OLD;
  end if;
  return null;
end;
$$;
