-- analytics_uploads delete policy: dc_admin and above can delete uploads
-- analytics_rows are cascade-deleted automatically via FK on delete cascade
drop policy if exists analytics_uploads_delete on public.analytics_uploads;

create policy analytics_uploads_delete on public.analytics_uploads
  for delete to authenticated
  using (public.get_my_claim_role() in ('system_admin', 'dc_admin'));
