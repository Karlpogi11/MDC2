-- View: full transfer history with denormalized part info
-- Works even when parts are retired (deleted_at IS NOT NULL)

create or replace view public.v_transfer_history as
select
  t.id              as transfer_id,
  t.transfer_no,
  t.status          as transfer_status,
  t.created_at      as transfer_date,
  src.site_code     as source_site,
  dst.site_code     as destination_site,
  ti.id             as item_id,
  ti.part_id,
  ti.part_number,
  ti.part_name,
  p.deleted_at      as part_retired_at,   -- null = active, non-null = retired
  sn.serial_number,
  sn.status         as serial_status,
  ti.qty
from public.transfers t
join public.sites src on src.id = t.source_site_id
join public.sites dst on dst.id = t.destination_site_id
join public.transfer_items ti on ti.transfer_id = t.id
left join public.parts p on p.id = ti.part_id          -- LEFT JOIN: survives hard delete
left join public.serial_numbers sn on sn.id = ti.serial_id;
