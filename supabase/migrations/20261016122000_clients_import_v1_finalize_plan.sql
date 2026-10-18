-- Gestcopy Migration V1 · client import: classification that does not depend on
-- planner estimates (#110). Follows 20261016121000 (both applied in Staging only).
--
-- Staging QA: classifying a freshly staged 1 000-row batch hit the 8 s
-- statement_timeout. The rows table only had statistics from older batches, so
-- the planner estimated 1 row for the new batch and drove each UPDATE ... FROM
-- with the target table: the per-row duplicate subqueries were re-evaluated for
-- every row (quadratic). Autoanalyze always lags behind a fresh import, so this
-- is the normal case, not an edge case.
--
-- client_import_finalize now reads each range once, with plans that stay linear
-- whatever the estimates (fresh clients are just as stale as fresh rows):
--   * duplicates inside the file: window functions over the batch rows up to the
--     end of the range (one scan and four sorts, no join);
--   * existing clients and possible duplicates: the tenant's normalized client
--     keys are computed once per call and joined by equality; nested loops are
--     disabled for this function only, so those joins are hash or merge joins;
--   * one UPDATE per row by primary key (it used to be up to five).
-- Same signature, same rules and results (phase50 compares ranges with a single
-- pass and checks a freshly staged batch under stale statistics).
--
-- Commit and revert (measured with 10 000 rows into a tenant whose clients were
-- just written):
--   * create_client checks duplicates with one OR over the three normalized keys.
--     PL/pgSQL caches that plan per session, and with stale statistics the cached
--     generic plan scans every client of the tenant for each new client (the
--     first chunks took ~3 s each). Custom plans use the three unique indexes, so
--     the commit forces them for everything it calls. create_client is unchanged.
--   * clients has seven trigram GIN indexes with fastupdate. The insert that
--     pushes a pending list past the default 4 MB flushes it synchronously (one
--     chunk took 5.7 s). Commit and revert raise the limit for their own writes
--     and leave the flush to autovacuum.
-- After both: every commit chunk of 200 between 0.2 and 0.5 s locally.

begin;

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

alter function public.client_import_commit_chunk(uuid, integer, integer)
  set plan_cache_mode to force_custom_plan;
alter function public.client_import_commit_chunk(uuid, integer, integer)
  set gin_pending_list_limit to '64MB';
alter function public.client_import_revert(uuid, integer)
  set gin_pending_list_limit to '64MB';

commit;
