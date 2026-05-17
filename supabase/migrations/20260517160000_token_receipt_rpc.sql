-- Public token-based access for the receive page.
-- These functions are security definer so they bypass RLS,
-- but validate the token before returning any data.

-- 1. Read: fetch transfer data by ID + token (for the receive page load)
create or replace function public.get_transfer_by_token(
  p_transfer_id uuid,
  p_token       text
)
returns json
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_transfer record;
  v_items    json;
begin
  select
    t.id, t.transfer_no, t.invoice_ref, t.status,
    t.receipt_token, t.receipt_token_expires_at,
    src.site_name  as source_site_name,
    dst.id         as destination_site_id,
    dst.site_name  as destination_site_name
  into v_transfer
  from public.transfers t
  join public.sites src on src.id = t.source_site_id
  join public.sites dst on dst.id = t.destination_site_id
  where t.id = p_transfer_id;

  if not found then
    raise exception 'TRANSFER_NOT_FOUND';
  end if;

  -- Validate token
  if v_transfer.receipt_token is null or v_transfer.receipt_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  if v_transfer.receipt_token_expires_at < now() then
    raise exception 'TOKEN_EXPIRED';
  end if;

  -- Fetch items
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
  left join public.parts          p  on p.id  = ti.part_id
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

-- 2. Write: confirm receipt by token
create or replace function public.confirm_receipt_by_token(
  p_transfer_id uuid,
  p_token       text
)
returns json
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_transfer record;
begin
  select id, status, receipt_token, receipt_token_expires_at, destination_site_id
  into v_transfer
  from public.transfers
  where id = p_transfer_id;

  if not found then
    raise exception 'TRANSFER_NOT_FOUND';
  end if;

  if v_transfer.receipt_token is null or v_transfer.receipt_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  if v_transfer.receipt_token_expires_at < now() then
    raise exception 'TOKEN_EXPIRED';
  end if;

  if v_transfer.status <> 'in_transit' then
    raise exception 'INVALID_STATUS';
  end if;

  -- Mark received (trigger handles serial status + current_site_id)
  update public.transfers
  set status = 'received', receipt_token = null
  where id = p_transfer_id;

  return json_build_object('ok', true);
end;
$$;

-- Grant to anon and authenticated so the receive page works without login
grant execute on function public.get_transfer_by_token(uuid, text)    to anon, authenticated;
grant execute on function public.confirm_receipt_by_token(uuid, text) to anon, authenticated;
