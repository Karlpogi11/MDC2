-- Backfill receipt_token for any in_transit transfers that have none
-- (caused by the gen_random_bytes failure before the fix).
update public.transfers
set
  receipt_token            = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  receipt_token_expires_at = now() + interval '30 days'
where status = 'in_transit'
  and receipt_token is null;
