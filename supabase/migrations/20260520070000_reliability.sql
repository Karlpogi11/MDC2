-- ============================================================
-- P1/P2 operational reliability: email retry, idempotency,
-- rate limiting, file_hash on stock_in_batches
-- ============================================================

-- ── 1. file_hash on stock_in_batches ─────────────────────────────────────────
alter table public.stock_in_batches
  add column if not exists file_hash text;

create unique index if not exists uq_stock_in_batches_file_hash
  on public.stock_in_batches(file_hash)
  where file_hash is not null;

-- ── 2. transfer_emails — email retry queue ────────────────────────────────────
-- Tracks every outbound transfer email attempt.
-- pg_cron retries rows where status = 'pending' and next_attempt_at <= now().
create table if not exists public.transfer_emails (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references public.transfers(id) on delete cascade,
  recipient_email text not null,
  status          text not null default 'pending'
                  check (status in ('pending','sent','failed','skipped')),
  attempt_count   int not null default 0,
  last_attempted_at timestamptz,
  next_attempt_at   timestamptz not null default now(),
  error_detail    text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_transfer_emails_pending
  on public.transfer_emails(next_attempt_at)
  where status = 'pending';

create index if not exists idx_transfer_emails_transfer
  on public.transfer_emails(transfer_id);

alter table public.transfer_emails enable row level security;

create policy transfer_emails_select on public.transfer_emails
  for select to authenticated
  using (get_my_claim_role() in ('dc_admin','dc_operator','dc_viewer'));

create policy transfer_emails_write on public.transfer_emails
  for all to authenticated
  using (get_my_claim_role() in ('dc_admin'))
  with check (get_my_claim_role() in ('dc_admin'));

drop trigger if exists trg_transfer_emails_updated_at on public.transfer_emails;
create trigger trg_transfer_emails_updated_at
  before update on public.transfer_emails
  for each row execute function public.set_updated_at();

-- ── 3. idempotency_keys — dedup mutating Edge Function calls ─────────────────
-- Edge Functions insert a key before processing; duplicate requests return 409.
-- Keys expire after 24h; pg_cron cleans them up.
create table if not exists public.idempotency_keys (
  key         text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  response    jsonb,           -- cached response body for replaying
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours')
);

create index if not exists idx_idempotency_keys_expires
  on public.idempotency_keys(expires_at);

alter table public.idempotency_keys enable row level security;

-- Only the owning user can read their own keys; service role handles writes
create policy idempotency_keys_select on public.idempotency_keys
  for select to authenticated
  using (user_id = auth.uid());

-- Cleanup function — called by pg_cron every hour
create or replace function public.cleanup_idempotency_keys()
returns void language sql security definer set search_path = public as $$
  delete from public.idempotency_keys where expires_at < now();
$$;

-- ── 4. rate_limit_log — sliding window rate limiting ─────────────────────────
-- Edge Functions insert a row per call; count rows in last window to enforce limit.
-- Cleaned up by pg_cron every 15 min.
create table if not exists public.rate_limit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null,   -- 'import-stockin', 'analytics-upload'
  created_at  timestamptz not null default now()
);

create index if not exists idx_rate_limit_log_user_endpoint
  on public.rate_limit_log(user_id, endpoint, created_at desc);

alter table public.rate_limit_log enable row level security;

create policy rate_limit_log_select on public.rate_limit_log
  for select to authenticated
  using (user_id = auth.uid());

-- Rate limit check function — returns true if under limit
-- Default: 10 calls per 60 seconds per user per endpoint
create or replace function public.check_rate_limit(
  p_user_id  uuid,
  p_endpoint text,
  p_limit    int     default 10,
  p_window_s int     default 60
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.rate_limit_log
  where user_id  = p_user_id
    and endpoint = p_endpoint
    and created_at > now() - (p_window_s || ' seconds')::interval;
  if v_count >= p_limit then return false; end if;
  insert into public.rate_limit_log(user_id, endpoint) values (p_user_id, p_endpoint);
  return true;
end;
$$;

-- Cleanup function
create or replace function public.cleanup_rate_limit_log()
returns void language sql security definer set search_path = public as $$
  delete from public.rate_limit_log where created_at < now() - interval '1 hour';
$$;

-- ── 5. pg_cron jobs ───────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Clean expired idempotency keys every hour
    perform cron.schedule(
      'cleanup-idempotency-keys',
      '0 * * * *',
      'SELECT public.cleanup_idempotency_keys()'
    );
    -- Clean rate limit log every 15 min
    perform cron.schedule(
      'cleanup-rate-limit-log',
      '*/15 * * * *',
      'SELECT public.cleanup_rate_limit_log()'
    );
  end if;
exception when others then null;
end;
$$;
