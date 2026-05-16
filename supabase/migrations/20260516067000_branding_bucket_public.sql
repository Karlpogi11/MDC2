-- Make branding bucket public so logo URLs work in <img> tags without signed URLs
update storage.buckets
set public = true
where id = 'branding';
