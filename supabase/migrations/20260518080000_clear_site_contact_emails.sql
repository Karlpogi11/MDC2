-- Clear all contact emails — will be set manually before go-live
update public.sites set contact_emails = ARRAY[]::text[];
