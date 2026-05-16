-- Backfill: group all serials with no batch into one "backfill" batch
-- Uses the earliest stock_in_at as the imported_at timestamp

do $$
declare
  v_batch_id uuid;
  v_admin_id uuid;
  v_count int;
begin
  -- Only run if there are orphan serials
  select count(*) into v_count from public.serial_numbers where stock_in_batch_id is null;
  if v_count = 0 then return; end if;

  -- Use the first system_admin as the importer (fallback: any profile)
  select id into v_admin_id
  from public.profiles
  where role = 'system_admin'
  order by created_at
  limit 1;

  if v_admin_id is null then
    select id into v_admin_id from public.profiles order by created_at limit 1;
  end if;

  -- Create the backfill batch
  insert into public.stock_in_batches (
    source_type, source_file_name, imported_by, imported_at,
    total_rows, success_rows, failed_rows
  )
  select
    'manual',
    'backfill (pre-tracking)',
    v_admin_id,
    min(stock_in_at),
    count(*),
    count(*),
    0
  from public.serial_numbers
  where stock_in_batch_id is null
  returning id into v_batch_id;

  -- Link orphan serials to the backfill batch
  update public.serial_numbers
  set stock_in_batch_id = v_batch_id
  where stock_in_batch_id is null;

  -- Insert stock_in_items for each orphan serial
  insert into public.stock_in_items (batch_id, part_id, serial_id, quantity)
  select v_batch_id, part_id, id, 1
  from public.serial_numbers
  where stock_in_batch_id = v_batch_id;

end $$;
