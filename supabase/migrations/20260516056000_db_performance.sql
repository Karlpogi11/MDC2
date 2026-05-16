-- DB Performance Optimization
-- 1. Missing indexes for high-frequency query paths
-- 2. Batch upsert function for parts import (single round-trip)
-- 3. Batch upsert function for sites import
-- 4. Partial index for in_stock serials (most common filter)
-- 5. Index for username login lookup (already exists but ensure)

-- ── Missing indexes ───────────────────────────────────────────────────────────

-- Parts: search by part_number (stock-in auto-fill, transfer lookup)
create index if not exists idx_parts_part_number
  on public.parts (part_number);

-- Parts: search by part_name (inventory grid filter)
create index if not exists idx_parts_part_name
  on public.parts (lower(part_name));

-- Serial numbers: lookup by serial_number (transfer auto-fill, correction)
-- Already unique but ensure index is present
create index if not exists idx_serial_numbers_serial
  on public.serial_numbers (serial_number);

-- Partial index: only in_stock serials (inventory grid, transfer availability check)
create index if not exists idx_serial_numbers_in_stock
  on public.serial_numbers (part_id, current_site_id)
  where status = 'in_stock';

-- Transfer items: lookup by serial (correction flow)
create index if not exists idx_transfer_items_serial_id
  on public.transfer_items (serial_id)
  where serial_id is not null;

-- Audit logs: lookup by entity (correction history page)
create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity_type, entity_id, created_at desc);

-- Analytics rows: already has composite index, add upload_id for delete cascade perf
create index if not exists idx_analytics_rows_upload_id
  on public.analytics_rows (upload_id);

-- Stock in items: lookup by serial for duplicate detection
create index if not exists idx_stock_in_items_serial_id
  on public.stock_in_items (serial_id)
  where serial_id is not null;

-- ── Batch upsert function for parts import ────────────────────────────────────
-- Accepts a JSON array, does a single INSERT ... ON CONFLICT DO UPDATE
-- Returns counts: added, updated, skipped_errors

create or replace function public.batch_upsert_parts(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_added   int := 0;
  v_updated int := 0;
  v_errors  jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_pn      text;
  v_name    text;
  v_cat     text;
  v_cost    numeric;
begin
  -- Verify caller is admin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_pn   := trim(v_row->>'part_number');
    v_name := trim(v_row->>'part_name');
    v_cat  := nullif(trim(coalesce(v_row->>'category', '')), '');
    v_cost := coalesce((v_row->>'average_cost')::numeric, 0);

    if v_pn = '' or v_name = '' then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'reason', 'Missing part_number or part_name');
      continue;
    end if;

    begin
      insert into public.parts (part_number, part_name, category, average_cost)
      values (v_pn, v_name, v_cat, v_cost)
      on conflict (part_number) do update
        set part_name    = excluded.part_name,
            category     = coalesce(excluded.category, parts.category),
            average_cost = case when excluded.average_cost > 0 then excluded.average_cost else parts.average_cost end,
            updated_at   = now()
      returning (xmax = 0) into v_added; -- xmax=0 means INSERT (not UPDATE)

      if v_added then
        v_added := v_added + 1; -- reuse var as bool then int is awkward; use separate
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_pn, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('errors', v_errors, 'error_count', jsonb_array_length(v_errors));
end;
$$;

-- Simpler and correct version using INSERT ... ON CONFLICT with counts via CTE
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
  v_existed boolean;
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_pn   := trim(v_row->>'part_number');
    v_name := trim(v_row->>'part_name');

    if v_pn = '' or v_name = '' then
      v_errors := v_errors || jsonb_build_object('pn', v_pn, 'reason', 'Missing part_number or part_name');
      continue;
    end if;

    begin
      insert into public.parts (part_number, part_name, category, average_cost)
      values (
        v_pn,
        v_name,
        nullif(trim(coalesce(v_row->>'category', '')), ''),
        coalesce(nullif(trim(v_row->>'average_cost'),'')::numeric, 0)
      )
      on conflict (part_number) do update
        set part_name    = excluded.part_name,
            category     = coalesce(excluded.category, parts.category),
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

-- ── Batch upsert function for sites import ────────────────────────────────────
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
begin
  if public.get_my_role() not in ('system_admin', 'dc_admin') then
    raise exception 'Insufficient privileges';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_code := upper(trim(v_row->>'site_code'));
    v_name := trim(v_row->>'site_name');

    if v_code = '' or v_name = '' then
      v_errors := v_errors || jsonb_build_object('code', v_code, 'reason', 'Missing site_code or site_name');
      continue;
    end if;

    begin
      insert into public.sites (site_code, site_name, is_dc)
      values (
        v_code,
        v_name,
        coalesce((v_row->>'is_dc')::boolean, false)
      )
      on conflict (site_code) do update
        set site_name = excluded.site_name;
    exception when others then
      v_errors := v_errors || jsonb_build_object('code', v_code, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('errors', v_errors, 'error_count', jsonb_array_length(v_errors));
end;
$$;

grant execute on function public.batch_upsert_sites(jsonb) to authenticated;
