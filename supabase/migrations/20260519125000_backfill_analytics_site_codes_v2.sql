-- Backfill analytics_rows where site_code was stored as "MOBILECARE" or "MOBILECARE - X"
-- Match last segment after " - " against sites.site_name

update public.analytics_rows ar
set site_code = s.site_code
from public.sites s
where (
  -- "MOBILECARE - THE PODIUM" → last segment "THE PODIUM" matches site_name
  upper(trim(split_part(ar.site_code, ' - ', 2))) = upper(trim(s.site_name))
  or
  -- exact full match "THE PODIUM" = site_name
  upper(trim(ar.site_code)) = upper(trim(s.site_name))
  or
  -- numeric ship_to_code match
  (s.ship_to_code is not null and ltrim(ar.site_code, '0') = ltrim(s.ship_to_code, '0'))
)
and ar.site_code != s.site_code;

-- Also refresh analytics_summary after backfill
select public.refresh_analytics_summary();
