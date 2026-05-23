# MDC Inventory System — System Design

**Version:** 1.0
**Date:** 2026-05-16
**Status:** Approved

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 Hostinger static CDN                 │
│         React + TypeScript SPA (Vite build)          │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │  Auth    │  │  Pages   │  │  TanStack Query    │ │
│  │  Guard   │  │  + RBAC  │  │  (cache + fetch)   │ │
│  └──────────┘  └──────────┘  └────────────────────┘ │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────┐
│                  Supabase Project                    │
│                                                      │
│  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │  Auth Server │  │  PostgREST (auto REST API)   │ │
│  │  (JWT)       │  │  + RLS enforced on every req │ │
│  └──────────────┘  └──────────────────────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  Edge Functions (Deno)                        │   │
│  │  import-stockin | create-transfer             │   │
│  │  generate-packing-list | notify-transfer      │   │
│  │  upload-analytics | analyze-trend             │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │  Postgres DB │  │  Storage Buckets             │ │
│  │  + RLS       │  │  imports-stockin             │ │
│  │  + Triggers  │  │  imports-analytics           │ │
│  └──────────────┘  │  packing-lists               │ │
│                    └──────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  Resend (email API) │
              │  Packing list email │
              └─────────────────────┘
```

**Key principle:** The React app never holds a service role key. All privileged operations (batch inserts, PDF generation, email dispatch) run inside Edge Functions where secrets are stored as Supabase environment variables.

---

## 2. Frontend Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | React 19 + TypeScript | Component model fits complex interactive grid; TypeScript catches domain type errors |
| Build | Vite | Fastest HMR and build; already in project |
| Styling | Tailwind CSS v4 | Full layout control for dense operational grid; zero runtime overhead |
| Table | TanStack Table v8 | Headless; handles virtual scroll, sort, multi-filter without style opinions |
| Data fetching | TanStack Query v5 | Caching, background refetch, optimistic updates, loading/error states |
| Routing | React Router v7 | Route-level RBAC guards; well-understood |
| Supabase client | @supabase/supabase-js v2 | Auth tokens, typed queries, realtime |
| Charts | Recharts | Added in Milestone 4 only; lightweight |

### Route structure

```
/login                    public
/                         → redirect to /inventory
/inventory                dc_viewer+
/stock-in                 dc_operator+
/transfers                dc_viewer+
/transfers/:id            dc_viewer+
/serial-corrections       dc_admin only
/exports                  dc_operator+
/analytics                dc_operator+
/analytics/upload         dc_operator+
```

### RBAC guard pattern

```typescript
// Route is wrapped in a guard that checks the user's role from the profiles table.
// If role is insufficient, redirect to /403. Never hide routes by CSS alone.
<RoleGuard allow={['dc_admin', 'dc_operator']}>
  <StockInPage />
</RoleGuard>
```

---

## 3. Database Design

### Entity Relationship (simplified)

```
profiles ──< stock_in_batches ──< stock_in_items >── serial_numbers
                                                           │
parts ─────────────────────────────────────────────────────┤
                                                           │
sites ─────────────────────────────────────────────────────┤
                                                           │
transfers ──< transfer_items >─────────────────────────────┘
    │
    └──< packing_lists
    └──< serial_corrections

analytics_uploads ──< analytics_rows

