-- Security/access hardening sweep.
-- - Make role checks DB-backed so role changes/inactive users take effect immediately.
-- - Align user management to system_admin only.
-- - Block direct transfer.status updates outside the state-machine/token RPCs.
-- - Fix the received/cancelled serial trigger to use the live in_transit status.
-- - Reduce public EXECUTE exposure on app-owned SECURITY DEFINER functions.

-- Fresh, active profile role for the current request. The local transaction cache
-- avoids repeated profile lookups within a single statement/request.
create or replace function public.get_my_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := current_setting('app.user_role', true);
  if v_role is not null and v_role <> '' then
    return v_role;
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid()
    and is_active = true
  limit 1;

  if v_role is not null then
    perform set_config('app.user_role', v_role, true);
  end if;

  return v_role;
end;
$$;

-- Keep the existing function name used by policies, but prefer the DB-backed
-- role over auth.jwt() so demotions/deactivations are effective immediately.
create or replace function public.get_my_claim_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.get_my_role();
$$;

grant execute on function public.get_my_role() to authenticated;
grant execute on function public.get_my_claim_role() to authenticated;
revoke execute on function public.get_my_role() from anon, public;
revoke execute on function public.get_my_claim_role() from anon, public;

-- User/profile management: system_admin only for managing other users.
drop policy if exists profiles_update_system_admin on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_insert_system_admin on public.profiles;

create policy profiles_insert_system_admin on public.profiles
  for insert to authenticated
  with check (public.get_my_claim_role() = 'system_admin');

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    public.get_my_claim_role() = 'system_admin'
    or id = auth.uid()
  )
  with check (
    public.get_my_claim_role() = 'system_admin'
    or (
      id = auth.uid()
      and role = (select p.role from public.profiles p where p.id = auth.uid())
    )
  );

-- Keep later feature policies aligned with the route matrix: system_admin is
-- part of every admin/operator/viewer superset.
drop policy if exists transfer_templates_select on public.transfer_templates;
create policy transfer_templates_select on public.transfer_templates
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

drop policy if exists transfer_template_items_select on public.transfer_template_items;
create policy transfer_template_items_select on public.transfer_template_items
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

drop policy if exists transfer_emails_select on public.transfer_emails;
create policy transfer_emails_select on public.transfer_emails
  for select to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin','dc_operator','dc_viewer'));

drop policy if exists transfer_emails_write on public.transfer_emails;
create policy transfer_emails_write on public.transfer_emails
  for all to authenticated
  using (public.get_my_claim_role() in ('system_admin','dc_admin'))
  with check (public.get_my_claim_role() in ('system_admin','dc_admin'));

-- State-machine guard for transfer.status. Direct client updates to status are
-- blocked even when broad UPDATE RLS allows edits to other transfer fields.
create or replace function public.prevent_direct_transfer_status_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_transfer_status_update', true), '') <> 'on' then
    raise exception 'Use transition_transfer_status or confirm_receipt_by_token to change transfer status';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_direct_transfer_status_update on public.transfers;
create trigger trg_prevent_direct_transfer_status_update
  before update of status on public.transfers
  for each row execute function public.prevent_direct_transfer_status_update();

