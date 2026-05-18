-- Add ship_to_code to sites for GSX Ship-To number mapping
alter table public.sites add column if not exists ship_to_code text;

create unique index if not exists idx_sites_ship_to_code on public.sites(ship_to_code) where ship_to_code is not null;
