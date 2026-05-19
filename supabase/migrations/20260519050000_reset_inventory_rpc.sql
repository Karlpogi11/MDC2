create or replace function public.reset_inventory_data()
returns void language plpgsql security definer as $$
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges';
  end if;
  delete from public.stock_in_items;
  delete from public.transfer_items;
  delete from public.serial_numbers;
  delete from public.stock_in_batches;
  delete from public.transfers;
  delete from public.parts;
end;
$$;

grant execute on function public.reset_inventory_data() to authenticated;
