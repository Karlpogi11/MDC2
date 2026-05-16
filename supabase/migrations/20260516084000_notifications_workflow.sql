-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2: notifications + workflow_requests
-- ─────────────────────────────────────────────────────────────────────────────

-- In-app notification center
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null, -- 'transfer_status', 'correction_approved', 'correction_rejected', 'import_done', 'workflow_pending'
  title       text not null,
  body        text,
  entity_type text,          -- 'transfer', 'serial_correction', 'workflow_request'
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

-- Users only see their own notifications
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

-- Users can mark their own as read (update read_at only)
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4-eyes approval workflow
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.workflow_requests (
  id              uuid primary key default gen_random_uuid(),
  type            text not null, -- 'serial_correction', 'large_transfer', 'physical_count_adjustment'
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  entity_type     text not null,
  entity_id       uuid,
  payload         jsonb not null default '{}',  -- snapshot of what's being approved
  requested_by    uuid not null references public.profiles(id),
  reviewed_by     uuid references public.profiles(id),
  review_note     text,
  requested_at    timestamptz not null default now(),
  reviewed_at     timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_workflow_pending
  on public.workflow_requests(status, requested_at desc)
  where status = 'pending';

alter table public.workflow_requests enable row level security;

create policy workflow_select on public.workflow_requests
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

create policy workflow_insert on public.workflow_requests
  for insert to authenticated
  with check (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator'));

-- Only admins can approve/reject
create policy workflow_update on public.workflow_requests
  for update to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

create trigger workflow_requests_updated_at
  before update on public.workflow_requests
  for each row execute function public.set_updated_at();
