-- Update batch_upsert_sites to support invoice_prefix column

create or replace function public.batch_upsert_sites(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_row    jsonb;
  v_code   text;
  v_name   text;
  v_prefix text;
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_code   := upper(trim(v_row->>'site_code'));
    v_name   := trim(v_row->>'site_name');
    v_prefix := nullif(trim(coalesce(v_row->>'invoice_prefix', '')), '');

    if v_code = '' or v_name = '' then
      v_errors := v_errors || jsonb_build_object('code', v_code, 'reason', 'Missing site_code or site_name');
      continue;
    end if;

    begin
      insert into public.sites (site_code, site_name, is_dc, invoice_prefix)
      values (
        v_code,
        v_name,
        coalesce((v_row->>'is_dc')::boolean, false),
        v_prefix
      )
      on conflict (site_code) do update
        set site_name      = excluded.site_name,
            invoice_prefix = coalesce(excluded.invoice_prefix, sites.invoice_prefix);
    exception when others then
      v_errors := v_errors || jsonb_build_object('code', v_code, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('errors', v_errors, 'error_count', jsonb_array_length(v_errors));
end;
$$;

grant execute on function public.batch_upsert_sites(jsonb) to authenticated;
