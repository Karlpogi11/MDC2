-- Add invoice_ref to transfers (partspal format: PREFIX-YYYYMMDD-LNNN)
alter table public.transfers
  add column if not exists invoice_ref text;

-- Sequence table for per-site invoice numbering
create table if not exists public.invoice_sequence (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid references public.sites(id) on delete cascade,
  prefix         text not null,
  current_letter text not null default 'A',
  current_number int  not null default 0,
  updated_at     timestamptz not null default now(),
  unique (site_id)
);

alter table public.invoice_sequence enable row level security;
create policy "invoice_seq_service_only" on public.invoice_sequence
  using (false) with check (false);

-- generate_invoice_ref(p_site_id) — matches partspal format exactly
-- Uses source site's invoice_prefix. Falls back to 'DC' if none set.
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
    select invoice_prefix
    into   v_prefix
    from   public.sites
    where  id    = p_site_id
      and  is_dc = false;
  end if;

  if v_prefix is null or v_prefix = '' then
    p_site_id := null;
    v_prefix  := 'DC';
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
