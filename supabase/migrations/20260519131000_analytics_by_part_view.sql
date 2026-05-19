-- Pre-aggregated view: one row per part_number across all sites/months
-- Used by ABC Analysis and Stock Velocity to avoid client-side aggregation issues

create or replace view public.analytics_by_part as
select
  part_number,
  max(part_name) as part_name,
  sum(total_qty)::int as total_qty,
  max(last_used) as last_used
from public.analytics_summary
group by part_number;
