-- Rollback for 20261016125500_clients_import_v1_review.sql ONLY (Migration V1, #110).
--
-- Restores the review functions of 20261016120000/123000/124000 and removes what
-- 20261016125500 added: client_import_rows_page, imports_private.batch_plan,
-- client_import_rows.excluded_at and client_import_batches.excluded_count.
-- The five earlier migrations, their batches and every other object stay as they
-- are, so it can run where batches were already committed (unlike
-- 20261016120000_clients_import_v1.sql, which withdraws the whole import).
--
-- It refuses to run once a user has excluded a row (the exclusions and their
-- counters would be lost): recover forward instead.
-- Needs its own diagnosis and authorization in any remote environment.
-- Verified locally: afterwards the schema fingerprint equals that of the
-- migrations up to 20261016125000.
-- Then: supabase migration repair --status reverted 20261016125500
begin;

do $guard$
begin
  if exists (select 1 from imports_private.client_import_rows where excluded_at is not null)
     or exists (select 1 from imports_private.client_import_batches where excluded_count <> 0) then
    raise exception 'rollback_clients_import_review_refused: rows were excluded in a review; recover forward';
  end if;
end;
$guard$;

drop function if exists public.client_import_rows_page(uuid, text, integer, integer);

-- 20261016120000
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
     or coalesce(p_decision, '') not in ('create', 'skip', 'fill_blanks') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_decision = 'fill_blanks' and v_batch.duplicate_strategy <> 'fill_blanks' then
    raise exception 'fill_blanks requires confirmation' using errcode = '22023';
  end if;
  -- Allowed: possible duplicates -> create|skip; existing duplicates -> skip|fill_blanks.
  if exists (
    select 1 from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and r.row_number = any (p_row_numbers)
      and not (
        (r.classification = 'possible_duplicate' and p_decision in ('create', 'skip'))
        or (r.classification = 'duplicate_existing' and p_decision in ('skip', 'fill_blanks'))
      )
  ) then
    raise exception 'decision not allowed for these rows' using errcode = '22023';
  end if;

  update imports_private.client_import_rows r
  set decision = p_decision
  where r.batch_id = v_batch.id and r.row_number = any (p_row_numbers);
  get diagnostics v_changed = row_count;

  update imports_private.client_import_batches b
  set row_version = b.row_version + 1, updated_at = pg_catalog.now()
  where b.id = v_batch.id
  returning * into v_batch;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('changed', v_changed);
end;
$function$;

-- 20261016123000
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

-- 20261016124000
create or replace function imports_private.refresh_batch_counters(p_batch_id uuid)
  returns void
  language sql
  set search_path to ''
as $function$
  update imports_private.client_import_batches b
  set total_rows = s.total,
      valid_rows = s.valid,
      error_rows = s.error,
      duplicate_in_file_rows = s.dup_file,
      duplicate_existing_rows = s.dup_existing,
      possible_duplicate_rows = s.possible,
      created_count = s.created,
      filled_count = s.filled,
      skipped_count = s.skipped,
      failed_count = s.failed,
      deactivated_count = s.deactivated,
      restored_count = s.restored,
      updated_at = pg_catalog.now()
  from (
    select
      pg_catalog.count(*)::integer as total,
      pg_catalog.count(*) filter (where r.classification = 'valid')::integer as valid,
      pg_catalog.count(*) filter (where r.classification = 'error')::integer as error,
      pg_catalog.count(*) filter (where r.classification = 'duplicate_in_file')::integer as dup_file,
      pg_catalog.count(*) filter (where r.classification = 'duplicate_existing')::integer as dup_existing,
      pg_catalog.count(*) filter (where r.classification = 'possible_duplicate')::integer as possible,
      pg_catalog.count(*) filter (where r.result = 'created')::integer as created,
      pg_catalog.count(*) filter (where r.result = 'filled')::integer as filled,
      pg_catalog.count(*) filter (where r.result = 'skipped')::integer as skipped,
      pg_catalog.count(*) filter (where r.result = 'failed')::integer as failed,
      pg_catalog.count(*) filter (where r.revert_result = 'deactivated')::integer as deactivated,
      pg_catalog.count(*) filter (where r.revert_result = 'restored')::integer as restored
    from imports_private.client_import_rows r
    where r.batch_id = p_batch_id
  ) s
  -- The counters of a purged batch are its only history; never recompute them.
  where b.id = p_batch_id and b.rows_purged_at is null;
$function$;

create or replace function imports_private.batch_json(p_batch imports_private.client_import_batches)
  returns jsonb
  language sql
  stable
  set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_batch.id,
    'tenant_id', p_batch.tenant_id,
    'source_system', p_batch.source_system,
    'file_name', p_batch.file_name,
    'file_size', p_batch.file_size,
    'duplicate_strategy', p_batch.duplicate_strategy,
    'status', p_batch.status,
    'expected_rows', p_batch.expected_rows,
    'row_version', p_batch.row_version,
    'counts', pg_catalog.jsonb_build_object(
      'total', p_batch.total_rows,
      'valid', p_batch.valid_rows,
      'error', p_batch.error_rows,
      'duplicate_in_file', p_batch.duplicate_in_file_rows,
      'duplicate_existing', p_batch.duplicate_existing_rows,
      'possible_duplicate', p_batch.possible_duplicate_rows,
      'created', p_batch.created_count,
      'filled', p_batch.filled_count,
      'skipped', p_batch.skipped_count,
      'failed', p_batch.failed_count,
      'deactivated', p_batch.deactivated_count,
      'restored', p_batch.restored_count
    ),
    'created_at', p_batch.created_at,
    'committed_at', p_batch.committed_at,
    'reverted_at', p_batch.reverted_at,
    'expires_at', p_batch.expires_at,
    'rows_purged', p_batch.rows_purged_at is not null
  );
$function$;

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

    if v_row.decision is distinct from 'create' and v_row.decision is distinct from 'fill_blanks' then
      update imports_private.client_import_rows r
      set result = 'skipped', result_reason = coalesce(v_row.classification, 'skip'), processed_at = pg_catalog.now()
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

drop function if exists imports_private.batch_plan(uuid);
alter table imports_private.client_import_batches drop column if exists excluded_count;
alter table imports_private.client_import_rows drop column if exists excluded_at;

commit;
