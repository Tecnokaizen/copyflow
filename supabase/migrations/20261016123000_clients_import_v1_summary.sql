-- Gestcopy Migration V1 · client import: the review summary only looks up the
-- clients of the rows it returns (#110). Follows 20261016122000 (all applied in
-- Staging only).
--
-- Staging QA: right after classifying a fresh 10 000-row batch, the summary took
-- 4.2 s. It joined every row of the batch with public.clients (8 241 matched
-- clients, random reads on small compute) and only then kept the first 200. It
-- now picks the rows first (top-N over the batch) and looks up at most p_limit
-- (≤ 200) clients. Same signature, same output.

begin;

create or replace function public.client_import_summary(p_batch_id uuid, p_limit integer default 50)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_batch imports_private.client_import_batches%rowtype;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  select b.tenant_id into v_tenant from imports_private.client_import_batches b where b.id = p_batch_id;
  if v_tenant is null
     or not public.has_active_tenant_role(v_tenant, array['owner', 'admin', 'manager']::text[]) then
    raise exception 'import batch not found' using errcode = 'P0002';
  end if;
  perform imports_private.assert_import_access(v_tenant);
  select * into v_batch from imports_private.client_import_batches b where b.id = p_batch_id;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object(
    'rows', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'row_number', r.row_number,
          'source_record_id', r.source_record_id,
          'name', r.normalized ->> 'name',
          'email', r.normalized ->> 'email',
          'phone', r.normalized ->> 'phone',
          'tax_id', r.normalized ->> 'tax_id',
          'classification', r.classification,
          'decision', r.decision,
          'errors', r.errors,
          'warnings', r.warnings,
          'match_reasons', pg_catalog.to_jsonb(r.match_reasons),
          'matched_row_number', r.matched_row_number,
          'matched_client', case when c.id is null then null
            else pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active) end,
          'result', r.result,
          'result_reason', r.result_reason
        ) order by r.row_number)
      from (
        -- Rows that need attention first; valid ones only fill the rest.
        select r0.*
        from imports_private.client_import_rows r0
        where r0.batch_id = v_batch.id
        order by (r0.classification = 'valid'), r0.row_number
        limit v_limit
      ) r
      left join public.clients c on c.id = r.matched_client_id and c.tenant_id = v_batch.tenant_id
    ), '[]'::jsonb)
  );
end;
$function$;

commit;
