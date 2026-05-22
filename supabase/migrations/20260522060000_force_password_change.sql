alter table public.profiles
  add column if not exists force_password_change boolean not null default false;
