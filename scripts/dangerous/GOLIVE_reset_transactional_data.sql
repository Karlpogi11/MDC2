-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  DANGER — IRREVERSIBLE DATA DESTRUCTION                             ║
-- ║                                                                          ║
-- ║  This script TRUNCATES all transactional data in the MDC database.      ║
-- ║  It is intended to be run ONCE before go-live to wipe test/sample data. ║
-- ║                                                                          ║
-- ║  DO NOT run this on a production database with real data.                ║
-- ║  DO NOT run this without explicit sign-off from the project lead.        ║
-- ║  There is NO undo. Take a full database backup first.                    ║
-- ║                                                                          ║
-- ║  Preserved: sites, parts, profiles, app_config, feature_flags           ║
-- ║  Destroyed: all serials, transfers, stock-in, analytics, audit logs      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Confirm you have read the warning above before proceeding.
-- Recommended: run `select count(*) from serial_numbers;` first to verify scope.

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
