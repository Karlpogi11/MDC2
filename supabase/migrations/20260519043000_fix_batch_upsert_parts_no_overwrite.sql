-- Fix batch_upsert_parts: do not overwrite part_name if it already exists
-- Only update part_name when the existing value is null/empty (first-time set)

create or replace function public.batch_upsert_parts(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_errors  jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_pn      text;
  v_name    text;
  v_cat     text;
  v_cost    numeric;
  v_ptype   text;
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_pn   := trim(v_row->>'part_number');
    v_name := trim(v_row->>'part_name');
    v_cat  := nullif(trim(coalesce(v_row->>'category', '')), '');
    v_cost := coalesce(nullif(trim(coalesce(v_row->>'average_cost','')), '')::numeric, 0);

    v_ptype := coalesce(
      nullif(trim(coalesce(v_row->>'part_type', '')), ''),
      case when lower(coalesce(v_cat, '')) like '%material%' then 'material' else 'product' end
    );

    if v_pn = '' or v_name = '' then
      v_errors := v_errors || jsonb_build_object('pn', v_pn, 'reason', 'Missing part_number or part_name');
      continue;
    end if;

    begin
      insert into public.parts (part_number, part_name, category, average_cost, part_type)
      values (v_pn, v_name, v_cat, v_cost, v_ptype)
      on conflict (part_number) do update
        -- Never overwrite an existing part_name — only set if currently blank
        set part_name    = case when parts.part_name is null or parts.part_name = ''
                           then excluded.part_name else parts.part_name end,
            category     = coalesce(excluded.category, parts.category),
            part_type    = excluded.part_type,
            average_cost = case when excluded.average_cost > 0
                           then excluded.average_cost
                           else parts.average_cost end;
    exception when others then
      v_errors := v_errors || jsonb_build_object('pn', v_pn, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('errors', v_errors, 'error_count', jsonb_array_length(v_errors));
end;
$$;

grant execute on function public.batch_upsert_parts(jsonb) to authenticated;
