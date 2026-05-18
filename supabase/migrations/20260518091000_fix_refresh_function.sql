-- Fix refresh function to handle empty view (can't use CONCURRENTLY on empty mat view)
create or replace function public.refresh_analytics_summary()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Try concurrent first (non-blocking), fall back to regular if it fails
  begin
    refresh materialized view concurrently public.analytics_summary;
  exception when others then
    refresh materialized view public.analytics_summary;
  end;
end;
$$;
