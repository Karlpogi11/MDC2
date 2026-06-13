---
title: Definition of Done
tags:
  - quality
  - process
  - engineering
date: 2026-05-16
version: "1.0"
aliases:
  - DoD
  - Quality Gates
---

# MDC Inventory System — Definition of Done

**Version:** 1.0
**Date:** 2026-05-16

> A feature is not done when the code is written. It is done when every gate below is passed.
> This is non-negotiable. Skipping gates creates production incidents.

---

## Level 1: Every Single Task / PR

Before any PR is merged, all of these must be true:

- [ ] Code compiles with zero TypeScript errors (`npm run typecheck`)
- [ ] Build passes (`npm run build`)
- [ ] The feature works end-to-end in the local dev environment
- [ ] No `console.log` left in production code paths
- [ ] No hardcoded secrets, URLs, or credentials in the diff
- [ ] No `any` types introduced without a comment explaining why
- [ ] PR description states: what changed, how to test it, any known limitations
- [ ] If a new DB table or column was added: migration file exists, RLS policy exists

---

## Level 2: Feature Complete

A feature is complete when:

- [ ] All acceptance criteria from the PRD are met (check [[prd]])
- [ ] Happy path works correctly
- [ ] Error states are handled and shown to the user (not silent failures)
- [ ] Loading states are shown during async operations
- [ ] Empty states are shown when there is no data
- [ ] RBAC is enforced: wrong-role user cannot access the feature (tested manually)
- [ ] Audit log entry is written for every mutation (stock-in, transfer, correction)
- [ ] Feature works on Chrome, Safari, and Firefox (latest versions)
- [ ] Feature is usable on a 1280px wide screen (minimum supported width)

---

## Level 3: Milestone Complete

A milestone is complete when all features in that milestone pass Level 1 and Level 2, plus:

- [ ] Staging environment is deployed and accessible
- [ ] All new DB migrations applied to staging
- [ ] At least one real user (DC operator or admin) has tested the flow on staging
- [ ] No P0 or P1 bugs open
- [ ] Performance targets met (see [[system-design]] section 7)
- [ ] All `docs/` files updated to reflect what was built

---

## Level 4: Production Ready (Go-Live Gate)

Nothing goes to production until every item below is checked:

### Security
- [ ] RLS verified on all 13 tables: run `select tablename, policyname from pg_policies order by tablename` and confirm every table appears
- [ ] `dc_viewer` role tested: cannot insert, update, or delete any row
- [ ] `dc_operator` role tested: cannot approve serial corrections
- [ ] Service role key confirmed absent from all `VITE_` env vars and client bundle
- [ ] File upload: MIME type and size limits enforced (tested with oversized file and wrong MIME)
- [ ] Signed upload URLs expire correctly (tested after expiry)

### Data Integrity
- [ ] Duplicate serial insert rejected at DB level (unique constraint tested)
- [ ] Serial correction: old serial is `void`, new serial is active, audit log has both
- [ ] Transfer status transitions are enforced (cannot skip from `draft` to `received`)
- [ ] Import with mixed valid/invalid rows: valid rows committed, invalid rows reported

### Observability
- [ ] Sentry (or equivalent) installed and capturing a test error
- [ ] Edge Function logs visible in Supabase dashboard
- [ ] At least one alert configured for repeated auth failures

### UAT Signoff
- [ ] DC operator completes stock-in → transfer → correction flow without assistance
- [ ] DC viewer confirms they see data but have no action buttons
- [ ] DC admin confirms correction history is accurate
- [ ] Business approver signs off in writing (email or document)

### Handover
- [ ] All secrets rotated and stored in client-owned accounts
- [ ] Client has owner access to Supabase project
- [ ] Client has owner access to Vercel project
- [ ] Database backup tested: backup → restore → row count matches
- [ ] Rollback plan documented: what to do if a bad deploy goes live
- [ ] Runbook written for: add new user, reset password, re-run failed import

---

## Bug Severity Definitions

Use these consistently when filing and prioritizing bugs.

| Severity | Definition | Must fix before... |
|---|---|---|
| P0 — Critical | Data loss, security breach, auth bypass, production down | Immediate. Block everything else. |
| P1 — High | Core feature broken, wrong data shown, audit log not written | Current milestone ships |
| P2 — Medium | Feature works but UX is degraded, edge case fails | Next milestone |
| P3 — Low | Cosmetic, minor UX, non-critical copy | Backlog |

---

## What "Tested" Means

Saying "I tested it" means:

1. You tested the happy path (valid input, correct role)
2. You tested at least one error path (invalid input, network failure, wrong role)
3. You tested the empty state (no data)
4. You tested with a role that should NOT have access and confirmed it was blocked

Testing only the happy path is not testing. It is hoping.

---

## Living Document Rule

This document must be updated when:
- A new feature is added that introduces new quality gates
- A production incident reveals a gap in the checklist
- The team agrees a gate is no longer relevant (with a written reason)

Every update requires a commit with message: `docs(dod): <what changed and why>`

See [[audit-checklist]] for the completed audit trail and [[implementation-blueprint]] for delivery planning.

---

**Related:** [[prd]], [[system-design]], [[implementation-blueprint]], [[audit-checklist]]
