-- Add invoice_prefix to sites for packing list / transfer document numbering
-- e.g. site Podium → prefix 'PODSSR' → generates PODSSR-0001, PODSSR-0002...

alter table public.sites
  add column if not exists invoice_prefix text;

-- No unique constraint — two sites could share a prefix (edge case allowed)
-- No NOT NULL — existing sites keep null until set by admin
