-- Trigger: when a serial is added to transfer_items, mark it as 'transit'
-- Reverse: when transfer is cancelled, restore serials to 'in_stock'

create or replace function public.sync_serial_status_on_transfer()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' then
    -- Mark serial as in transit when added to a transfer
    if NEW.serial_id is not null then
      update public.serial_numbers
      set status = 'transit', updated_at = now()
      where id = NEW.serial_id and status = 'in_stock';
    end if;
    return NEW;

  elsif TG_OP = 'DELETE' then
    -- Restore serial to in_stock when removed from transfer
    if OLD.serial_id is not null then
      update public.serial_numbers
      set status = 'in_stock', updated_at = now()
      where id = OLD.serial_id and status = 'transit';
    end if;
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_serial_status_on_transfer_item on public.transfer_items;
create trigger trg_serial_status_on_transfer_item
  after insert or delete on public.transfer_items
  for each row execute function public.sync_serial_status_on_transfer();

-- Trigger: when transfer status changes to 'received', mark serials as 'transferred'
-- When cancelled, restore to 'in_stock'
create or replace function public.sync_serial_status_on_transfer_status()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.status = 'received' and OLD.status != 'received' then
    update public.serial_numbers sn
    set status = 'transferred', updated_at = now()
    from public.transfer_items ti
    where ti.transfer_id = NEW.id
      and ti.serial_id = sn.id
      and sn.status = 'transit';

  elsif NEW.status = 'cancelled' and OLD.status in ('draft','packed','in_transit') then
    update public.serial_numbers sn
    set status = 'in_stock', updated_at = now()
    from public.transfer_items ti
    where ti.transfer_id = NEW.id
      and ti.serial_id = sn.id
      and sn.status = 'transit';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_serial_status_on_transfer_status on public.transfers;
create trigger trg_serial_status_on_transfer_status
  after update of status on public.transfers
  for each row execute function public.sync_serial_status_on_transfer_status();
