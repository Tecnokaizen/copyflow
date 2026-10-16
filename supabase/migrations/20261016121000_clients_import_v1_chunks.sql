-- Gestcopy Migration V1 · client import, scaling fixes found in Staging QA (#110).
-- Follows 20261016120000_clients_import_v1 (applied in Staging only).
--
--   * row_version_conflict now uses SQLSTATE GC409 instead of 40001: PostgREST
--     retries 40001 (serialization failure), so a stale commit kept retrying
--     until the gateway timeout (504 after 125 s) instead of answering 409.
--   * client_import_finalize classifies in row ranges (p_from_row, p_limit), so
--     10 000 rows fit Supabase's 8 s statement_timeout on small compute; the
--     result is identical to a single pass.
--   * client_import_revert works in chunks (p_limit) and finishes the batch when
--     no reverted row is left.
-- Same tables, same checks, same grants model.
--
-- The two DROPs replace client_import_finalize(uuid) and client_import_revert(uuid)
-- with their chunked signatures. Both one-shot versions were created by
-- 20261016120000 in this same PR, have never been applied in Production and are
-- not called by any deployed app version, so expand-contract does not apply.
-- release-gate: allow destructive-ddl: drops only the one-shot finalize/revert created by 20261016120000 in the same PR, never applied in Production nor called by deployed code

begin;

create or replace function public.client_import_commit_chunk(
  p_batch_id uuid,
  p_expected_version integer,
  p_limit integer default 200
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
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

-- ---------------------------------------------------------------------------
-- Finalize by row ranges
-- ---------------------------------------------------------------------------

drop function public.client_import_finalize(uuid);

create function public.client_import_finalize(
  p_batch_id uuid,
  p_from_row integer default 1,
  p_limit integer default 2000
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
  v_from integer := greatest(coalesce(p_from_row, 1), 1);
  v_to integer;
  v_last integer;
begin
  if v_batch.status not in ('uploaded', 'validated') then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  select pg_catalog.max(r.row_number) into v_last
  from imports_private.client_import_rows r
  where r.batch_id = v_batch.id;
  if v_last is null then
    raise exception 'batch has no rows' using errcode = '22023';
  end if;
  v_to := v_from + least(greatest(coalesce(p_limit, 2000), 1), 5000) - 1;

  -- Reclassifying an already validated batch starts over from the first range.
  if v_batch.status = 'validated' then
    if v_from <> 1 then
      raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
    end if;
    update imports_private.client_import_batches b set status = 'uploaded' where b.id = v_batch.id;
  end if;

  update imports_private.client_import_rows r
  set classification = case when pg_catalog.jsonb_array_length(r.errors) > 0 then 'error' else null end,
      matched_client_id = null,
      matched_row_number = null,
      match_reasons = '{}'::text[],
      decision = null
  where r.batch_id = v_batch.id and r.row_number between v_from and v_to;

  -- 1. Existing clients (same rules as create_client, plus origin id).
  with chunk as materialized (
    select r.row_number, r.email_n, r.phone_n, r.tax_n, r.source_record_id
    from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and r.row_number between v_from and v_to and r.classification is null
  ),
  candidates as (
    select k.row_number, c.id as client_id, c.created_at, 'email'::text as reason
    from chunk k
    join public.clients c on c.tenant_id = v_batch.tenant_id and public.normalize_client_email(c.email) = k.email_n
    where k.email_n is not null
    union all
    select k.row_number, c.id, c.created_at, 'phone'
    from chunk k
    join public.clients c on c.tenant_id = v_batch.tenant_id and public.normalize_client_phone(c.phone) = k.phone_n
    where k.phone_n is not null
    union all
    select k.row_number, c.id, c.created_at, 'tax_id'
    from chunk k
    join public.clients c on c.tenant_id = v_batch.tenant_id and public.normalize_client_tax_id(c.tax_id) = k.tax_n
    where k.tax_n is not null
    union all
    select k.row_number, c.id, c.created_at, 'source_record'
    from chunk k
    join public.clients c
      on c.tenant_id = v_batch.tenant_id
     and c.source_system = v_batch.source_system
     and c.source_record_id = k.source_record_id
    where k.source_record_id is not null
  ),
  first_client as (
    select distinct on (row_number) row_number, client_id
    from candidates
    order by row_number, created_at, client_id
  ),
  best as (
    select f.row_number, f.client_id,
           pg_catalog.array_agg(distinct c.reason order by c.reason) as reasons
    from first_client f
    join candidates c on c.row_number = f.row_number and c.client_id = f.client_id
    group by f.row_number, f.client_id
  )
  update imports_private.client_import_rows r
  set classification = 'duplicate_existing',
      matched_client_id = b.client_id,
      match_reasons = b.reasons
  from best b
  where r.batch_id = v_batch.id and r.row_number = b.row_number;

  -- 2. Duplicates inside the file: the earliest earlier valid row sharing a key
  --    (indexed lookups per row, so the cost grows with the range, not the file).
  with chunk as materialized (
    select r.row_number, r.email_n, r.phone_n, r.tax_n, r.source_record_id
    from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and r.row_number between v_from and v_to and r.classification is null
  ),
  firsts as (
    select k.row_number,
      (select pg_catalog.min(e.row_number) from imports_private.client_import_rows e
        where e.batch_id = v_batch.id and e.email_n = k.email_n and e.row_number < k.row_number
          and pg_catalog.jsonb_array_length(e.errors) = 0) as by_email,
      (select pg_catalog.min(e.row_number) from imports_private.client_import_rows e
        where e.batch_id = v_batch.id and e.phone_n = k.phone_n and e.row_number < k.row_number
          and pg_catalog.jsonb_array_length(e.errors) = 0) as by_phone,
      (select pg_catalog.min(e.row_number) from imports_private.client_import_rows e
        where e.batch_id = v_batch.id and e.tax_n = k.tax_n and e.row_number < k.row_number
          and pg_catalog.jsonb_array_length(e.errors) = 0) as by_tax,
      (select pg_catalog.min(e.row_number) from imports_private.client_import_rows e
        where e.batch_id = v_batch.id and e.source_record_id = k.source_record_id and e.row_number < k.row_number
          and pg_catalog.jsonb_array_length(e.errors) = 0) as by_source
    from chunk k
  ),
  dups as (
    select f.row_number,
           least(f.by_email, f.by_phone, f.by_tax, f.by_source) as first_row,
           pg_catalog.array_remove(array[
             case when f.by_email is not null then 'email' end,
             case when f.by_phone is not null then 'phone' end,
             case when f.by_source is not null then 'source_record' end,
             case when f.by_tax is not null then 'tax_id' end
           ], null) as reasons
    from firsts f
    where coalesce(f.by_email, f.by_phone, f.by_tax, f.by_source) is not null
  )
  update imports_private.client_import_rows r
  set classification = 'duplicate_in_file',
      matched_row_number = d.first_row,
      match_reasons = d.reasons
  from dups d
  where r.batch_id = v_batch.id and r.row_number = d.row_number;

  -- 3. Possible duplicates: the phone only matches without the 34/0034 prefix.
  with existing as materialized (
    select c.id, c.created_at, imports_private.phone_core(public.normalize_client_phone(c.phone)) as core
    from public.clients c
    where c.tenant_id = v_batch.tenant_id and c.phone is not null
  ),
  matches as (
    select distinct on (r.row_number) r.row_number, e.id
    from imports_private.client_import_rows r
    join existing e on e.core = r.phone_core
    where r.batch_id = v_batch.id and r.row_number between v_from and v_to
      and r.classification is null and r.phone_core is not null
    order by r.row_number, e.created_at, e.id
  )
  update imports_private.client_import_rows r
  set classification = 'possible_duplicate',
      matched_client_id = m.id,
      match_reasons = array['phone_prefix']
  from matches m
  where r.batch_id = v_batch.id and r.row_number = m.row_number;

  update imports_private.client_import_rows r
  set classification = 'valid'
  where r.batch_id = v_batch.id and r.row_number between v_from and v_to and r.classification is null;

  -- Default decisions: never overwrite, skip anything doubtful.
  update imports_private.client_import_rows r
  set decision = case
    when r.classification = 'valid' then 'create'
    when r.classification = 'duplicate_existing' and v_batch.duplicate_strategy = 'fill_blanks' then 'fill_blanks'
    else 'skip'
  end
  where r.batch_id = v_batch.id and r.row_number between v_from and v_to;

  update imports_private.client_import_batches b
  set status = case when v_to >= v_last then 'validated' else 'uploaded' end,
      row_version = b.row_version + 1,
      updated_at = pg_catalog.now()
  where b.id = v_batch.id;
  if v_to >= v_last then
    perform imports_private.refresh_batch_counters(v_batch.id);
  end if;

  select * into v_batch from imports_private.client_import_batches b where b.id = p_batch_id;
  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object(
    'done', v_to >= v_last,
    'next_row', case when v_to >= v_last then null else v_to + 1 end
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Revert in chunks
-- ---------------------------------------------------------------------------

drop function public.client_import_revert(uuid);

create function public.client_import_revert(p_batch_id uuid, p_limit integer default 500)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_row imports_private.client_import_rows%rowtype;
  v_client public.clients%rowtype;
  v_restore jsonb;
  v_field text;
  v_kept jsonb := '[]'::jsonb;
  v_remaining integer;
begin
  if v_batch.status not in ('committing', 'committed') then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  if v_batch.rows_purged_at is not null then
    raise exception 'batch rows expired' using errcode = '55000';
  end if;

  for v_row in
    select * from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and r.result in ('created', 'filled') and r.revert_result is null
    order by r.row_number
    limit v_limit
  loop
    select * into v_client
    from public.clients c
    where c.id = v_row.client_id and c.tenant_id = v_batch.tenant_id
    for update;

    if not found then
      update imports_private.client_import_rows r set revert_result = 'not_applicable'
      where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
      continue;
    end if;

    if v_row.result = 'created' then
      if exists (select 1 from public.orders o where o.tenant_id = v_batch.tenant_id and o.client_id = v_client.id)
         or exists (select 1 from public.quotes q where q.tenant_id = v_batch.tenant_id and q.client_id = v_client.id) then
        update imports_private.client_import_rows r set revert_result = 'kept_in_use'
        where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
        v_kept := v_kept || pg_catalog.jsonb_build_object('client_id', v_client.id, 'reason', 'in_use');
      elsif v_client.updated_at > v_row.processed_at then
        update imports_private.client_import_rows r set revert_result = 'kept_edited'
        where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
        v_kept := v_kept || pg_catalog.jsonb_build_object('client_id', v_client.id, 'reason', 'edited');
      else
        update public.clients c set active = false
        where c.id = v_client.id and c.tenant_id = v_batch.tenant_id;
        update imports_private.client_import_rows r set revert_result = 'deactivated'
        where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
      end if;
      continue;
    end if;

    -- filled: restore only the fields that still hold the imported value.
    v_restore := '{}'::jsonb;
    for v_field in select pg_catalog.jsonb_object_keys(coalesce(v_row.previous_values, '{}'::jsonb)) loop
      if (pg_catalog.to_jsonb(v_client) ->> v_field) is not distinct from (v_row.previous_values -> v_field ->> 'imported') then
        v_restore := v_restore || pg_catalog.jsonb_build_object(v_field, v_row.previous_values -> v_field -> 'previous');
      end if;
    end loop;

    if v_restore = '{}'::jsonb then
      update imports_private.client_import_rows r set revert_result = 'kept_edited'
      where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
      v_kept := v_kept || pg_catalog.jsonb_build_object('client_id', v_client.id, 'reason', 'edited');
    else
      update public.clients c
      set contact_name = case when v_restore ? 'contact_name' then v_restore ->> 'contact_name' else c.contact_name end,
          company_name = case when v_restore ? 'company_name' then v_restore ->> 'company_name' else c.company_name end,
          tax_id = case when v_restore ? 'tax_id' then v_restore ->> 'tax_id' else c.tax_id end,
          email = case when v_restore ? 'email' then v_restore ->> 'email' else c.email end,
          phone = case when v_restore ? 'phone' then v_restore ->> 'phone' else c.phone end,
          address = case when v_restore ? 'address' then v_restore ->> 'address' else c.address end,
          notes = case when v_restore ? 'notes' then v_restore ->> 'notes' else c.notes end,
          customer_type_id = case when v_restore ? 'customer_type_id' then (v_restore ->> 'customer_type_id')::uuid else c.customer_type_id end
      where c.id = v_client.id and c.tenant_id = v_batch.tenant_id;
      update imports_private.client_import_rows r set revert_result = 'restored'
      where r.batch_id = v_row.batch_id and r.row_number = v_row.row_number;
    end if;
  end loop;

  select pg_catalog.count(*)::integer into v_remaining
  from imports_private.client_import_rows r
  where r.batch_id = v_batch.id and r.result in ('created', 'filled') and r.revert_result is null;

  update imports_private.client_import_batches b
  set status = case when v_remaining = 0 then 'reverted' else b.status end,
      reverted_at = case when v_remaining = 0 then pg_catalog.now() else b.reverted_at end,
      row_version = b.row_version + 1,
      updated_at = pg_catalog.now()
  where b.id = v_batch.id;
  perform imports_private.refresh_batch_counters(v_batch.id);
  select * into v_batch from imports_private.client_import_batches b where b.id = v_batch.id;
  if v_remaining = 0 then
    perform imports_private.log_batch_activity(v_batch, 'client_import.reverted');
  end if;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('kept', v_kept, 'remaining', v_remaining);
end;
$function$;

revoke all on function public.client_import_finalize(uuid, integer, integer) from public, anon;
revoke all on function public.client_import_revert(uuid, integer) from public, anon;
grant execute on function public.client_import_finalize(uuid, integer, integer) to authenticated;
grant execute on function public.client_import_revert(uuid, integer) to authenticated;

commit;
