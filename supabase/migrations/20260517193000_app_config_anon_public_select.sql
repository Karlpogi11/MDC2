-- Allow anonymous token-based pages to read non-sensitive app configuration.
-- Needed so receive links can honor the configured receive_mode.

grant select on public.app_config to anon;

drop policy if exists app_config_anon_public_select on public.app_config;
create policy app_config_anon_public_select on public.app_config
  for select to anon
  using (
    key in (
      'brand_name',
      'brand_logo_url',
      'brand_primary_color',
      'brand_accent_color',
      'support_email',
      'login_notice',
      'receive_mode'
    )
  );
