-- Create storage buckets for MDC
-- All buckets are private (public = false)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('branding',          'branding',          false, 2097152,   array['image/png','image/jpeg','image/svg+xml','image/webp','image/x-icon']),
  ('imports-stockin',   'imports-stockin',   false, 10485760,  array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']),
  ('imports-analytics', 'imports-analytics', false, 10485760,  array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']),
  ('packing-lists',     'packing-lists',     false, 5242880,   array['application/pdf'])
on conflict (id) do nothing;

-- Storage RLS policies

-- branding: system_admin can upload; all authenticated can read
create policy "branding_read" on storage.objects for select to authenticated
  using (bucket_id = 'branding');

create policy "branding_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.get_my_role() = 'system_admin');

create policy "branding_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.get_my_role() = 'system_admin');

-- imports-stockin: operator+ can upload; admin+ can read
create policy "stockin_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'imports-stockin' and public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

create policy "stockin_read" on storage.objects for select to authenticated
  using (bucket_id = 'imports-stockin' and public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- imports-analytics: operator+ can upload/read
create policy "analytics_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'imports-analytics' and public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

create policy "analytics_read" on storage.objects for select to authenticated
  using (bucket_id = 'imports-analytics' and public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

-- packing-lists: operator+ can write; all authenticated can read (for download)
create policy "packinglists_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'packing-lists' and public.get_my_role() in ('system_admin','dc_admin','dc_operator'));

create policy "packinglists_read" on storage.objects for select to authenticated
  using (bucket_id = 'packing-lists');
