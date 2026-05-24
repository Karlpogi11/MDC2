# MDC Pilot Test & Pre-Deployment Checklist

## How to Run a Pilot Test (Before Going Live)

Run the pilot on the **same Supabase project + Hostinger site** but with a small group of real DC staff.
Do NOT create a separate environment — just limit access to 2–3 trusted users first.

### Pilot Setup Steps
1. Build and upload `dist/` to Hostinger (see deployment steps below)
2. Set all Edge Function secrets in Supabase dashboard
3. Create 1 `dc_admin` account and 1 `dc_operator` account for testers
4. Give testers the Hostinger URL — not localhost
5. Run through the pilot scenarios below
6. Collect feedback, fix issues, then open to full DC team

### Pilot Test Scenarios (run in order)

| # | Scenario | Who | Pass? |
|---|----------|-----|-------|
| 1 | Log in with dc_operator account | Operator | ☐ |
| 2 | Stock-in: import a CSV with 5 serials | Operator | ☐ |
| 3 | Stock-in: import a single serial manually | Operator | ☐ |
| 4 | Create a transfer draft, add 2 items | Operator | ☐ |
| 5 | Pack the transfer | Operator | ☐ |
| 6 | Dispatch (mark in transit) — enter courier + AWB | Operator | ☐ |
| 7 | Check that dispatch email arrives at destination site email | Admin | ☐ |
| 8 | Open receipt link from email — confirm received | Site staff | ☐ |
| 9 | Verify transfer shows "Received" in the system | Admin | ☐ |
| 10 | Export stocked-in serials to CSV | Admin | ☐ |
| 11 | Export transferred serials to CSV | Admin | ☐ |
| 12 | Upload a Fixably/GSX file and view analytics | Admin | ☐ |
| 13 | Log in as dc_viewer — confirm no write actions visible | Viewer | ☐ |
| 14 | Try to access a page as viewer that requires admin — confirm blocked | Viewer | ☐ |

---

## Pre-Deployment Checklist

### 1. Supabase
- [ ] All migrations applied (`npx supabase migration list` — Local = Remote for all rows)
- [ ] RLS enabled on every table (check Supabase dashboard → Table Editor → each table)
- [ ] Edge Function secrets set in Supabase dashboard → Edge Functions → Secrets:
  - `APP_URL` = `https://your-hostinger-domain.com`
  - `CORS_ALLOWED_ORIGINS` = `https://your-hostinger-domain.com`
  - `GMAIL_USER` = `your-gmail@gmail.com`
  - `GMAIL_APP_PASSWORD` = your 16-character Gmail App Password (not your login password)
  - `SUPABASE_URL` = your project URL (auto-set)
  - `SUPABASE_ANON_KEY` = your anon key (auto-set)
  - `SUPABASE_SERVICE_ROLE_KEY` = your service role key (auto-set)
- [ ] Edge Functions deployed: `npx supabase functions deploy`
- [ ] At least one `system_admin` profile exists in the `profiles` table
- [ ] `app_config` table has `brand_name` set

### 2. Frontend Build
- [ ] `.env.local` has correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm test` passes
- [ ] `npm run build` completes without errors
- [ ] `dist/` folder is generated

### 3. Hostinger Upload
- [ ] Upload entire contents of `dist/` to Hostinger public folder (e.g. `public_html/`)
- [ ] Hostinger has a `.htaccess` or redirect rule to serve `index.html` for all routes (SPA fallback):
  ```
  Options -MultiViews
  RewriteEngine On
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteRule ^ index.html [QSA,L]
  ```
- [ ] Site loads at `https://your-hostinger-domain.com`
- [ ] Login page appears (not a blank screen or 404)

### 4. Smoke Test After Deploy
- [ ] Log in with admin account
- [ ] Inventory page loads with data
- [ ] Create and dispatch one test transfer — confirm email arrives
- [ ] Open receipt link from email — confirm it works
- [ ] Check Supabase dashboard → Logs → Edge Functions for any errors

### 5. Before Opening to Full Team
- [ ] Pilot scenarios above all passed
- [ ] All pilot feedback issues resolved
- [ ] User accounts created for all DC staff
- [ ] Staff briefed on the URL and login credentials
- [ ] Someone designated as `dc_admin` for day-to-day management
