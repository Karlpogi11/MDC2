-- Re-run backfill with explicit cast and refresh
update public.analytics_rows ar
set site_code = s.site_code
from public.sites s
where s.ship_to_code is not null
  and s.ship_to_code = ar.site_code;

-- Force refresh
refresh materialized view public.analytics_summary;
