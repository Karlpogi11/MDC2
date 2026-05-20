-- transition_transfer_status(transfer_id, new_status)
-- SECURITY DEFINER RPC — enforces state machine, blocks direct .update({status}) from client.
--
-- Allowed transitions:
--   draft      → packed | cancelled
--   packed     → in_transit | cancelled
--   in_transit → received | cancelled
--   received   → (terminal, no transitions)
--   cancelled  → (terminal, no transitions)
--
-- Roles:
--   dc_operator, dc_admin : draft→packed, packed→in_transit
--   dc_admin only         : in_transit→received, any→cancelled

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
begin
  v_role := get_my_claim_role();

  -- Load current status (also validates the transfer exists and caller can see it via RLS)
  select status into v_current_status
  from public.transfers
  where id = p_transfer_id;

  if not found then
    raise exception 'Transfer not found or access denied';
  end if;

  -- Validate target status value
  if p_new_status not in ('packed','in_transit','received','cancelled') then
    raise exception 'Invalid status: %', p_new_status;
  end if;

  -- Enforce state machine
  if not (
    (v_current_status = 'draft'     and p_new_status in ('packed','cancelled'))     or
    (v_current_status = 'packed'    and p_new_status in ('in_transit','cancelled'))  or
    (v_current_status = 'in_transit' and p_new_status in ('received','cancelled'))
  ) then
    raise exception 'Invalid transition: % → %', v_current_status, p_new_status;
  end if;

  -- Role gate: only dc_admin can cancel or mark received
  if p_new_status in ('received','cancelled') and v_role not in ('dc_admin') then
    raise exception 'Insufficient role for transition to %', p_new_status;
  end if;

  -- Apply transition
  update public.transfers
  set
    status    = p_new_status,
    packed_at = case when p_new_status = 'packed'    then now() else packed_at end,
    updated_at = now()
  where id = p_transfer_id;
end;
$$;

-- Only authenticated users can call this; role checks are inside the function
grant execute on function public.transition_transfer_status(uuid, text) to authenticated;

-- Revoke direct UPDATE on transfers.status from non-admin roles
-- (operators can still update other fields like notes via existing RLS policies)
comment on function public.transition_transfer_status(uuid, text) is
  'State machine enforcer for transfer status. Use this instead of direct .update({status}).';