create or replace function public.transition_transfer_status(
  p_transfer_id uuid,
  p_new_status  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_role           text;
  v_missing_serials int;
begin
  v_role := public.get_my_claim_role();

  select status into v_current_status
  from public.transfers
  where id = p_transfer_id;

  if not found then
    raise exception 'Transfer not found or access denied';
  end if;

  if p_new_status not in ('packed','in_transit','received','cancelled') then
    raise exception 'Invalid status: %', p_new_status;
  end if;

  if not (
    (v_current_status = 'draft'      and p_new_status in ('packed','cancelled')) or
    (v_current_status = 'packed'     and p_new_status in ('in_transit','cancelled')) or
    (v_current_status = 'in_transit' and p_new_status in ('received','cancelled'))
  ) then
    raise exception 'Invalid transition: % -> %', v_current_status, p_new_status;
  end if;

  if v_role not in ('system_admin','dc_admin') then
    if p_new_status = 'received' then
      raise exception 'Only dc_admin can mark a transfer as received';
    end if;
    if p_new_status = 'cancelled' and v_current_status <> 'draft' then
      raise exception 'Only dc_admin can cancel a transfer that is already packed or in transit';
    end if;
  end if;

  if v_role not in ('system_admin','dc_admin','dc_operator') then
    raise exception 'Insufficient role for transfer transition';
  end if;

  if p_new_status = 'packed' then
    select count(*) into v_missing_serials
    from public.transfer_items ti
    where ti.transfer_id = p_transfer_id
      and ti.serial_id is null
      and exists (
        select 1
        from public.serial_numbers sn
        where sn.part_id = ti.part_id
          and sn.status = 'in_stock'
      );

    if v_missing_serials > 0 then
      raise exception 'Cannot pack: % item(s) have available serials but none assigned. Assign serials before packing.', v_missing_serials;
    end if;
  end if;

  perform set_config('app.allow_transfer_status_update', 'on', true);

  update public.transfers
  set
    status     = p_new_status,
    packed_at  = case when p_new_status = 'packed' then now() else packed_at end,
    updated_at = now()
  where id = p_transfer_id;
end;
$$;

grant execute on function public.transition_transfer_status(uuid, text) to authenticated;
revoke execute on function public.transition_transfer_status(uuid, text) from anon, public;

-- Token receive page RPCs remain intentionally callable by anon, but validate a
-- high-entropy token shape before touching transfer data.
create or replace function public.get_transfer_by_token(
  p_transfer_id uuid,
  p_token       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer record;
  v_items    json;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN';
  end if;

  select
    t.id, t.transfer_no, t.invoice_ref, t.status,
    t.receipt_token, t.receipt_token_expires_at,
    src.site_name as source_site_name,
    dst.id        as destination_site_id,
    dst.site_name as destination_site_name
  into v_transfer
  from public.transfers t
  join public.sites src on src.id = t.source_site_id
  join public.sites dst on dst.id = t.destination_site_id
  where t.id = p_transfer_id;

  if not found then
    raise exception 'TRANSFER_NOT_FOUND';
  end if;

  if v_transfer.receipt_token is null or v_transfer.receipt_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  if v_transfer.receipt_token_expires_at is null or v_transfer.receipt_token_expires_at < now() then
    raise exception 'TOKEN_EXPIRED';
  end if;

  select json_agg(json_build_object(
    'id',            ti.id,
    'qty',           ti.qty,
    'serial_number', sn.serial_number,
    'part_number',   p.part_number,
    'part_name',     p.part_name
  ))
  into v_items
  from public.transfer_items ti
  left join public.serial_numbers sn on sn.id = ti.serial_id
  left join public.parts p on p.id = ti.part_id
  where ti.transfer_id = p_transfer_id;

  return json_build_object(
    'id',                    v_transfer.id,
    'transfer_no',           v_transfer.transfer_no,
    'invoice_ref',           v_transfer.invoice_ref,
    'status',                v_transfer.status,
    'source_site_name',      v_transfer.source_site_name,
    'destination_site_id',   v_transfer.destination_site_id,
    'destination_site_name', v_transfer.destination_site_name,
    'items',                 coalesce(v_items, '[]'::json)
  );
end;
$$;

create or replace function public.confirm_receipt_by_token(
  p_transfer_id uuid,
  p_token       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer record;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN';
  end if;

  select id, status, receipt_token, receipt_token_expires_at, destination_site_id
  into v_transfer
  from public.transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'TRANSFER_NOT_FOUND';
  end if;

  if v_transfer.receipt_token is null or v_transfer.receipt_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  if v_transfer.receipt_token_expires_at is null or v_transfer.receipt_token_expires_at < now() then
    raise exception 'TOKEN_EXPIRED';
  end if;

  if v_transfer.status <> 'in_transit' then
    raise exception 'INVALID_STATUS';
  end if;

  perform set_config('app.allow_transfer_status_update', 'on', true);

  update public.transfers
  set status = 'received',
      receipt_token = null,
      updated_at = now()
  where id = p_transfer_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.get_transfer_by_token(uuid, text) to anon, authenticated;
grant execute on function public.confirm_receipt_by_token(uuid, text) to anon, authenticated;
revoke execute on function public.get_transfer_by_token(uuid, text) from public;
revoke execute on function public.confirm_receipt_by_token(uuid, text) from public;

create or replace function public.sync_serial_status_on_transfer_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'received' and old.status <> 'received' then
    update public.serial_numbers sn
    set status          = 'transferred',
        current_site_id = new.destination_site_id,
        updated_at      = now()
    from public.transfer_items ti
    where ti.transfer_id = new.id
      and ti.serial_id = sn.id
      and sn.status = 'in_transit';

  elsif new.status = 'cancelled' and old.status in ('draft','packed','in_transit') then
    update public.serial_numbers sn
    set status     = 'in_stock',
        updated_at = now()
    from public.transfer_items ti
    where ti.transfer_id = new.id
      and ti.serial_id = sn.id
      and sn.status = 'in_transit';
  end if;

  return new;
end;
$$;

-- Role-gate invoice generation and template-based transfer creation.
create or replace function public.generate_invoice_ref(p_site_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq_id       uuid;
  v_prefix       text;
  curr_letter    text;
  curr_number    int;
  new_letter     text;
  new_number     int;
  ref            text;
begin
  if public.get_my_claim_role() not in ('system_admin','dc_admin','dc_operator') then
    raise exception 'Insufficient privileges';
  end if;

  if p_site_id is not null then
    select nullif(trim(invoice_prefix), '')
    into v_prefix
    from public.sites
    where id = p_site_id;
  end if;

  if v_prefix is null then
    v_prefix := 'DC';
  end if;

  select id, current_letter, current_number
  into v_seq_id, curr_letter, curr_number
  from public.invoice_sequence
  where (p_site_id is null and site_id is null)
     or (p_site_id is not null and site_id = p_site_id)
  for update;

  if not found then
    insert into public.invoice_sequence (prefix, site_id, current_letter, current_number)
    values (v_prefix, p_site_id, 'A', 0)
    returning id, current_letter, current_number
    into v_seq_id, curr_letter, curr_number;
  end if;

  if curr_number >= 999 then
    new_letter := case when curr_letter = 'Z' then 'A' else chr(ascii(curr_letter) + 1) end;
    new_number := 1;
  else
    new_letter := curr_letter;
    new_number := curr_number + 1;
  end if;

  update public.invoice_sequence
  set current_letter = new_letter,
      current_number = new_number,
      updated_at = now()
  where id = v_seq_id;

  ref := v_prefix || '-' || to_char(now(), 'YYYYMMDD') || '-' || new_letter || lpad(new_number::text, 3, '0');
  return ref;
end;
$$;

create or replace function public.create_transfer_from_template(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tmpl          record;
  dc_site_id    uuid;
  new_id        uuid;
  v_invoice_ref text;
  v_transfer_no text;
  item          record;
begin
  if public.get_my_claim_role() not in ('system_admin','dc_admin','dc_operator') then
    raise exception 'Insufficient privileges';
  end if;

  select t.*
  into tmpl
  from public.transfer_templates t
  where t.id = p_template_id
    and t.is_active = true;

  if not found then
    return null;
  end if;

  select id into dc_site_id
  from public.sites
  where is_dc = true
  limit 1;

  v_transfer_no := 'TR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((floor(random()*9000)+1000)::text, 4, '0');

  insert into public.transfers (
    transfer_no, source_site_id, destination_site_id, status, requested_by
  ) values (
    v_transfer_no, dc_site_id, tmpl.destination_site_id, 'draft', auth.uid()
  ) returning id into new_id;

  select public.generate_invoice_ref(dc_site_id) into v_invoice_ref;
  if v_invoice_ref is not null then
    update public.transfers set invoice_ref = v_invoice_ref where id = new_id;
  end if;

  for item in
    select * from public.transfer_template_items where template_id = p_template_id
  loop
    insert into public.transfer_items (transfer_id, part_id, qty)
    values (new_id, item.part_id, item.qty);
  end loop;

  return new_id;
end;
$$;

grant execute on function public.generate_invoice_ref(uuid) to authenticated;
grant execute on function public.create_transfer_from_template(uuid) to authenticated;
revoke execute on function public.generate_invoice_ref(uuid) from anon, public;
revoke execute on function public.create_transfer_from_template(uuid) from anon, public;

-- Remove unnecessary anon/public execution from app-owned functions. Keep anon
-- only for username login and the signed receive-link RPCs.
revoke execute on function public.get_email_for_username(text) from public;
grant execute on function public.get_email_for_username(text) to anon, authenticated;

revoke execute on function public.apply_part_reassignment(uuid, uuid, text, uuid) from anon, public;
revoke execute on function public.apply_serial_correction(uuid, text, text, uuid, uuid) from anon, public;
revoke execute on function public.batch_upsert_parts(jsonb) from anon, public;
revoke execute on function public.batch_upsert_sites(jsonb) from anon, public;
revoke execute on function public.refresh_analytics_summary() from anon, public;
revoke execute on function public.refresh_inventory_snapshot() from anon, public;
revoke execute on function public.retire_part(uuid, text, uuid) from anon, public;
revoke execute on function public.verify_audit_chain() from anon, public;

-- Service/trigger-only helpers should not be directly callable by clients.
revoke execute on function public.bulk_insert_serials(uuid, jsonb) from anon, authenticated, public;
revoke execute on function public.check_rate_limit(uuid, text, integer, integer) from anon, authenticated, public;
revoke execute on function public.cleanup_idempotency_keys() from anon, authenticated, public;
revoke execute on function public.cleanup_rate_limit_log() from anon, authenticated, public;
revoke execute on function public.create_transfers_from_templates() from anon, authenticated, public;
revoke execute on function public.ensure_transfer_receipt_token() from anon, authenticated, public;
revoke execute on function public.retry_pending_transfer_emails() from anon, authenticated, public;
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
revoke execute on function public.set_updated_at() from anon, authenticated, public;
revoke execute on function public.sync_serial_status_on_transfer() from anon, authenticated, public;
revoke execute on function public.sync_serial_status_on_transfer_status() from anon, authenticated, public;
revoke execute on function public.audit_log_hash_trigger() from anon, authenticated, public;
revoke execute on function public.audit_log_trigger() from anon, authenticated, public;
revoke execute on function public.audit_serial_stock_in() from anon, authenticated, public;
revoke execute on function public.prevent_direct_transfer_status_update() from anon, authenticated, public;

-- Deprecated/danger RPC: leave callable only by service_role until a proper UI
-- path is needed. The current UI does not use this function.
revoke execute on function public.reset_inventory_data() from anon, authenticated, public;

-- Scheduled Edge Function calls should authenticate as service-to-service via
-- the apikey header. Avoid relying on a service role key as a user JWT.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('weekly-digest');
  end if;
exception when others then
  null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'weekly-digest',
      '0 8 * * 1',
      $cmd$
      select net.http_post(
        url := 'https://ldgzyabotayrmkgyjbvp.supabase.co/functions/v1/weekly-digest'::text,
        headers := jsonb_build_object(
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cmd$
    );
  end if;
exception when others then
  null;
end;
$$;
