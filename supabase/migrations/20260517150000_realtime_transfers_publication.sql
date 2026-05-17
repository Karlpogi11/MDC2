-- Add transfers and transfer_items to Supabase Realtime publication
-- so that inventory page updates live when transfers are created/updated.
alter publication supabase_realtime add table public.transfers;
alter publication supabase_realtime add table public.transfer_items;
