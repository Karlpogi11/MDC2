-- ─────────────────────────────────────────────────────────────────────────────
-- Partial Indexes for Performance
--
-- These target the actual query patterns:
--   1. Inventory grid: always filters status = 'in_stock'
--   2. Corrections audit: ordered by corrected_at DESC
--   3. Audit compliance: filter by actor, ordered by date
-- ─────────────────────────────────────────────────────────────────────────────

-- Active inventory only (covers ~80% of serial_numbers queries)
create index if not exists idx_sn_in_stock
  on public.serial_numbers(part_id, current_site_id)
  where status = 'in_stock';

-- Corrections lookup by date (compliance/audit queries)
create index if not exists idx_corrections_date
  on public.serial_corrections(corrected_at desc);

-- Audit log by actor + date (compliance reports, anomaly detection)
create index if not exists idx_audit_actor_date
  on public.audit_logs(actor_id, created_at desc);

-- Audit log chain verification (sequential walk by created_at, id)
create index if not exists idx_audit_chain_order
  on public.audit_logs(created_at asc, id asc);

-- Transfers by status (pending/in-transit views)
create index if not exists idx_transfers_status
  on public.transfers(status)
  where status in ('draft','packed','in_transit');
