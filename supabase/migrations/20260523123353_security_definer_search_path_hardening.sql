-- Pin SECURITY DEFINER functions that predated the hardening migration.
-- This prevents caller-controlled search_path values from influencing
-- privileged helper functions.

alter function public.apply_part_reassignment(uuid, uuid, text, uuid)
  set search_path = public;

alter function public.batch_upsert_parts(jsonb)
  set search_path = public;

alter function public.batch_upsert_sites(jsonb)
  set search_path = public;

alter function public.get_email_for_username(text)
  set search_path = public;

alter function public.reset_inventory_data()
  set search_path = public;

alter function public.sync_serial_status_on_transfer()
  set search_path = public;
