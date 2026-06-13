---
title: Implementation Blueprint
tags:
  - implementation
  - planning
  - architecture
date: 2026-05-16
aliases:
  - Blueprint
---

# Implementation Blueprint

## 1) Fork vs New Build Decision

### Recommended: New standalone codebase in `MDC` + selective module extraction

Do this:
- Keep IDS SaaS untouched for existing tenants.
- Build standalone DC app with separate infra.
- Copy only proven inventory modules and rewrite integration boundaries.

Avoid this:
- full fork with all SaaS features, billing, and admin internals.

Why this is safer:
- hard security isolation
- no accidental cross-tenant access
- cleaner one-time-payment handover
- easier maintenance contract boundaries

## 2) Target Architecture

### Frontend
- React + TypeScript + Vite (same as your current stack for speed)
- Inventory-first layout (top nav + filter row + dense operational grid)
- Route-level RBAC guards

### Backend/Data
- Dedicated Supabase project (company-owned)
- Postgres + RLS for all domain tables
- Edge Functions for:
  - `import-stockin`
  - `create-transfer`
  - `generate-packing-list`
  - `notify-transfer-email`
  - `upload-analytics-file`
  - `analyze-parts-trend`

### Files/Docs
- Supabase storage buckets:
  - `imports-stockin`
  - `imports-analytics`
  - `packing-lists`
- Immutable audit table for correction actions

See [[system-design]] for the full architecture breakdown.

## 3) Domain Tables (Minimum)

- `profiles` (user identity + role)
- `sites` (DC + receiving sites)
- `parts` (`part_number`, description, category, active)
- `serial_numbers` (`serial_number`, `part_id`, `status`, `current_site_id`, stock metadata)
- `stock_in_batches` (bulk import header)
- `stock_in_items` (each imported line)
- `transfers` (header: source/destination/status)
- `transfer_items` (part/serial lines)
- `packing_lists` (pdf reference + metadata)
- `serial_corrections` (wrong serial -> corrected serial)
- `analytics_uploads` (Fixably/GSX file metadata)
- `analytics_rows` (normalized records)
- `audit_logs` (actor, action, old/new values, timestamp)

## 4) Access Scope (DC-only)

Roles:
- `dc_admin`: full create/update/export/correction approval
- `dc_operator`: stock-in, transfer, basic export
- `dc_viewer`: read-only dashboards/exports

Hard rules:
- only users in this org/project may authenticate
- only DC scoped tables/routes are deployed
- every mutation writes an audit log

## 5) Feature Mapping to Your Requirement

1. Import stock (serial/part/bulk)
   - CSV/XLSX uploader with template validation
   - duplicate serial detection before insert
   - commit as batch transaction

2. Transfer with packing list + email
   - create transfer header and item lines
   - generate PDF packing list
   - send email with attached/linked packing list

3. Manual correction of wrong serial transfer
   - correction dialog requires reason
   - enforce no duplicate final serial
   - write immutable `serial_corrections` + `audit_logs`

4. Export stocked-in records
   - filters: date range, part, serial, operator
   - csv/xlsx export endpoints

5. Export transferred records
   - filters: date range, destination site, status
   - csv/xlsx export endpoints

6. Fixably + GSX analytics uploads
   - parser by source type (`fixably`, `gsx`)
   - normalize to common schema
   - trend charts: top parts used by site/date range

See [[prd]] for full feature requirements and acceptance criteria.

## 6) UI Direction (Inventory-first)

Pages:
- `/inventory` (main table like the reference screenshot)
- `/stock-in`
- `/transfers`
- `/serial-corrections`
- `/exports`
- `/analytics`

Main inventory table columns:
- Part name
- Part no.
- Category
- In stock
- Reserved/Committed
- Available
- Last stock-in date
- Last stock-out date

UX details:
- fast search with part no./serial tokens
- sticky header + dense rows
- filter chips for site, date, category, status

See [[ui-ux-pattern]] and [[ui-spec-inventory]] for detailed UI guidance.

## 7) Security Risks and Exact Mitigations

### P0
1. Cross-tenant/access bleed
   - Fix: dedicated Supabase project + strict RLS policy per table + route guards.

2. Secret leakage (email/API keys)
   - Fix: keep in Supabase/Vercel secrets only; never `VITE_` expose private keys.

3. Unauthorized serial corrections
   - Fix: correction policy with role checks, reason, and immutable audit trail.

4. File upload abuse
   - Fix: MIME and extension allowlist, size limits, signed upload URL, AV scanning stage if available.

### P1
1. Data integrity on imports
   - Fix: staging table + validation report before commit.

2. Duplicate serial race conditions
   - Fix: DB unique constraints + transactional insert logic.

3. Email spoofing/delivery failures
   - Fix: verified company sender domain (SPF, DKIM, DMARC) + retry queue.

### P2
1. Slow analytics on large history
   - Fix: indexed normalized table + materialized summary views.

## 8) Practical Extraction Plan From IDS

Copy/rework first (high value):
- `src/pages/SiteInventory.tsx` (split into focused pages)
- `src/components/SerialCorrectionDialog.tsx`
- `src/components/SerialTransferDialog.tsx`
- `src/components/inventory/TransferPackDialog.tsx`
- export utilities and csv/xlsx helpers

Do NOT copy to MDC:
- platform billing/subscription features
- system-wide super-admin modules
- public lookup and unrelated SaaS addons

## 9) Suggested Delivery Sequence

Week 1
- bootstrap app + auth + roles + base schema + RLS

Week 2
- stock-in import + inventory grid + transfer create

Week 3
- packing list/email + correction flow + exports

Week 4
- analytics uploader/parser + trend dashboard + UAT fixes

See [[backlog]] for the task breakdown.

## 10) Go-live Checklist

- UAT signoff by assigned approvers
- rollback plan documented
- secrets rotated and stored in company-owned accounts
- backups + restore test completed
- audit trail verified end-to-end

See [[definition-of-done]] for full quality gates.

---

**Related:** [[prd]], [[system-design]], [[backlog]], [[definition-of-done]], [[ui-ux-pattern]]
