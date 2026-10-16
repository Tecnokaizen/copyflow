-- Gestcopy Migration V1 · client import: full review before confirming (#110).
-- Follows 20261016124000. The five earlier migrations are applied in Production
-- and are not modified; this one is additive: one nullable column, one private
-- helper, one new RPC, and the same signatures for set_row_decisions, summary
-- and commit_chunk (their output only gains keys).
--
--   * A row can be excluded by the user and included again (excluded_at). The
--     exclusion does not touch the decision: changing the duplicate strategy or
--     reclassifying keeps it, and an included row gets its decision back. Rows
--     with errors or repeated in the file are never importable, so they cannot
--     be excluded or included.
--   * client_import_rows_page: every row of the batch by filter, in pages of up
--     to 200 (keyset on row_number), with the matched client. The review no
--     longer stops at the 200 rows of the summary.
--   * imports_private.batch_plan: what confirming will do, computed from every
--     row of the batch, in disjoint groups that add up to the total: create,
--     fill_blanks, skip (duplicates left out by rule), excluded (by the user),
--     error, duplicate_in_file, unclassified. The summary and every decision
--     return it next to row_version, and the commit only runs on the version
--     whose plan was shown (GC409 otherwise).
--   * commit_chunk skips excluded rows with result_reason 'excluded_by_user'.
--     Rows of batches committed before this migration are never excluded, so
--     their results and reverts do not change.

begin;

alter table imports_private.client_import_rows
  add column excluded_at timestamptz;

-- What confirming the batch will do, from every row. Mirrors commit_chunk:
-- excluded rows are skipped; otherwise the decision create / fill_blanks
-- applies and any other row is skipped, by its classification.
create function imports_private.batch_plan(p_batch_id uuid)
  returns jsonb
  language sql
  stable
  set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'create', pg_catalog.count(*) filter (where p.outcome = 'create'),
    'create_possible', pg_catalog.count(*) filter (where p.outcome = 'create' and p.classification = 'possible_duplicate'),
    'fill_blanks', pg_catalog.count(*) filter (where p.outcome = 'fill_blanks'),
    'skip', pg_catalog.count(*) filter (where p.outcome = 'skip'),
    'skip_existing', pg_catalog.count(*) filter (where p.outcome = 'skip' and p.classification = 'duplicate_existing'),
    'skip_possible', pg_catalog.count(*) filter (where p.outcome = 'skip' and p.classification = 'possible_duplicate'),
    'excluded', pg_catalog.count(*) filter (where p.outcome = 'excluded'),
    'error', pg_catalog.count(*) filter (where p.outcome = 'error'),
    'duplicate_in_file', pg_catalog.count(*) filter (where p.outcome = 'duplicate_in_file'),
    'unclassified', pg_catalog.count(*) filter (where p.outcome = 'unclassified'),
    'total', pg_catalog.count(*)
  )
  from (
    select r.classification,
           case
             when r.excluded_at is not null then 'excluded'
             when r.decision in ('create', 'fill_blanks') then r.decision
             when r.classification is null then 'unclassified'
             when r.classification in ('error', 'duplicate_in_file') then r.classification
             else 'skip'
           end as outcome
    from imports_private.client_import_rows r
    where r.batch_id = p_batch_id
  ) p;
$function$;