audit_logs (append-only, references profiles)
```

### Key design decisions

**Decision: serial_numbers has a single `current_site_id`**
Context: A serial is always in exactly one location. Tracking history is done via transfer_items and audit_logs, not by storing multiple site references on the serial.
Consequence: To find where a serial has been, query transfer_items. Current location is always O(1).

**Decision: serial_corrections writes a new serial_number row instead of updating the old one**
Context: The old serial must remain in the DB as `void` for audit purposes. Updating in place would lose the history.
Consequence: Two rows exist for the same physical device. The `void` status makes the old one invisible to operational queries.

**Decision: audit_logs is insert-only, no update/delete RLS policy**
Context: Audit trail must be immutable. If an admin could delete audit logs, the correction history is untrustworthy.
Consequence: The table grows indefinitely. Archive strategy needed after 12 months (out of scope for MVP).

### Indexes

```sql
-- High-frequency query paths
idx_serial_numbers_part_id          -- inventory grid grouped by part
idx_serial_numbers_site_id          -- filter by current location
idx_serial_numbers_status           -- filter in_stock vs transferred
idx_transfer_items_transfer_id      -- transfer detail page
idx_analytics_rows_part_site_date   -- trend dashboard aggregation
idx_audit_logs_entity               -- correction history lookup
```

---

## 4. Edge Functions

### import-stockin
- Trigger: POST from client with signed upload URL reference
- Steps: fetch file from storage → parse CSV/XLSX → validate rows → check duplicates → batch insert in transaction → write audit log
- Returns: `{ success_count, failed_rows: [{ row, reason }] }`
- Uses service role key (stored as Supabase secret, never in client)

### generate-packing-list
- Trigger: transfer status transitions to `packed`
- Steps: fetch transfer + items from DB → render PDF with pdf-lib → upload to `packing-lists` bucket → update `packing_lists` table
- Returns: signed URL to the PDF

### notify-transfer-email
- Trigger: called after packing list is generated
- Steps: fetch transfer metadata + recipient email → send via Resend with PDF link
- Sender domain must have SPF/DKIM/DMARC configured

### upload-analytics-file
- Trigger: POST from client with file
- Steps: validate MIME + size → store in `imports-analytics` bucket → trigger `analyze-parts-trend`

### analyze-parts-trend
- Trigger: called after upload completes
- Steps: fetch file → parse by source_type (fixably/gsx) → normalize to `analytics_rows` → update upload row_count

---

## 5. Security Model

### Threat model

| Threat | Mitigation |
|---|---|
| Unauthorized data access | RLS on every table; anon key cannot bypass RLS |
| Service role key exposure | Key only in Edge Function env vars; never in `VITE_` prefix |
| File upload abuse | MIME allowlist, 10MB max, signed upload URLs, server-side validation |
| Serial correction fraud | `dc_admin` only RLS policy; mandatory reason; immutable audit log |
| Cross-tenant data bleed | Dedicated Supabase project; no shared tables with IDS |
| Brute force auth | Supabase Auth rate limiting (built-in) |
| Duplicate serial race condition | DB unique constraint on `serial_numbers.serial_number`; transactional insert |

### What never goes in the client bundle
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- Any private key or secret

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are exposed to the frontend. The anon key is safe to expose — RLS is the enforcement layer.

---

## 6. File Storage

| Bucket | Contents | Access |
|---|---|---|
| `imports-stockin` | Uploaded CSV/XLSX files | Signed URL, operator+ write |
| `imports-analytics` | Fixably/GSX files | Signed URL, operator+ write |
| `packing-lists` | Generated PDFs | Signed URL, viewer+ read |

All buckets are private. No public access. Download links are signed URLs with 5-minute expiry.

---

## 7. Performance Targets

| Operation | Target |
|---|---|
| Inventory grid first page load | < 1 second |
| Search (debounced) response | < 500ms |
| Stock-in import (500 rows) | < 10 seconds |
| Transfer + packing list + email | < 10 seconds |
| Export (10,000 rows) | < 15 seconds |
| Analytics upload + normalize | < 30 seconds |

### How targets are met
- Grid: server-side pagination + indexed queries. Client never fetches all rows.
- Search: debounced 300ms + `ilike` on indexed `part_number` column
- Imports/exports: Edge Functions run close to the DB (same region)
- Analytics: `analytics_rows` has composite index on `(part_number, site_code, used_at)`

---

## 8. Deployment

```
Branch: main -> Hostinger production build after CI passes
Branch: staging -> Hostinger staging/UAT build when available

Supabase: one project per environment
  - staging: mdc-staging.supabase.co
  - production: mdc-prod.supabase.co (client-owned)
```

### Environment variables

```
# Frontend (Hostinger static app)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Edge Functions (Supabase secrets)
APP_URL=
CORS_ALLOWED_ORIGINS=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

---

## 9. Architecture Decision Records (ADR)

### ADR-001: Supabase over custom Node backend
**Context:** Need auth, DB, file storage, and server-side functions.
**Decision:** Use Supabase managed infrastructure instead of building a custom Express/NestJS server.
**Alternatives rejected:** Node on Railway — adds a server to maintain, deploy, and monitor. No benefit for this scope.
**Consequences:** Tied to Supabase pricing and availability. Acceptable for a DC-only internal tool.

### ADR-002: Vite SPA over Next.js
**Context:** Choosing a frontend framework.
**Decision:** Vite SPA. No SSR needed — this is an internal tool behind auth. Every page requires login.
**Alternatives rejected:** Next.js — SSR/SSG adds complexity with no user-facing benefit. App Router adds learning curve.
**Consequences:** No SEO (not needed). Faster build and simpler deployment.

### ADR-003: TanStack Table over a component library table
**Context:** The inventory grid needs virtual scroll, multi-filter, server-side pagination.
**Decision:** TanStack Table (headless). We control the markup and styling.
**Alternatives rejected:** MUI DataGrid — opinionated styling fights the dense Katana-like layout. AG Grid — overkill and license cost.
**Consequences:** More initial setup. Full control over behavior and appearance.

### ADR-004: PDF generation split by runtime
**Context:** Packing list PDFs are downloaded by operators, uploaded to storage, and may be attached by Edge Functions.
**Decision:** Use `jspdf`/`jspdf-autotable` in the browser for the operator-facing packing-list layout, and use `pdf-lib` only inside Supabase Edge Functions through URL imports when Deno has to build or attach PDFs.
**Alternatives rejected:** Shipping `pdf-lib` in the frontend bundle when it is only needed by Deno. `@react-pdf/renderer` because it does not run in Supabase Edge Functions.
**Consequences:** Frontend dependencies stay limited to the browser PDF path; Edge Function PDF code owns its own Deno import.
