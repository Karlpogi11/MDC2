-- Add contact_emails array to sites (multiple recipients, first = TO, rest = CC)
alter table public.sites
  add column if not exists contact_emails text[] not null default '{}';

-- Add receipt token to transfers for passwordless receipt confirmation
alter table public.transfers
  add column if not exists receipt_token text unique,
  add column if not exists receipt_token_expires_at timestamptz;

create index if not exists idx_transfers_receipt_token
  on public.transfers(receipt_token)
  where receipt_token is not null;
