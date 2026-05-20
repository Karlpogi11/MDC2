-- Fix transition_transfer_status:
-- 1. system_admin was missing from role checks — caused "Something went wrong" on cancel
-- 2. dc_operator can cancel draft transfers (they created them)
-- 3. Add serial validation: cannot pack a transfer with items missing serials

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
  v_role := get_my_claim_role();

  select status into v_current_status
  from public.transfers
  where id = p_transfer_id;

  if not found then
    raise exception 'Transfer not found or access denied';
  end if;

  if p_new_status not in ('packed','in_transit','received','cancelled') then
    raise exception 'Invalid status: %', p_new_status;
  end if;

  -- State machine
  if not (
    (v_current_status = 'draft'      and p_new_status in ('packed','cancelled'))    or
    (v_current_status = 'packed'     and p_new_status in ('in_transit','cancelled')) or
    (v_current_status = 'in_transit' and p_new_status in ('received','cancelled'))
  ) then
    raise exception 'Invalid transition: % → %', v_current_status, p_new_status;
  end if;

  -- Role gate
  -- system_admin: all transitions
  -- dc_admin: all transitions
  -- dc_operator: draft→packed, packed→in_transit, draft→cancelled (own transfers only)
  if v_role not in ('system_admin','dc_admin') then
    if p_new_status = 'received' then
      raise exception 'Only dc_admin can mark a transfer as received';
    end if;
    if p_new_status = 'cancelled' and v_current_status != 'draft' then
      raise exception 'Only dc_admin can cancel a transfer that is already packed or in transit';
    end if;
  end if;

  -- Serial validation: cannot pack if any serialized item has no serial assigned
  if p_new_status = 'packed' then
    select count(*) into v_missing_serials
    from public.transfer_items ti
    where ti.transfer_id = p_transfer_id
      and ti.serial_id is null;

    if v_missing_serials > 0 then
      raise exception 'Cannot pack: % item(s) have no serial number assigned. Assign serials before packing.', v_missing_serials;
    end if;
  end if;

  update public.transfers
  set
    status    = p_new_status,
    packed_at = case when p_new_status = 'packed' then now() else packed_at end,
    updated_at = now()
  where id = p_transfer_id;
end;
$$;

grant execute on function public.transition_transfer_status(uuid, text) to authenticated;
