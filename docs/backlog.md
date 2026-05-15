# Backlog (MVP)

## Epic 1: Access and Security
- [ ] Implement auth + RBAC (`dc_admin`, `dc_operator`, `dc_viewer`)
- [ ] Add RLS policies for all inventory tables
- [ ] Add immutable audit log function

## Epic 2: Stock-In
- [ ] CSV/XLSX import parser with template validation
- [ ] Serial uniqueness checks
- [ ] Batch commit + failure report

## Epic 3: Transfers
- [ ] Create transfer (single/bulk serial)
- [ ] Packing list generation (PDF)
- [ ] Transfer notification email

## Epic 4: Corrections
- [ ] Wrong-serial correction dialog
- [ ] Mandatory reason + audit trail
- [ ] Correction history page

## Epic 5: Exports
- [ ] Export stocked-in records
- [ ] Export transferred records
- [ ] Saved filter presets

## Epic 6: Analytics
- [ ] Upload Fixably and GSX exports
- [ ] Normalize records to analytics table
- [ ] Trend dashboard by part/site/date range

## Definition of Done (MVP)
- [ ] DC team can operate end-to-end without SaaS tenant dependency
- [ ] All critical actions are audited
- [ ] UAT pass with business approver signoff
