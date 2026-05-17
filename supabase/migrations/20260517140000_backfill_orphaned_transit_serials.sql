-- Backfill: fix serials stuck in 'transit' whose transfer is already received or cancelled.
-- This corrects any data inconsistency from before the trigger was reliable.

-- 1. Serials in transit but transfer is received → mark as transferred + set current_site_id
update public.serial_numbers sn
set
  status          = 'transferred',
  current_site_id = t.destination_site_id,
  updated_at      = now()
from public.transfer_items ti
join public.transfers t on t.id = ti.transfer_id
where ti.serial_id = sn.id
  and sn.status   = 'transit'
  and t.status    = 'received';

-- 2. Serials in transit but transfer is cancelled → restore to in_stock
update public.serial_numbers sn
set
  status     = 'in_stock',
  updated_at = now()
from public.transfer_items ti
join public.transfers t on t.id = ti.transfer_id
where ti.serial_id = sn.id
  and sn.status   = 'transit'
  and t.status    = 'cancelled';

-- 3. Serials still in_stock but have an active transfer_item in a non-cancelled/non-received transfer
--    (missed by trigger, e.g. serial_id was set after trigger fired) → mark as transit
update public.serial_numbers sn
set
  status     = 'transit',
  updated_at = now()
from public.transfer_items ti
join public.transfers t on t.id = ti.transfer_id
where ti.serial_id = sn.id
  and sn.status   = 'in_stock'
  and t.status    not in ('received', 'cancelled');
