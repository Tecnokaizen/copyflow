-- Gestcopy Migration V1 · client import: batch integrity (#110). Follows
-- 20261016123000. The four earlier migrations are applied in Production (16/10,
-- no batch yet) and are not modified; this one is additive.
--
-- Independent audit, three P1 findings reproduced on the Production schema:
--   1. client_import_finalize validated a batch as soon as a range reached the
--      last row, even if earlier ranges were never classified; the commit then
--      skipped those rows silently.
--   2. After the 30-day purge removed the rows of a half-committed batch, the
--      next commit marked it committed and recomputed its counters from zero rows.
--   3. The server did not know how many rows the file had, so a batch resumed
--      from the history could be validated and committed with part of its rows.
--
-- Fixes:
--   * batches record expected_rows (declared at creation) and
--     classification_started_at;
--   * a trigger accepts staged rows numbered 1..expected_rows only, and only
--     before classification starts;
--   * client_import_create_batch_v2 requires the row count; v1 is no longer
--     executable by authenticated;
--   * finalize refuses incomplete staging (GC422 batch_incomplete), validates
--     only when no row is left unclassified, returns the first unclassified row
--     as next_row, and restarting a validated batch reclassifies every row;
--   * commit refuses unclassified rows or incomplete staging (GC422);
--   * lock_batch refuses any change to a batch whose rows were purged, and the
--     counters of a purged batch are never recomputed.

begin;

alter table imports_private.client_import_batches
  add column expected_rows integer
    check (expected_rows is null or expected_rows between 1 and 10000),
  add column classification_started_at timestamptz;

-- Batches classified before this migration (Staging only; Production has none).
update imports_private.client_import_batches b
set classification_started_at = b.updated_at
where exists (
  select 1 from imports_private.client_import_rows r
  where r.batch_id = b.id and r.classification is not null
);

create index client_import_rows_unclassified_idx
  on imports_private.client_import_rows (batch_id, row_number)
  where classification is null;

-- Staging guard: rows 1..expected_rows, and nothing once classification started
-- (otherwise rows classified earlier could depend on rows replaced later).
create function imports_private.guard_staged_row()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
declare
  v_expected integer;
  v_started timestamptz;
begin
  select b.expected_rows, b.classification_started_at into v_expected, v_started
  from imports_private.client_import_batches b
  where b.id = new.batch_id;
  if v_expected is null then
    raise exception 'batch_expected_rows_unknown' using errcode = '55000';
  end if;
  if v_started is not null then
    raise exception 'batch_classification_started' using errcode = '55000';
  end if;
  if new.row_number > v_expected then
    raise exception 'row_number above expected rows' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger client_import_rows_staging_guard
  before insert on imports_private.client_import_rows
  for each row execute function imports_private.guard_staged_row();

create or replace function imports_private.lock_batch(p_batch_id uuid)
  returns imports_private.client_import_batches
  language plpgsql
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_batch imports_private.client_import_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select b.tenant_id into v_tenant
  from imports_private.client_import_batches b
  where b.id = p_batch_id;
  if v_tenant is null
     or not public.has_active_tenant_role(v_tenant, array['owner', 'admin', 'manager']::text[]) then
    raise exception 'import batch not found' using errcode = 'P0002';
  end if;
  perform imports_private.assert_import_access(v_tenant);
  select * into v_batch
  from imports_private.client_import_batches b
  where b.id = p_batch_id
  for update;
  -- Once its rows are purged a batch is history: nothing may change it again.
  if v_batch.rows_purged_at is not null then
    raise exception 'batch_rows_purged' using errcode = '55000', detail = v_batch.status;
  end if;
  return v_batch;
end;
$function$;

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

create function public.client_import_create_batch_v2(
  p_tenant_id uuid,
  p_source_system text,
  p_file_name text,
  p_file_size bigint,
  p_file_sha256 text,
  p_mapping jsonb,
  p_expected_rows integer,
  p_duplicate_strategy text default 'skip'
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_user uuid := imports_private.assert_import_access(p_tenant_id);
  v_source text := nullif(pg_catalog.btrim(p_source_system), '');
  v_file text := nullif(pg_catalog.btrim(p_file_name), '');
  v_sha text := pg_catalog.lower(pg_catalog.btrim(p_file_sha256));
  v_mapping_hash text;
  v_batch imports_private.client_import_batches%rowtype;
begin
  if v_source is null or pg_catalog.char_length(v_source) > 60
     or v_file is null or pg_catalog.char_length(v_file) > 255
     or p_file_size is null or p_file_size <= 0 or p_file_size > 5242880
     or v_sha is null or v_sha !~ '^[0-9a-f]{64}$'
     or p_mapping is null or pg_catalog.jsonb_typeof(p_mapping) <> 'object'
     or pg_catalog.octet_length(p_mapping::text) > 16384
     or p_expected_rows is null or p_expected_rows not between 1 and 10000
     or coalesce(p_duplicate_strategy, '') not in ('skip', 'fill_blanks') then
    raise exception 'invalid import batch' using errcode = '22023';
  end if;
  if p_duplicate_strategy = 'fill_blanks' then
    -- Filling blanks needs an explicit confirmation after the review step.
    raise exception 'fill_blanks requires confirmation' using errcode = '22023';
  end if;

  v_mapping_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_mapping::text, 'UTF8')), 'hex');

  select * into v_batch
  from imports_private.client_import_batches b
  where b.tenant_id = p_tenant_id
    and b.file_sha256 = v_sha
    and b.mapping_hash = v_mapping_hash
    and b.status in ('uploaded', 'validated', 'committing', 'committed')
  for update;
  if found then
    -- Same file and mapping: same number of rows. A batch created before
    -- 20261016124000 adopts it while nothing has been classified.
    if v_batch.expected_rows is null and v_batch.status = 'uploaded'
       and v_batch.classification_started_at is null
       and not exists (
         select 1 from imports_private.client_import_rows r
         where r.batch_id = v_batch.id and r.row_number > p_expected_rows
       ) then
      update imports_private.client_import_batches b
      set expected_rows = p_expected_rows, updated_at = pg_catalog.now()
      where b.id = v_batch.id
      returning * into v_batch;
    elsif v_batch.expected_rows is distinct from p_expected_rows then
      raise exception 'expected rows mismatch' using errcode = '22023',
        detail = pg_catalog.format('%s/%s', v_batch.expected_rows, p_expected_rows);
    end if;
    return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('reused', true);
  end if;

  if (
    select pg_catalog.count(*) from imports_private.client_import_batches b
    where b.tenant_id = p_tenant_id and b.status in ('uploaded', 'validated', 'committing')
  ) >= 10 then
    raise exception 'too many open import batches' using errcode = '54000';
  end if;

  begin
    insert into imports_private.client_import_batches (
      tenant_id, created_by, source_system, file_name, file_size, file_sha256, mapping, mapping_hash, expected_rows
    )
    values (p_tenant_id, v_user, v_source, v_file, p_file_size, v_sha, p_mapping, v_mapping_hash, p_expected_rows)
    returning * into v_batch;
  exception when unique_violation then
    select * into v_batch
    from imports_private.client_import_batches b
    where b.tenant_id = p_tenant_id
      and b.file_sha256 = v_sha
      and b.mapping_hash = v_mapping_hash
      and b.status in ('uploaded', 'validated', 'committing', 'committed');
    if v_batch.expected_rows is distinct from p_expected_rows then
      raise exception 'expected rows mismatch' using errcode = '22023',
        detail = pg_catalog.format('%s/%s', v_batch.expected_rows, p_expected_rows);
    end if;
    return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('reused', true);
  end;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('reused', false);