create or replace function public.client_import_set_row_decisions(
  p_batch_id uuid,
  p_row_numbers integer[],
  p_decision text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
  v_changed integer;
begin
  if v_batch.status <> 'validated' then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  if p_row_numbers is null or pg_catalog.cardinality(p_row_numbers) not between 1 and 10000
     or coalesce(p_decision, '') not in ('create', 'skip', 'fill_blanks', 'exclude', 'include') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_decision = 'fill_blanks' and v_batch.duplicate_strategy <> 'fill_blanks' then
    raise exception 'fill_blanks requires confirmation' using errcode = '22023';
  end if;
  -- Allowed: possible duplicates -> create|skip; existing duplicates -> skip|fill_blanks;
  -- any importable row (new, possible or existing duplicate) -> exclude|include.
  if exists (
    select 1 from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and r.row_number = any (p_row_numbers)
      and not (
        (r.classification = 'possible_duplicate' and p_decision in ('create', 'skip'))
        or (r.classification = 'duplicate_existing' and p_decision in ('skip', 'fill_blanks'))
        or (r.classification in ('valid', 'possible_duplicate', 'duplicate_existing') and p_decision in ('exclude', 'include'))
      )
  ) then
    raise exception 'decision not allowed for these rows' using errcode = '22023';
  end if;

  if p_decision in ('exclude', 'include') then
    -- Only the exclusion changes: an included row keeps the decision it had.
    update imports_private.client_import_rows r
    set excluded_at = case when p_decision = 'exclude' then pg_catalog.now() end
    where r.batch_id = v_batch.id and r.row_number = any (p_row_numbers)
      and (r.excluded_at is null) = (p_decision = 'exclude');
  else
    update imports_private.client_import_rows r
    set decision = p_decision
    where r.batch_id = v_batch.id and r.row_number = any (p_row_numbers);
  end if;
  get diagnostics v_changed = row_count;

  update imports_private.client_import_batches b
  set row_version = b.row_version + 1, updated_at = pg_catalog.now()
  where b.id = v_batch.id
  returning * into v_batch;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object(
    'changed', v_changed,
    'plan', imports_private.batch_plan(v_batch.id)
  );
end;
$function$;

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
    -- A purged batch has no rows left to plan: only its counters remain.
    'plan', case when v_batch.rows_purged_at is null then imports_private.batch_plan(v_batch.id) end,
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
          'excluded', r.excluded_at is not null,
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

-- Every row of the batch, page by page. Filters: attention (errors, repeated in
-- the file, existing and possible duplicates), each classification, excluded,
-- and the outcomes of the plan (create, fill_blanks, skip); all. The total is
-- that of the filter over the whole batch.
create function public.client_import_rows_page(
  p_batch_id uuid,
  p_filter text default 'attention',
  p_after_row integer default 0,
  p_limit integer default 50
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_batch imports_private.client_import_batches%rowtype;
  v_filter text := coalesce(p_filter, 'attention');
  v_after integer := greatest(coalesce(p_after_row, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_total integer;
  v_numbers integer[];
  v_more boolean;
begin
  if v_filter not in ('attention', 'all', 'valid', 'error', 'duplicate_in_file', 'duplicate_existing',
                      'possible_duplicate', 'excluded', 'create', 'fill_blanks', 'skip') then
    raise exception 'invalid filter' using errcode = '22023';
  end if;
  select b.tenant_id into v_tenant from imports_private.client_import_batches b where b.id = p_batch_id;
  if v_tenant is null
     or not public.has_active_tenant_role(v_tenant, array['owner', 'admin', 'manager']::text[]) then
    raise exception 'import batch not found' using errcode = 'P0002';
  end if;
  perform imports_private.assert_import_access(v_tenant);
  select * into v_batch from imports_private.client_import_batches b where b.id = p_batch_id;

  -- Same groups as batch_plan for create / fill_blanks / skip / excluded.
  with m as (
    select r.row_number
    from imports_private.client_import_rows r
    where r.batch_id = v_batch.id
      and case v_filter
        when 'all' then true
        when 'attention' then r.classification in ('error', 'duplicate_in_file', 'duplicate_existing', 'possible_duplicate')
        when 'excluded' then r.excluded_at is not null
        when 'create' then r.excluded_at is null and r.decision = 'create'
        when 'fill_blanks' then r.excluded_at is null and r.decision = 'fill_blanks'
        when 'skip' then r.excluded_at is null and r.decision is distinct from 'create'
          and r.decision is distinct from 'fill_blanks'
          and r.classification in ('valid', 'duplicate_existing', 'possible_duplicate')
        else r.classification = v_filter
      end
  )
  select (select pg_catalog.count(*)::integer from m),
         (select pg_catalog.array_agg(x.row_number order by x.row_number)
          from (select m.row_number from m where m.row_number > v_after order by m.row_number limit v_limit + 1) x)
  into v_total, v_numbers;

  v_more := coalesce(pg_catalog.cardinality(v_numbers), 0) > v_limit;
  if v_more then
    v_numbers := v_numbers[1:v_limit];
  end if;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object(
    'filter', v_filter,
    'after_row', v_after,
    'total', v_total,
    'has_more', v_more,
    'next_after_row', case when v_more then v_numbers[v_limit] end,
    'rows', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'row_number', r.row_number,
          'source_record_id', r.source_record_id,
          'name', r.normalized ->> 'name',
          'company_name', r.normalized ->> 'company_name',
          'email', r.normalized ->> 'email',
          'phone', r.normalized ->> 'phone',
          'tax_id', r.normalized ->> 'tax_id',
          'classification', r.classification,
          'decision', r.decision,
          'excluded', r.excluded_at is not null,
          'errors', r.errors,
          'warnings', r.warnings,
          'match_reasons', pg_catalog.to_jsonb(r.match_reasons),
          'matched_row_number', r.matched_row_number,
          'matched_client', case when c.id is null then null
            else pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active,
              'email', c.email, 'phone', c.phone, 'tax_id', c.tax_id) end,
          'result', r.result,
          'result_reason', r.result_reason
        ) order by r.row_number)
      from imports_private.client_import_rows r
      left join public.clients c on c.id = r.matched_client_id and c.tenant_id = v_batch.tenant_id
      where r.batch_id = v_batch.id and r.row_number = any (v_numbers)
    ), '[]'::jsonb)
  );
