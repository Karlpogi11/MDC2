-- MDC standalone inventory core schema (starter)
-- NOTE: review in staging before applying to production.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique,
  role text not null check (role in ('dc_admin','dc_operator','dc_viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  site_code text not null unique,
  site_name text not null,
  is_dc boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  part_number text not null unique,
  part_name text not null,
  category text,
  average_cost numeric(12,2) default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_in_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('manual','csv','xlsx')),
  source_file_name text,
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now(),
  total_rows int not null default 0,
  success_rows int not null default 0,
  failed_rows int not null default 0
);

create table if not exists public.serial_numbers (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  part_id uuid not null references public.parts(id),
  current_site_id uuid not null references public.sites(id),
  status text not null check (status in ('in_stock','transit','transferred','consumed','void')) default 'in_stock',
  stock_in_batch_id uuid references public.stock_in_batches(id),
  stock_in_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_in_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.stock_in_batches(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  serial_id uuid references public.serial_numbers(id),
  quantity int not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null unique,
  source_site_id uuid not null references public.sites(id),
  destination_site_id uuid not null references public.sites(id),
  status text not null check (status in ('draft','packed','in_transit','received','cancelled')) default 'draft',
  requested_by uuid not null references public.profiles(id),
  packed_by uuid references public.profiles(id),
  packed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  serial_id uuid references public.serial_numbers(id),
  qty int not null default 1 check (qty > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.packing_lists (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null unique references public.transfers(id) on delete cascade,
  file_path text not null,
  generated_by uuid not null references public.profiles(id),
  generated_at timestamptz not null default now()
);

create table if not exists public.serial_corrections (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid references public.transfers(id),
  serial_id uuid references public.serial_numbers(id),
  old_serial_number text not null,
  new_serial_number text not null,
  reason text not null,
  corrected_by uuid not null references public.profiles(id),
  corrected_at timestamptz not null default now(),
  constraint serial_corrections_unique_new_serial unique(new_serial_number)
);

create table if not exists public.analytics_uploads (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('fixably','gsx')),
  file_name text not null,
  file_path text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  row_count int not null default 0
);

create table if not exists public.analytics_rows (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.analytics_uploads(id) on delete cascade,
  source_type text not null check (source_type in ('fixably','gsx')),
  part_number text not null,
  serial_number text,
  site_code text,
  used_at date,
  qty int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_serial_numbers_part_id on public.serial_numbers(part_id);
create index if not exists idx_serial_numbers_site_id on public.serial_numbers(current_site_id);
create index if not exists idx_transfer_items_transfer_id on public.transfer_items(transfer_id);
create index if not exists idx_analytics_rows_part_site_date on public.analytics_rows(part_number, site_code, used_at);

create or replace function public.current_role()
returns text
language sql
stable
as $$
  select role from public.profiles where id = auth.uid() limit 1;
$$;

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.parts enable row level security;
alter table public.stock_in_batches enable row level security;
alter table public.serial_numbers enable row level security;
alter table public.stock_in_items enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;
alter table public.packing_lists enable row level security;
alter table public.serial_corrections enable row level security;
alter table public.analytics_uploads enable row level security;
alter table public.analytics_rows enable row level security;
alter table public.audit_logs enable row level security;

-- Read policies
create policy read_all_dc_profiles on public.profiles
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_sites on public.sites
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_parts on public.parts
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_stock_batches on public.stock_in_batches
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_serials on public.serial_numbers
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_stock_items on public.stock_in_items
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_transfers on public.transfers
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_transfer_items on public.transfer_items
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_packing_lists on public.packing_lists
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_serial_corrections on public.serial_corrections
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_analytics_uploads on public.analytics_uploads
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_analytics_rows on public.analytics_rows
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy read_all_dc_audit_logs on public.audit_logs
for select to authenticated
using (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));

-- Write policies
create policy write_admin_operator_stock_batches on public.stock_in_batches
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_admin_operator_serials on public.serial_numbers
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_admin_operator_stock_items on public.stock_in_items
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_admin_operator_transfers on public.transfers
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_admin_operator_transfer_items on public.transfer_items
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_admin_operator_packing_lists on public.packing_lists
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_admin_only_serial_corrections on public.serial_corrections
for all to authenticated
using (public.current_role() = 'dc_admin')
with check (public.current_role() = 'dc_admin');

create policy write_admin_operator_analytics_uploads on public.analytics_uploads
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_admin_operator_analytics_rows on public.analytics_rows
for all to authenticated
using (public.current_role() in ('dc_admin','dc_operator'))
with check (public.current_role() in ('dc_admin','dc_operator'));

create policy write_all_dc_audit_logs on public.audit_logs
for insert to authenticated
with check (public.current_role() in ('dc_admin','dc_operator','dc_viewer'));
