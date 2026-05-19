-- GO-LIVE RESET: wipe all test/sample transactional data
-- SAFE: preserves sites, parts, profiles, app_config, feature_flags
--
-- RUN ONCE before go-live. Irreversible.
-- Confirm with team before executing on the linked remote project.

-- Order matters: child tables first (FK constraints)
truncate table
  public.audit_logs,
  public.serial_part_reassignments,
  public.serial_corrections,
  public.packing_lists,
  public.transfer_items,
  public.transfers,
  public.stock_in_items,
  public.stock_in_batches,
  public.serial_numbers,
  public.analytics_rows,
  public.analytics_uploads
restart identity cascade;

-- Optional: remove test user accounts (keep real ones by email domain)
-- Uncomment and adjust domain before running:
-- delete from public.profiles where email not like '%@yourdomain.com';
