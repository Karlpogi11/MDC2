-- Fix generate_invoice_ref to use the source site's invoice_prefix
-- regardless of whether it is a DC site or not.
create or replace function public.generate_invoice_ref(
  p_site_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = 'public'
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
  if p_site_id is not null then
    select nullif(trim(invoice_prefix), '')
    into   v_prefix
    from   public.sites
    where  id = p_site_id;
  end if;

  if v_prefix is null then
    v_prefix := 'DC';
  end if;

  select id, current_letter, current_number
  into   v_seq_id, curr_letter, curr_number
  from   public.invoice_sequence
  where  (p_site_id is null     and site_id is null)
      or (p_site_id is not null and site_id = p_site_id)
  for update skip locked;

  if not found then
    select id, current_letter, current_number
    into   v_seq_id, curr_letter, curr_number
    from   public.invoice_sequence
    where  (p_site_id is null     and site_id is null)
        or (p_site_id is not null and site_id = p_site_id)
    for update;
  end if;

  if not found then
    insert into public.invoice_sequence (prefix, site_id, current_letter, current_number)
    values (v_prefix, p_site_id, 'A', 0)
    returning id, current_letter, current_number
    into v_seq_id, curr_letter, curr_number;
  end if;

  if curr_number >= 999 then
    new_letter := case when curr_letter = 'Z' then 'A'
                       else chr(ascii(curr_letter) + 1) end;
    new_number := 1;
  else
    new_letter := curr_letter;
    new_number := curr_number + 1;
  end if;

  update public.invoice_sequence
  set    current_letter = new_letter,
         current_number = new_number,
         updated_at     = now()
  where  id = v_seq_id;

  ref := v_prefix
      || '-' || to_char(now(), 'YYYYMMDD')
      || '-' || new_letter
      || lpad(new_number::text, 3, '0');

  return ref;
end;
$$;

grant execute on function public.generate_invoice_ref(uuid) to authenticated;
