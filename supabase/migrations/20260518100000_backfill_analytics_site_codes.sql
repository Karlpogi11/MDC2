-- Backfill analytics_rows.site_code: replace ship_to numbers with site_code from sites table
update public.analytics_rows ar
set site_code = s.site_code
from public.sites s
where s.ship_to_code = ar.site_code
  and ar.site_code ~ '^\d+$';  -- only update numeric codes (ship_to numbers)

-- Refresh analytics_summary so charts pick up the new site codes
refresh materialized view public.analytics_summary;
