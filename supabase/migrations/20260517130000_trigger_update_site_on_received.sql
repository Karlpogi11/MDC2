-- Update sync_serial_status_on_transfer_status trigger to also set current_site_id
-- when a transfer is marked received, so serials reflect their new location.
create or replace function public.sync_serial_status_on_transfer_status()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.status = 'received' and OLD.status != 'received' then
    update public.serial_numbers sn
    set status          = 'transferred',
        current_site_id = NEW.destination_site_id,
        updated_at      = now()
    from public.transfer_items ti
    where ti.transfer_id = NEW.id
      and ti.serial_id   = sn.id
      and sn.status      = 'transit';

  elsif NEW.status = 'cancelled' and OLD.status in ('draft','packed','in_transit') then
    update public.serial_numbers sn
    set status     = 'in_stock',
        updated_at = now()
    from public.transfer_items ti
    where ti.transfer_id = NEW.id
      and ti.serial_id   = sn.id
      and sn.status      = 'transit';
  end if;
  return NEW;
end;
$$;
