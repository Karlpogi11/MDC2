alter table public.transfers
  add column if not exists courier text,
  add column if not exists awb     text;
