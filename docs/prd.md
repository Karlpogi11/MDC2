# MDC Inventory System — Product Requirements Document

**Version:** 1.0
**Date:** 2026-05-16
**Status:** Approved
**Owner:** Engineering Lead

---

## 1. Problem Statement

The DC (Distribution Center) team currently manages inventory using manual processes — spreadsheets, email threads, and paper packing lists. This creates:

- No single source of truth for serial number location
- No audit trail when a wrong serial is transferred
- No visibility into part usage trends from Fixably/GSX repair data
- Dependency on the IDS SaaS platform which is scoped for a different business unit

**This system replaces those manual processes with a purpose-built DC inventory tool.**

---

## 2. Goals

| Goal | Metric |
|---|---|
| DC team can operate without IDS dependency | Zero IDS API calls in production |
| All serial movements are traceable | 100% of stock-in, transfer, correction events have audit log entries |
| Wrong serial corrections are controlled | Only `dc_admin` can approve, every correction has a reason |
| Inventory data is exportable on demand | Export completes in < 15 seconds for up to 10,000 rows |
| Part usage trends are visible | Upload → normalized data visible in chart within 30 seconds |

---

## 3. Non-Goals (Explicitly Out of Scope)

- Billing, subscriptions, or SaaS tenant management
- Integration with IDS platform APIs
- Public-facing pages or customer-facing features
- Mobile app (responsive web only)
- Multi-warehouse stock transfers between DC sites (DC is always the source)
- Barcode scanner hardware integration (manual serial entry only for MVP)

---

## 4. Users & Roles

### dc_admin
Who: DC manager, team lead
Needs: Full visibility, approve corrections, manage users, all exports
Can: Everything

### dc_operator
Who: DC staff doing daily operations
Needs: Stock-in, create transfers, export records
Cannot: Approve serial corrections, manage users

### dc_viewer
Who: Finance, management, auditors
Needs: Read-only access to inventory, transfers, audit logs
Cannot: Create or modify anything

---

## 5. Feature Requirements

### F1 — Stock-In Import

**User story:** As a `dc_operator`, I can import a batch of serials/parts from a CSV or XLSX file so that new inventory is recorded without manual data entry.

**Acceptance criteria:**
- Upload accepts `.csv` and `.xlsx` files up to 10MB
- Template is downloadable from the upload screen
- System validates: required columns present, no empty serial fields, no duplicate serials within the file
- Duplicate serials already in the DB are flagged in a conflict report, not silently skipped
- Successful rows are committed as a batch transaction
- Failed rows are returned with a per-row reason
- Every successful batch writes an audit log entry with operator ID, timestamp, and row count

**Edge cases:**
- File with 0 valid rows → show error, do not create a batch record
- File with mixed valid/invalid rows → commit valid rows, report invalid rows
- Same serial submitted twice in the same file → treat as duplicate, report both

---

### F2 — Inventory Grid

**User story:** As any authenticated user, I can view the current inventory state so that I know what is in stock, reserved, and available.

**Acceptance criteria:**
- Columns: Part name, Part number, Category, In stock, Reserved, Available, Last stock-in date
- Server-side pagination (default 50 rows, option for 100)
- Search by part number or serial number (debounced 300ms)
- Filter by: category, site, status (in_stock / transit / transferred)
- Column sort on: part name, in-stock qty, last stock-in date
- Export current filtered view as CSV
- Loads first page in < 1 second on staging

---

### F3 — Transfers

**User story:** As a `dc_operator`, I can create a transfer from DC to a destination site, generate a packing list, and notify the receiving site by email.

**Acceptance criteria:**
- Select destination site from list of active sites
- Add items by serial number or part number + quantity
- System checks serial availability before adding (cannot add a serial already in transit or transferred)
- Status flow: `draft` → `packed` → `in_transit` → `received` → (terminal)
- `cancelled` is available from `draft` or `packed` only
- Packing list PDF generated on transition to `packed`
- Email sent to destination site contact with packing list attached or linked
- Transfer detail page shows all items, status history, and packing list download link

---

### F4 — Serial Corrections

**User story:** As a `dc_admin`, I can correct a wrong serial number on a completed transfer so that the inventory record reflects reality.

**Acceptance criteria:**
- Correction requires: old serial (auto-filled from transfer), new serial (manual input), reason (mandatory text)
- New serial must not already exist in `serial_numbers`
- Old serial is marked `void` after correction
- New serial is created with `transferred` status pointing to the same destination
- Immutable record written to `serial_corrections` table
- Audit log entry written with actor, old value, new value, reason, timestamp
- Correction history page filterable by date, operator, transfer number

---

### F5 — Exports

**User story:** As a `dc_operator` or `dc_admin`, I can export stocked-in and transferred records so that I can share data with finance or management.

**Acceptance criteria:**
- Export stocked-in: filter by date range, part number, operator → CSV/XLSX
- Export transferred: filter by date range, destination site, status → CSV/XLSX
- Export runs server-side for datasets > 1,000 rows
- Download via signed URL (expires in 5 minutes)
- Export includes all visible columns plus internal IDs for traceability

---

### F6 — Analytics Uploads

**User story:** As a `dc_operator` or `dc_admin`, I can upload Fixably and GSX export files so that I can see part usage trends over time.

**Acceptance criteria:**
- Upload accepts Fixably CSV and GSX CSV/XLSX formats
- Source type must be selected before upload (Fixably / GSX)
- System normalizes rows to common schema: part number, serial, site, date, qty
- Trend dashboard shows: top parts by usage, filterable by site + date range
- Chart: bar or line by date period (day/week/month toggle)
- Upload history shows file name, source type, row count, upload date
- Duplicate upload of same file is detected and rejected

---

## 6. Technical Constraints

- Frontend deployed on Vercel (client-owned project)
- Backend on Supabase (client-owned project, separate from IDS)
- No service role key in client bundle — ever
- All file uploads via signed URLs only
- RLS enforced on every table — no exceptions
- Migration-first DB workflow: `supabase migration new`, never push-all

---

## 7. Success Metrics (Go-Live)

- [ ] DC operator completes full stock-in → transfer → correction flow without assistance
- [ ] Zero IDS API dependencies in production codebase
- [ ] All 13 domain tables have RLS policies verified
- [ ] UAT signoff from DC team lead and business approver
- [ ] Backup + restore test completed on staging data

---

## 8. Open Questions

| Question | Owner | Due |
|---|---|---|
| What is the exact column format of the Fixably export? | DC team | Before Milestone 4 |
| Who is the email recipient for transfer notifications? | DC manager | Before Milestone 2 |
| Is there a maximum transfer size (number of items)? | DC team | Before Milestone 2 |
| Should corrections require a second admin to approve? | Business approver | Before Milestone 3 |
