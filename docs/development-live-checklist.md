# MDC Development Operating Checklist (Single-File)

Use this as the only active development document for planning, delivery, release, and operations.

## 1) Live Status

- Project: `MDC (DC-only inventory platform)`
- Sprint/Iteration:
- Date Last Updated:
- Delivery Owner:
- Tech Lead:
- QA Lead:
- Security Reviewer:

## 2) Release Gates (Live Checklist)

### Gate 0: Scope and Org Isolation (P0)

- [ ] Separate infrastructure confirmed (`MDC-only Supabase`, `MDC-only Vercel`). Evidence:
- [ ] Tenant/org boundary documented (no IDS cross-tenant path). Evidence:
- [ ] Data classification documented (`public/internal/confidential/restricted`). Evidence:
- [ ] No production secrets in client-side env (`VITE_*` only public values). Evidence:
- [ ] Role model locked (`dc_admin`, `dc_operator`, `dc_viewer`). Evidence:

### Gate 1: Discovery and Requirements

- [ ] Problem statement and outcomes documented.
- [ ] In-scope/out-of-scope approved.
- [ ] User flows mapped (stock-in, transfer, correction, export, analytics upload).
- [ ] Edge cases documented (duplicate serial, invalid files, partial transfer).
- [ ] Success metrics and SLO targets defined.

### Gate 2: Architecture and Design

- [ ] Architecture diagram updated.
- [ ] Domain model reviewed.
- [ ] API contracts defined.
- [ ] ADR recorded for major decisions.
- [ ] Data lifecycle documented.
- [ ] Performance plan defined (indexes, pagination, limits).

### Gate 3: Security and Compliance (P0)

- [ ] RLS exists for every inventory table.
- [ ] Role access tests implemented.
- [ ] Upload validation and signed URL rules implemented.
- [ ] Immutable audit log validated for critical actions.
- [ ] Correction flow requires reason + actor traceability.

### Gate 4: Delivery and Build Quality

- [ ] Backlog has clear acceptance criteria.
- [ ] Migration plan includes rollback.
- [ ] Static checks pass (`typecheck`, lint, build).
- [ ] Unit/integration tests added for changed logic.
- [ ] Observability added for imports/transfers/corrections.

### Gate 5: Verification and UAT

- [ ] Test plan includes positive/negative/edge scenarios.
- [ ] Data correctness verified for imports/exports/analytics.
- [ ] UAT scripts executed by DC users.
- [ ] UAT sign-off captured.

### Gate 6: Release and Post-Deploy (P0)

- [ ] Release notes complete.
- [ ] Rollback runbook validated.
- [ ] Backup/restore check completed.
- [ ] Smoke tests passed in production.
- [ ] Hypercare owner assigned.

## 3) Hard P0 Blockers

Do not release if any item is unchecked:

- [ ] Org isolation not proven
- [ ] Missing/failing RLS
- [ ] No immutable audit trail for corrections/transfers
- [ ] No tested rollback for latest migration
- [ ] Secrets exposed in client/logs
- [ ] No production smoke test evidence

## 4) How Big Teams Keep Docs Alive (Compact Playbook)

- One source of truth: this file is the active gate doc.
- Code + docs ship together in the same PR.
- Every gate item must have objective evidence.
- Security, rollback, and runbook updates are same-day updates.
- Weekly lead review of stale or missing evidence.

## 5) Minimal Working Templates (Inline)

### PRD Mini Template

- Problem:
- Goals:
- Non-goals:
- Users/flows:
- Requirements:
- Success metrics:
- Risks/dependencies:
- Rollout + rollback:

### ADR Mini Template

- Decision:
- Context:
- Options considered:
- Tradeoffs:
- Security/data impact:
- Reversal plan:

### Runbook Mini Template

- Service/capability:
- Normal operation steps:
- Failure scenarios + recovery:
- Rollback steps:
- Escalation contacts:

### Release Readiness Mini Template

- Scope:
- Tests passed:
- Migration plan:
- Rollback verified:
- Approvers:

### Incident Postmortem Mini Template

- Summary + impact:
- Timeline:
- Root cause:
- Corrective actions (owner/date):
- Preventive controls:

## 6) Weekly Rhythm

- Monday: scope/risk refresh.
- Daily: checklist status + blockers.
- Thursday: release pre-check.
- Friday: UAT + retro + checklist update.

## 7) Evidence Links

- Tickets:
- PRs:
- Architecture docs:
- ADRs:
- Test reports:
- Dashboards:
- UAT sign-off:
