-- Indexes needed for export queries (date range filters)

create index if not exists idx_stock_in_batches_imported_at
  on public.stock_in_batches (imported_at desc);

create index if not exists idx_serial_numbers_stock_in_at
  on public.serial_numbers (stock_in_at desc);

create index if not exists idx_transfers_created_at
  on public.transfers (created_at desc);

create index if not exists idx_analytics_uploads_uploaded_at
  on public.analytics_uploads (uploaded_at desc);

-- Add status column to analytics_uploads for processing state
alter table public.analytics_uploads
  add column if not exists status text not null default 'pending'
  check (status in ('pending','processing','done','error'));

alter table public.analytics_uploads
  add column if not exists error_message text;
