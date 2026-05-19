-- Backfill analytics_rows with correct site_codes
-- Handles cases where site_code was already truncated to "MOBILECARE" by old normalizeSiteCode

-- Step 1: Update rows where site_code matches site_name exactly (case-insensitive)
update public.analytics_rows ar
set site_code = s.site_code
from public.sites s
where upper(trim(ar.site_code)) = upper(trim(s.site_name))
  and ar.site_code != s.site_code;

-- Step 2: Update rows where site_code matches last segment of site_name after " - "
update public.analytics_rows ar
set site_code = s.site_code
from public.sites s
where upper(trim(ar.site_code)) = upper(trim(split_part(s.site_name, ' - ', 2)))
  and split_part(s.site_name, ' - ', 2) != ''
  and ar.site_code != s.site_code;

-- Step 3: Update rows where site_code matches ship_to_code (numeric, strip leading zeros)
update public.analytics_rows ar
set site_code = s.site_code
from public.sites s
where s.ship_to_code is not null
  and ltrim(ar.site_code, '0') = ltrim(s.ship_to_code, '0')
  and ar.site_code != s.site_code;

-- Step 4: Refresh summary
select public.refresh_analytics_summary();