end;
$function$;

create or replace function public.client_import_finalize(
  p_batch_id uuid,
  p_from_row integer default 1,
  p_limit integer default 2000
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  -- Row estimates for a batch (and for clients) that were just written are
  -- stale; a nested loop chosen on them is quadratic. Hash/merge joins are not.
  set enable_nestloop to off
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
  v_from integer := greatest(coalesce(p_from_row, 1), 1);
  v_to integer;
  v_last integer;
  v_row record;
  v_class text;
  v_count integer;
  v_next integer;
  v_done boolean;
begin
  if v_batch.status not in ('uploaded', 'validated') then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  -- Every row the file declared must be staged before anything is classified.
  if v_batch.expected_rows is null then
    raise exception 'batch_incomplete' using errcode = 'GC422', detail = 'expected rows unknown';
  end if;
  select pg_catalog.count(*)::integer, pg_catalog.max(r.row_number) into v_count, v_last
  from imports_private.client_import_rows r
  where r.batch_id = v_batch.id;
  if v_count <> v_batch.expected_rows or v_last is distinct from v_batch.expected_rows then
    raise exception 'batch_incomplete' using errcode = 'GC422',
      detail = pg_catalog.format('%s/%s', v_count, v_batch.expected_rows);
  end if;
  v_to := v_from + least(greatest(coalesce(p_limit, 2000), 1), 5000) - 1;

  -- Reclassifying an already validated batch starts over: every row again.
  if v_batch.status = 'validated' then
    if v_from <> 1 then
      raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
    end if;
    update imports_private.client_import_rows r
    set classification = null,
        matched_client_id = null,
        matched_row_number = null,
        match_reasons = '{}'::text[],
        decision = null
    where r.batch_id = v_batch.id;
    update imports_private.client_import_batches b set status = 'uploaded' where b.id = v_batch.id;
  end if;
  -- From now on no row can be staged or replaced (guard_staged_row).
  update imports_private.client_import_batches b
  set classification_started_at = coalesce(b.classification_started_at, pg_catalog.now())
  where b.id = v_batch.id;

  for v_row in
    with f as materialized (
      -- Duplicates inside the file: the earliest valid row sharing each key. Only
      -- rows up to the end of the range matter.
      select w.row_number, w.has_errors, w.email_n, w.phone_n, w.tax_n, w.source_record_id, w.phone_core,
             least(w.by_email, w.by_phone, w.by_tax, w.by_source) as first_row,
             pg_catalog.array_remove(array[
               case when w.by_email is not null then 'email' end,
               case when w.by_phone is not null then 'phone' end,
               case when w.by_source is not null then 'source_record' end,
               case when w.by_tax is not null then 'tax_id' end
             ], null) as file_reasons
      from (
        select k.row_number, k.has_errors, k.email_n, k.phone_n, k.tax_n, k.source_record_id, k.phone_core,
               case when k.first_email < k.row_number then k.first_email end as by_email,
               case when k.first_phone < k.row_number then k.first_phone end as by_phone,
               case when k.first_tax < k.row_number then k.first_tax end as by_tax,
               case when k.first_source < k.row_number then k.first_source end as by_source
        from (
          select r.row_number, r.email_n, r.phone_n, r.tax_n, r.source_record_id, r.phone_core,
                 pg_catalog.jsonb_array_length(r.errors) > 0 as has_errors,
                 case when r.email_n is not null then pg_catalog.min(r.row_number)
                   filter (where pg_catalog.jsonb_array_length(r.errors) = 0) over (partition by r.email_n) end as first_email,
                 case when r.phone_n is not null then pg_catalog.min(r.row_number)
                   filter (where pg_catalog.jsonb_array_length(r.errors) = 0) over (partition by r.phone_n) end as first_phone,
                 case when r.tax_n is not null then pg_catalog.min(r.row_number)
                   filter (where pg_catalog.jsonb_array_length(r.errors) = 0) over (partition by r.tax_n) end as first_tax,
                 case when r.source_record_id is not null then pg_catalog.min(r.row_number)
                   filter (where pg_catalog.jsonb_array_length(r.errors) = 0) over (partition by r.source_record_id) end as first_source
          from imports_private.client_import_rows r
          where r.batch_id = v_batch.id and r.row_number <= v_to
        ) k
      ) w
      where w.row_number >= v_from
    ),
    -- The tenant's clients with the same normalized keys as create_client.
    client_keys as materialized (
      select c.id, c.created_at,
             public.normalize_client_email(c.email) as email_n,
             public.normalize_client_phone(c.phone) as phone_n,
             public.normalize_client_tax_id(c.tax_id) as tax_n,
             case when c.source_system = v_batch.source_system then c.source_record_id end as source_record_id,
             imports_private.phone_core(public.normalize_client_phone(c.phone)) as phone_core
      from public.clients c
      where c.tenant_id = v_batch.tenant_id
    ),
    -- 1. Existing clients (same rules as create_client, plus origin id).
    matches as (
      select f.row_number, k.id as client_id, k.created_at, 'email'::text as reason
      from f join client_keys k on k.email_n = f.email_n
      where not f.has_errors
      union all
      select f.row_number, k.id, k.created_at, 'phone'
      from f join client_keys k on k.phone_n = f.phone_n
      where not f.has_errors
      union all
      select f.row_number, k.id, k.created_at, 'tax_id'
      from f join client_keys k on k.tax_n = f.tax_n
      where not f.has_errors
      union all
      select f.row_number, k.id, k.created_at, 'source_record'
      from f join client_keys k on k.source_record_id = f.source_record_id
      where not f.has_errors
    ),
    -- The oldest matching client and every key it matches.
    existing as (
      select x.row_number, x.best_id as client_id,
             pg_catalog.array_agg(x.reason order by x.reason) filter (where x.client_id = x.best_id) as reasons
      from (
        select m.row_number, m.client_id, m.reason,
               pg_catalog.first_value(m.client_id) over (partition by m.row_number order by m.created_at, m.client_id) as best_id
        from matches m
      ) x
      group by x.row_number, x.best_id
    ),
    -- 3. Possible duplicates: the phone only matches without the 34/0034 prefix.
    possible as (
      select distinct on (f.row_number) f.row_number, k.id as client_id
      from f join client_keys k on k.phone_core = f.phone_core
      where not f.has_errors and f.first_row is null
      order by f.row_number, k.created_at, k.id
    )
    select f.row_number, f.has_errors, f.first_row, f.file_reasons,
           e.client_id as existing_id, e.reasons as existing_reasons,
           p.client_id as possible_id
    from f
    left join existing e on e.row_number = f.row_number
    left join possible p on p.row_number = f.row_number
  loop
    v_class := case
      when v_row.has_errors then 'error'
      when v_row.existing_id is not null then 'duplicate_existing'
      when v_row.first_row is not null then 'duplicate_in_file'
      when v_row.possible_id is not null then 'possible_duplicate'
      else 'valid'
    end;
    update imports_private.client_import_rows r
    set classification = v_class,
        matched_client_id = case v_class
          when 'duplicate_existing' then v_row.existing_id
          when 'possible_duplicate' then v_row.possible_id
        end,
        matched_row_number = case when v_class = 'duplicate_in_file' then v_row.first_row end,
        match_reasons = case v_class
          when 'duplicate_existing' then v_row.existing_reasons
          when 'duplicate_in_file' then v_row.file_reasons
          when 'possible_duplicate' then array['phone_prefix']
          else '{}'::text[]
        end,
        -- Default decisions: never overwrite, skip anything doubtful.
        decision = case
          when v_class = 'valid' then 'create'
          when v_class = 'duplicate_existing' and v_batch.duplicate_strategy = 'fill_blanks' then 'fill_blanks'
          else 'skip'
        end
    where r.batch_id = v_batch.id and r.row_number = v_row.row_number;
  end loop;

  -- Validated only when no row is left unclassified, whatever the order of the
  -- ranges; next_row is the first row still unclassified.
  select pg_catalog.min(r.row_number) into v_next
  from imports_private.client_import_rows r
  where r.batch_id = v_batch.id and r.classification is null;
  v_done := v_next is null;

  update imports_private.client_import_batches b
  set status = case when v_done then 'validated' else 'uploaded' end,
      row_version = b.row_version + 1,
      updated_at = pg_catalog.now()
  where b.id = v_batch.id;
  if v_done then
    perform imports_private.refresh_batch_counters(v_batch.id);
  end if;

  select * into v_batch from imports_private.client_import_batches b where b.id = p_batch_id;
  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object(
    'done', v_done,
    'next_row', v_next
  );
end;
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

revoke all on function imports_private.guard_staged_row() from public;
revoke all on function public.client_import_create_batch_v2(uuid, text, text, bigint, text, jsonb, integer, text) from public, anon;
grant execute on function public.client_import_create_batch_v2(uuid, text, text, bigint, text, jsonb, integer, text) to authenticated;
-- v1 cannot declare the row count: nobody may create batches with it any more.
revoke execute on function public.client_import_create_batch(uuid, text, text, bigint, text, jsonb, text) from authenticated;

commit;
