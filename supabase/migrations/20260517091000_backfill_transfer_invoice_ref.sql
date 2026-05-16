-- Backfill invoice_ref for existing transfers that were created before the
-- generate_invoice_ref function was added. Calls the function once per transfer
-- ordered by created_at so sequence numbers are assigned chronologically.

do $$
declare
  r record;
  v_source_site_id uuid;
begin
  for r in
    select t.id, t.source_site_id
    from   public.transfers t
    where  t.invoice_ref is null
    order  by t.created_at asc
  loop
    update public.transfers
    set    invoice_ref = public.generate_invoice_ref(r.source_site_id),
           updated_at  = now()
    where  id = r.id;
  end loop;
end;
$$;