end;
$function$;

-- Same as 20261016124000 except for excluded rows.
create or replace function public.client_import_commit_chunk(
  p_batch_id uuid,
  p_expected_version integer,
  p_limit integer default 200
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  set plan_cache_mode to force_custom_plan
  set gin_pending_list_limit to '64MB'
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_row imports_private.client_import_rows%rowtype;
  v_n jsonb;
  v_result jsonb;
  v_client_id uuid;
  v_client public.clients%rowtype;
  v_prev jsonb;
  v_state text;
  v_message text;
  v_detail text;
  v_processed integer := 0;
  v_created integer := 0;
  v_filled integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_remaining integer;
begin
  if v_batch.status not in ('validated', 'committing') then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  if p_expected_version is distinct from v_batch.row_version then
    raise exception 'row_version_conflict' using errcode = 'GC409', detail = v_batch.row_version::text;
  end if;
  -- Every row must be staged and classified; otherwise the loop below would mark
  -- the missing decisions as skipped (a batch validated before 20261016124000
  -- could be in that state).
  if v_batch.expected_rows is null
     or v_batch.total_rows <> v_batch.expected_rows
     or exists (
       select 1 from imports_private.client_import_rows r
       where r.batch_id = v_batch.id and r.classification is null
     ) then
    raise exception 'batch_incomplete' using errcode = 'GC422', detail = v_batch.status;
  end if;

  if v_batch.status = 'validated' then
    update imports_private.client_import_batches b
    set status = 'committing', updated_at = pg_catalog.now()
    where b.id = v_batch.id;
  end if;

  for v_row in
    select * from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and r.result is null
    order by r.row_number
    limit v_limit
  loop
    v_processed := v_processed + 1;
    v_n := v_row.normalized;

    -- Rows excluded by the user are skipped whatever their decision.
    if v_row.excluded_at is not null
       or (v_row.decision is distinct from 'create' and v_row.decision is distinct from 'fill_blanks') then
      update imports_private.client_import_rows r
      set result = 'skipped',
          result_reason = case when v_row.excluded_at is not null then 'excluded_by_user'
                               else coalesce(v_row.classification, 'skip') end,
          processed_at = pg_catalog.now()
      where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_row.decision = 'create' then
      begin
        v_result := public.create_client_v2(
          (v_n ->> 'customer_type_id')::uuid,
          v_n ->> 'name',
          v_n ->> 'contact_name',
          v_n ->> 'company_name',
          v_n ->> 'tax_id',
          v_n ->> 'email',
          v_n ->> 'phone',
          v_n ->> 'notes',
          v_batch.tenant_id,
          v_n ->> 'address'
        );
        v_client_id := (v_result -> 'client' ->> 'id')::uuid;
        perform pg_catalog.set_config('app.client_import_origin', 'on', true);
        update public.clients c
        set source_system = case when v_row.source_record_id is null then null else v_batch.source_system end,
            source_record_id = v_row.source_record_id,
            import_batch_id = v_batch.id
        where c.id = v_client_id and c.tenant_id = v_batch.tenant_id;
        perform pg_catalog.set_config('app.client_import_origin', 'off', true);

        update imports_private.client_import_rows r
        set result = 'created', client_id = v_client_id, result_reason = null, processed_at = pg_catalog.now()
        where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
        v_created := v_created + 1;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
        if v_state = '23505' then
          update imports_private.client_import_rows r
          set result = 'skipped',
              result_reason = 'client_duplicate',
              matched_client_id = coalesce(imports_private.client_id_from_detail(v_detail), r.matched_client_id),
              processed_at = pg_catalog.now()
          where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
          v_skipped := v_skipped + 1;
        else
          update imports_private.client_import_rows r
          set result = 'failed',
              result_reason = pg_catalog.left(v_state || ': ' || coalesce(v_message, ''), 300),
              processed_at = pg_catalog.now()
          where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
          v_failed := v_failed + 1;
        end if;
      end;
      continue;
    end if;

    -- fill_blanks: only empty fields of the matched client; never overwrite.
    begin
      select * into v_client
      from public.clients c
      where c.id = v_row.matched_client_id and c.tenant_id = v_batch.tenant_id
      for update;
      if not found then
        raise exception 'matched client not found' using errcode = 'P0002';
      end if;

      v_prev := '{}'::jsonb;
      if nullif(pg_catalog.btrim(v_client.contact_name), '') is null and v_n ->> 'contact_name' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('contact_name', pg_catalog.jsonb_build_object('previous', v_client.contact_name, 'imported', v_n ->> 'contact_name'));
      end if;
      if nullif(pg_catalog.btrim(v_client.company_name), '') is null and v_n ->> 'company_name' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('company_name', pg_catalog.jsonb_build_object('previous', v_client.company_name, 'imported', v_n ->> 'company_name'));
      end if;
      if nullif(pg_catalog.btrim(v_client.tax_id), '') is null and v_n ->> 'tax_id' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('tax_id', pg_catalog.jsonb_build_object('previous', v_client.tax_id, 'imported', v_n ->> 'tax_id'));
      end if;
      if nullif(pg_catalog.btrim(v_client.email), '') is null and v_n ->> 'email' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('email', pg_catalog.jsonb_build_object('previous', v_client.email, 'imported', v_n ->> 'email'));
      end if;
      if nullif(pg_catalog.btrim(v_client.phone), '') is null and v_n ->> 'phone' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('phone', pg_catalog.jsonb_build_object('previous', v_client.phone, 'imported', v_n ->> 'phone'));
      end if;
      if nullif(pg_catalog.btrim(v_client.address), '') is null and v_n ->> 'address' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('address', pg_catalog.jsonb_build_object('previous', v_client.address, 'imported', v_n ->> 'address'));
      end if;
      if nullif(pg_catalog.btrim(v_client.notes), '') is null and v_n ->> 'notes' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('notes', pg_catalog.jsonb_build_object('previous', v_client.notes, 'imported', v_n ->> 'notes'));
      end if;
      if v_client.customer_type_id is null and v_n ->> 'customer_type_id' is not null then
        v_prev := v_prev || pg_catalog.jsonb_build_object('customer_type_id', pg_catalog.jsonb_build_object('previous', null, 'imported', v_n ->> 'customer_type_id'));
      end if;

      if v_prev = '{}'::jsonb then
        update imports_private.client_import_rows r
        set result = 'skipped', result_reason = 'nothing_to_fill', client_id = v_client.id, processed_at = pg_catalog.now()
        where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
        v_skipped := v_skipped + 1;
      else
        update public.clients c
        set contact_name = case when v_prev ? 'contact_name' then v_n ->> 'contact_name' else c.contact_name end,
            company_name = case when v_prev ? 'company_name' then v_n ->> 'company_name' else c.company_name end,
            tax_id = case when v_prev ? 'tax_id' then v_n ->> 'tax_id' else c.tax_id end,
            email = case when v_prev ? 'email' then v_n ->> 'email' else c.email end,
            phone = case when v_prev ? 'phone' then v_n ->> 'phone' else c.phone end,
            address = case when v_prev ? 'address' then v_n ->> 'address' else c.address end,
            notes = case when v_prev ? 'notes' then v_n ->> 'notes' else c.notes end,
            customer_type_id = case when v_prev ? 'customer_type_id' then (v_n ->> 'customer_type_id')::uuid else c.customer_type_id end
        where c.id = v_client.id and c.tenant_id = v_batch.tenant_id;

        update imports_private.client_import_rows r
        set result = 'filled', client_id = v_client.id, previous_values = v_prev, result_reason = null, processed_at = pg_catalog.now()
        where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
        v_filled := v_filled + 1;
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      update imports_private.client_import_rows r
      set result = case when v_state = '23505' then 'skipped' else 'failed' end,
          result_reason = case when v_state = '23505' then 'client_duplicate'
                               else pg_catalog.left(v_state || ': ' || coalesce(v_message, ''), 300) end,
          processed_at = pg_catalog.now()
      where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
      if v_state = '23505' then v_skipped := v_skipped + 1; else v_failed := v_failed + 1; end if;
    end;
  end loop;

  select pg_catalog.count(*)::integer into v_remaining
  from imports_private.client_import_rows r
  where r.batch_id = v_batch.id and r.result is null;

  update imports_private.client_import_batches b
  set row_version = b.row_version + 1,
      status = case when v_remaining = 0 then 'committed' else 'committing' end,
      committed_at = case when v_remaining = 0 then pg_catalog.now() else b.committed_at end,
      updated_at = pg_catalog.now()
  where b.id = v_batch.id;
  perform imports_private.refresh_batch_counters(v_batch.id);
  select * into v_batch from imports_private.client_import_batches b where b.id = v_batch.id;

  if v_remaining = 0 then
    perform imports_private.log_batch_activity(v_batch, 'client_import.committed');
  end if;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object(
    'processed', v_processed,
    'chunk', pg_catalog.jsonb_build_object('created', v_created, 'filled', v_filled, 'skipped', v_skipped, 'failed', v_failed),
    'remaining', v_remaining
  );
end;
$function$;


revoke all on function imports_private.batch_plan(uuid) from public;
revoke all on function public.client_import_rows_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.client_import_rows_page(uuid, text, integer, integer) to authenticated;

commit;
