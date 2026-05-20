-- Speed up reserved-item lookups by part (Inventory + Reserved drawer)
-- Query pattern:
--   transfer_items filtered by part_id
--   joined to transfers by transfer_id and status
--   optional serial_id projection

create index if not exists idx_transfer_items_part_id
  on public.transfer_items(part_id);

create index if not exists idx_transfer_items_part_transfer_id
  on public.transfer_items(part_id, transfer_id);

create index if not exists idx_transfer_items_part_serial_not_null
  on public.transfer_items(part_id, serial_id)
  where serial_id is not null;
