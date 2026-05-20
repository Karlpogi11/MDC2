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
-- ║  WHAT THIS WIPES:                                                        ║
-- ║    audit_logs, serial_part_reassignments, serial_corrections,            ║
-- ║    packing_lists, transfer_items, transfers, stock_in_items,             ║
-- ║    stock_in_batches, serial_numbers, analytics_rows, analytics_uploads   ║
-- ║                                                                          ║
-- ║  WHAT IS PRESERVED:                                                      ║
-- ║    sites, parts, profiles, app_config, feature_flags                     ║
-- ║                                                                          ║
-- ║  APPROVAL REQUIRED: project lead must comment "APPROVED FOR GO-LIVE"    ║
-- ║  in the deployment ticket before this script is executed.                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- This DO block forces the runner to see the warning in the output log.
-- It does NOT prevent execution — that requires human review of the notice.
do $$
begin
  raise notice '==========================================================';
  raise notice 'GOLIVE RESET: You are about to wipe ALL transactional data.';
  raise notice 'Wiping: serial_numbers, transfers, stock_in_batches,';
  raise notice '        transfer_items, packing_lists, serial_corrections,';
  raise notice '        analytics_uploads, analytics_rows, audit_logs.';
  raise notice 'Preserved: sites, parts, profiles, app_config.';
  raise notice 'This is IRREVERSIBLE. Ensure a backup exists.';
  raise notice 'Approval required from project lead before running.';
  raise notice '==========================================================';
end;
$$;

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
