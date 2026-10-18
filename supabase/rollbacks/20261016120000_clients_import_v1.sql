-- Rollback for 20261016120000_clients_import_v1.sql, 20261016121000_clients_import_v1_chunks.sql,
-- 20261016122000_clients_import_v1_finalize_plan.sql, 20261016123000_clients_import_v1_summary.sql,
-- 20261016124000_clients_import_v1_integrity.sql and 20261016125500_clients_import_v1_review.sql
-- (Migration V1, #110).
--
-- The five first migrations are applied in Production. Running this script there
-- needs its own diagnosis and authorization.
--
-- Use only if the client import itself must be withdrawn. Rolling back the
-- APPLICATION alone does not need this script: the previous app never calls the
-- client_import_* RPCs and ignores the nullable clients source columns.
--
-- What it does:
--   * refuses to run if any client came from an import or any batch reached
--     committing/committed (that origin data would be lost): recover forward;
--   * drops the client_import_* RPCs, the imports_private schema (batches,
--     rows, helpers), the clients source columns, constraints and indexes,
--     and the clients_import feature (and its overrides).
-- create_client / create_client_v2 and every other object are untouched by the
-- migration, so nothing else needs restoring.
-- Verified on a database with main + this migration: afterwards the schema
-- fingerprint (columns, constraints, indexes, policies, triggers, functions)
-- equals that of main.
-- Then: supabase migration repair --status reverted 20261016125500 20261016124000 20261016123000 20261016122000 20261016121000 20261016120000
begin;

do $guard$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'import_batch_id'
  ) and exists (
    select 1 from public.clients
    where import_batch_id is not null or source_record_id is not null or source_system is not null
  ) then
    raise exception 'rollback_clients_import_refused: imported clients exist; recover forward';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'imports_private')
     and exists (
       select 1 from imports_private.client_import_batches
       where status in ('committing', 'committed', 'reverted')
     ) then
    raise exception 'rollback_clients_import_refused: committed import batches exist; recover forward';
  end if;
end;
$guard$;

drop function if exists public.client_import_create_batch(uuid, text, text, bigint, text, jsonb, text);
drop function if exists public.client_import_create_batch_v2(uuid, text, text, bigint, text, jsonb, integer, text);
drop function if exists public.client_import_stage_rows(uuid, jsonb);
drop function if exists public.client_import_finalize(uuid);
drop function if exists public.client_import_finalize(uuid, integer, integer);
drop function if exists public.client_import_summary(uuid, integer);
drop function if exists public.client_import_rows_page(uuid, text, integer, integer);
drop function if exists public.client_import_set_strategy(uuid, text, boolean);
drop function if exists public.client_import_set_row_decisions(uuid, integer[], text);
drop function if exists public.client_import_commit_chunk(uuid, integer, integer);
drop function if exists public.client_import_cancel(uuid);
drop function if exists public.client_import_revert(uuid);
drop function if exists public.client_import_revert(uuid, integer);
drop function if exists public.client_import_report(uuid, integer, integer);
drop function if exists public.client_import_list_batches(uuid, integer);
drop function if exists public.client_import_purge_expired(integer);

drop trigger if exists clients_import_origin_guard on public.clients;
alter table public.clients drop constraint if exists clients_import_batch_fk;
drop schema if exists imports_private cascade;

drop index if exists public.clients_tenant_source_record_unique;
drop index if exists public.clients_import_batch_idx;
alter table public.clients drop constraint if exists clients_source_system_length;
alter table public.clients drop constraint if exists clients_source_record_id_length;
alter table public.clients drop column if exists import_batch_id;
alter table public.clients drop column if exists source_record_id;
alter table public.clients drop column if exists source_system;

delete from public.tenant_feature_overrides o
using public.features f
where o.feature_id = f.id and f.code = 'clients_import';
delete from public.features where code = 'clients_import';

commit;
