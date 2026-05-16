# MDC Inventory System (Standalone)

## Recommendation (Direct)
Do **not** fork the whole IDS monolith as-is.
Build a **standalone DC inventory product** in this repo, and only reuse selected inventory logic/components from IDS.

Reason:
- clean ownership transfer to client company
- strict DC-only access boundary
- avoids SaaS tenant/billing logic leakage
- lower long-term security and maintenance risk

## What You Asked For (Locked Scope)
- DC-only system access
- Stock-in import: serial / part number / bulk
- Transfer to other sites with packing list + email
- Manual correction for wrong transferred serial with audit trail
- Export: stocked-in serials/parts from DC
- Export: transferred serials/parts to other sites
- Upload Fixably + GSX exports, analyze trend by date range/site/part
- Inventory-first UI similar to Katana-style operational grid

## Build Strategy
1. `MDC` = separate app + separate Supabase project + separate Vercel project
2. Reuse inventory domain logic from IDS only (not billing/subscription/system-admin modules)
3. Implement strict RBAC (`dc_admin`, `dc_operator`, `dc_viewer`)
4. Migration-first DB workflow (`supabase migration new ...`), never DB push-all
5. UAT with DC team before go-live

## Suggested Milestones
1. Foundation: auth/RBAC/schema/import pipeline
2. Core Ops: stock-in + transfers + packing list/email + corrections
3. Reporting: stock-in/transferred exports + analytics uploader/parser
4. UI hardening + audit + UAT + production handover

## Security Priorities
- P0: enforce RLS on every inventory table and audit every correction
- P0: signed uploads only (Fixably/GSX), file type + size validation
- P0: no service role or sender secrets in client bundle
- P1: approval flow for high-risk corrections and transfer reversals
- P1: rate-limit import and analytics endpoints

See `docs/implementation-blueprint.md` for full architecture and execution plan.

## Live Documentation System
- `docs/development-live-checklist.md`: single-file live checklist + compact playbook + inline templates

## Phase 1 Implemented (UI + Data Baseline)
- React + TypeScript + Vite app shell
- Real inventory UI (filters, metrics, loading/empty/error states, responsive table)
- Live checklist UI with gate progress, P0 blockers, and auto-save (no markdown editing)
- Settings baseline screen with key operational controls
- Supabase client wiring via env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- Phase 1 DB hardening migration for indexes, constraints, `updated_at` triggers, and `inventory_snapshot` view

## Run Locally
1. Copy `.env.example` to `.env.local` and set Supabase values.
2. Install deps: `npm install`
3. Start app: `npm run dev`
4. Typecheck: `npm run typecheck`
5. Build: `npm run build`
