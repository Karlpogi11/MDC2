-- Add updated_at column and trigger to parts and sites

alter table public.parts
  add column if not exists updated_at timestamptz not null default now();

alter table public.sites
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_parts_updated_at on public.parts;
create trigger set_parts_updated_at
  before update on public.parts
  for each row execute function public.set_updated_at();

drop trigger if exists set_sites_updated_at on public.sites;
create trigger set_sites_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();
