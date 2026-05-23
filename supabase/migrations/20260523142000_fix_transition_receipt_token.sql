-- Fix: transition_transfer_status used gen_random_bytes (pgcrypto) which is not
-- available on this Supabase project. Replace with gen_random_uuid() which is
-- always available. Two UUIDs concatenated (stripped of dashes) = 64 hex chars.

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
  v_token          text;
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

  -- Generate receipt token when dispatching (in_transit).
  -- Uses gen_random_uuid() (always available) instead of pgcrypto's gen_random_bytes.
  if p_new_status = 'in_transit' then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  end if;

  perform set_config('app.allow_transfer_status_update', 'on', true);

  update public.transfers
  set
    status                   = p_new_status,
    packed_at                = case when p_new_status = 'packed'     then now() else packed_at end,
    receipt_token            = case when p_new_status = 'in_transit' then v_token else receipt_token end,
    receipt_token_expires_at = case when p_new_status = 'in_transit' then now() + interval '30 days' else receipt_token_expires_at end,
    updated_at               = now()
  where id = p_transfer_id;
end;
$$;

grant execute on function public.transition_transfer_status(uuid, text) to authenticated;
revoke execute on function public.transition_transfer_status(uuid, text) from anon, public;
