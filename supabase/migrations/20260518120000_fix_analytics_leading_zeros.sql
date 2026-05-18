-- Fix: match ship_to by stripping leading zeros from analytics_rows.site_code
update public.analytics_rows ar
set site_code = s.site_code
from public.sites s
where s.ship_to_code is not null
  and ltrim(ar.site_code, '0') = s.ship_to_code;

-- Refresh analytics_summary
refresh materialized view public.analytics_summary;
