-- Gestcopy Migration V1 · Importación de clientes CSV/XLSX (#110).
-- ADR: docs/adr/2026-10-16-clients-import-v1.md (diseño cerrado, D1–D9, S1–S12).
--
-- Additive only:
--   * private schema imports_private (batches + rows), RLS on, no policies,
--     no grants to any API role;
--   * nullable source columns on public.clients + partial unique index;
--   * feature clients_import in the catalog (no plan_features, no overrides);
--   * SECURITY DEFINER RPCs with explicit auth.uid(), tenant, active
--     membership, role (owner/admin/manager) and feature checks.
--
-- Clients are created through public.create_client_v2 (unchanged): it keeps
-- its own auth.uid()/has_tenant_role/duplicate checks and the activity trigger.
-- No existing function, policy or trigger is modified.

begin;

-- ---------------------------------------------------------------------------
-- Schema and tables
-- ---------------------------------------------------------------------------

create schema if not exists imports_private;
revoke all on schema imports_private from public, anon, authenticated, service_role;

create table imports_private.client_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_by uuid not null,
  source_system text not null
    check (pg_catalog.char_length(source_system) between 1 and 60),
  file_name text not null
    check (pg_catalog.char_length(file_name) between 1 and 255),
  file_size bigint not null check (file_size > 0 and file_size <= 5242880),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  mapping jsonb not null check (pg_catalog.jsonb_typeof(mapping) = 'object'),
  mapping_hash text not null check (mapping_hash ~ '^[0-9a-f]{64}$'),
  duplicate_strategy text not null default 'skip'
    check (duplicate_strategy in ('skip', 'fill_blanks')),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'validated', 'committing', 'committed', 'cancelled', 'reverted', 'expired')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  error_rows integer not null default 0,
  duplicate_in_file_rows integer not null default 0,
  duplicate_existing_rows integer not null default 0,
  possible_duplicate_rows integer not null default 0,
  created_count integer not null default 0,
  filled_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  deactivated_count integer not null default 0,
  restored_count integer not null default 0,
  row_version integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  committed_at timestamptz,
  reverted_at timestamptz,
  expires_at timestamptz not null default (pg_catalog.now() + interval '30 days'),
  rows_purged_at timestamptz
);

-- Same file + same mapping = same batch while it is live or committed.
create unique index client_import_batches_file_idx
  on imports_private.client_import_batches (tenant_id, file_sha256, mapping_hash)
  where status in ('uploaded', 'validated', 'committing', 'committed');
create index client_import_batches_tenant_idx
  on imports_private.client_import_batches (tenant_id, created_at desc);
create index client_import_batches_expiry_idx
  on imports_private.client_import_batches (expires_at)
  where rows_purged_at is null;

create table imports_private.client_import_rows (
  batch_id uuid not null references imports_private.client_import_batches (id) on delete cascade,
  row_number integer not null check (row_number between 1 and 10000),
  tenant_id uuid not null,
  source_record_id text
    check (source_record_id is null or pg_catalog.char_length(source_record_id) between 1 and 120),
  normalized jsonb not null check (pg_catalog.jsonb_typeof(normalized) = 'object'),
  email_n text,
  phone_n text,
  phone_core text,
  tax_n text,
  row_hash text not null,
  errors jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(errors) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(warnings) = 'array'),
  classification text
    check (classification in ('valid', 'error', 'duplicate_in_file', 'duplicate_existing', 'possible_duplicate')),
  matched_client_id uuid,
  matched_row_number integer,
  match_reasons text[] not null default '{}'::text[],
  decision text check (decision in ('create', 'fill_blanks', 'skip')),
  result text check (result in ('created', 'filled', 'skipped', 'failed')),
  result_reason text check (result_reason is null or pg_catalog.char_length(result_reason) <= 300),
  client_id uuid,
  previous_values jsonb,
  revert_result text check (revert_result in ('deactivated', 'restored', 'kept_in_use', 'kept_edited', 'not_applicable')),
  staged_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz,
  primary key (batch_id, row_number)
);

create index client_import_rows_pending_idx
  on imports_private.client_import_rows (batch_id, row_number) where result is null;
create index client_import_rows_email_idx on imports_private.client_import_rows (batch_id, email_n) where email_n is not null;
create index client_import_rows_phone_idx on imports_private.client_import_rows (batch_id, phone_n) where phone_n is not null;
create index client_import_rows_tax_idx on imports_private.client_import_rows (batch_id, tax_n) where tax_n is not null;
create index client_import_rows_source_idx on imports_private.client_import_rows (batch_id, source_record_id) where source_record_id is not null;

alter table imports_private.client_import_batches enable row level security;
alter table imports_private.client_import_rows enable row level security;
revoke all on table imports_private.client_import_batches from public, anon, authenticated, service_role;
revoke all on table imports_private.client_import_rows from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.clients: origin of imported clients (nullable, additive)
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists import_batch_id uuid;

alter table public.clients
  add constraint clients_source_system_length
    check (source_system is null or pg_catalog.char_length(source_system) between 1 and 60),
  add constraint clients_source_record_id_length
    check (source_record_id is null or pg_catalog.char_length(source_record_id) between 1 and 120),
  add constraint clients_import_batch_fk
    foreign key (import_batch_id) references imports_private.client_import_batches (id) on delete set null;

create unique index clients_tenant_source_record_unique
  on public.clients (tenant_id, source_system, source_record_id)
  where source_record_id is not null;
create index clients_import_batch_idx
  on public.clients (import_batch_id) where import_batch_id is not null;

comment on column public.clients.source_system is 'Origin system of an imported client (Migration V1). NULL for clients created in Gestcopy.';
comment on column public.clients.source_record_id is 'Identifier of the client in its origin system. Unique per tenant and source_system.';
comment on column public.clients.import_batch_id is 'Client import batch that created this client (imports_private.client_import_batches).';

-- Origin columns are written only by the import RPCs (session marker, same
-- pattern as app.order_lifecycle). Direct API updates by any role are refused;
-- clearing import_batch_id is allowed so ON DELETE SET NULL keeps working.
create function imports_private.guard_client_origin()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
begin
  if pg_catalog.current_setting('app.client_import_origin', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      if new.source_system is not null or new.source_record_id is not null or new.import_batch_id is not null then
        raise exception 'client origin is managed by the client import' using errcode = '42501';
      end if;
    elsif new.source_system is distinct from old.source_system
       or new.source_record_id is distinct from old.source_record_id
       or (new.import_batch_id is not null and new.import_batch_id is distinct from old.import_batch_id) then
      raise exception 'client origin is managed by the client import' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

create trigger clients_import_origin_guard
  before insert or update of source_system, source_record_id, import_batch_id on public.clients
  for each row
  execute function imports_private.guard_client_origin();

-- ---------------------------------------------------------------------------
-- Feature catalog (no plan inheritance, no tenant enrolled)
-- ---------------------------------------------------------------------------

insert into public.features (id, code, name, description)
values (
  '31000000-0000-4000-8000-000000000010',
  'clients_import',
  'Importación de clientes',
  'Importar la cartera de clientes desde CSV o XLSX. Concesión por tenant durante el despliegue controlado; no cambia plan, precio ni cuota.'
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    updated_at = pg_catalog.now();

-- ---------------------------------------------------------------------------
-- Private helpers (no grants: only reachable from the DEFINER RPCs below)
-- ---------------------------------------------------------------------------

-- Caller must be authenticated, an active owner/admin/manager of an active
-- tenant that has the clients_import feature.
create function imports_private.assert_import_access(p_tenant_id uuid)
  returns uuid
  language plpgsql
  stable
  set search_path to ''
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_tenant_id is null then
    raise exception 'tenant is required' using errcode = '22023';
  end if;
  if not public.has_active_tenant_role(p_tenant_id, array['owner', 'admin', 'manager']::text[]) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;
  if not public.tenant_has_feature(p_tenant_id, 'clients_import') then
    raise exception 'clients_import_disabled' using errcode = '42501';
  end if;
  return v_user;
end;
$function$;

-- Locks a batch for the current caller. Unknown batches and batches of other
-- tenants are indistinguishable (no existence oracle).
create function imports_private.lock_batch(p_batch_id uuid)
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
  return v_batch;
end;
$function$;

-- Plain text -> canonical safe rich text (mirrors lib/rich-text legacyToHtml).
create function imports_private.plain_text_to_rich_html(p_text text)
  returns text
  language sql
  immutable
  set search_path to ''
as $function$
  select case
    when p_text is null or pg_catalog.btrim(pg_catalog.replace(p_text, pg_catalog.chr(160), ' ')) = '' then null
    else (
      select pg_catalog.string_agg(
        case
          when pg_catalog.btrim(line) = '' then '<p><br></p>'
          else '<p>' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
                 pg_catalog.btrim(line), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>'
        end, '' order by ord)
      from pg_catalog.regexp_split_to_table(
        pg_catalog.btrim(pg_catalog.replace(pg_catalog.replace(p_text, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)), pg_catalog.chr(160), ' ')),
        pg_catalog.chr(10)) with ordinality as t(line, ord)
    )
  end
$function$;

-- Spanish prefix-insensitive phone key used only for "possible duplicate".
create function imports_private.phone_core(p_digits text)
  returns text
  language sql
  immutable
  set search_path to ''
as $function$
  select case
    when p_digits is null then null
    when pg_catalog.length(p_digits) = 13 and pg_catalog.left(p_digits, 4) = '0034' then pg_catalog.substr(p_digits, 5)
    when pg_catalog.length(p_digits) = 11 and pg_catalog.left(p_digits, 2) = '34' then pg_catalog.substr(p_digits, 3)
    else p_digits
  end
$function$;

-- client_duplicate from create_client carries the matching client as JSON detail.
create function imports_private.client_id_from_detail(p_detail text)
  returns uuid
  language plpgsql
  immutable
  set search_path to ''
as $function$
begin
  return (p_detail::jsonb ->> 'client_id')::uuid;
exception when others then
  return null;
end;
$function$;

create function imports_private.refresh_batch_counters(p_batch_id uuid)
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
  where b.id = p_batch_id;
$function$;

create function imports_private.batch_json(p_batch imports_private.client_import_batches)
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

create function imports_private.log_batch_activity(
  p_batch imports_private.client_import_batches,
  p_action text
)
  returns void
  language sql
  set search_path to ''
as $function$
  insert into public.activity_log (tenant_id, user_id, action, entity_type, entity_id, new_values, metadata)
  values (
    p_batch.tenant_id,
    auth.uid(),
    p_action,
    'client_import',
    p_batch.id,
    pg_catalog.jsonb_build_object(
      'created', p_batch.created_count,
      'filled', p_batch.filled_count,
      'skipped', p_batch.skipped_count,
      'failed', p_batch.failed_count,
      'deactivated', p_batch.deactivated_count,
      'restored', p_batch.restored_count,
      'total', p_batch.total_rows
    ),
    pg_catalog.jsonb_build_object(
      'source_system', p_batch.source_system,
      'file_name', p_batch.file_name
    )
  );
$function$;

-- ---------------------------------------------------------------------------
-- RPC: create batch (idempotent by tenant + file hash + mapping hash)
-- ---------------------------------------------------------------------------

create function public.client_import_create_batch(
  p_tenant_id uuid,
  p_source_system text,
  p_file_name text,
  p_file_size bigint,
  p_file_sha256 text,
  p_mapping jsonb,
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
    and b.status in ('uploaded', 'validated', 'committing', 'committed');
  if found then
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
      tenant_id, created_by, source_system, file_name, file_size, file_sha256, mapping, mapping_hash
    )
    values (p_tenant_id, v_user, v_source, v_file, p_file_size, v_sha, p_mapping, v_mapping_hash)
    returning * into v_batch;
  exception when unique_violation then
    select * into v_batch
    from imports_private.client_import_batches b
    where b.tenant_id = p_tenant_id
      and b.file_sha256 = v_sha
      and b.mapping_hash = v_mapping_hash
      and b.status in ('uploaded', 'validated', 'committing', 'committed');
    return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('reused', true);
  end;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('reused', false);
end;
$function$;

-- ---------------------------------------------------------------------------
-- RPC: stage rows (≤ 500 per call, ≤ 10 000 per batch, idempotent by row_number)
-- The server validates and normalizes every row; nothing from the browser is trusted.
-- ---------------------------------------------------------------------------

create function public.client_import_stage_rows(p_batch_id uuid, p_rows jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
  v_item jsonb;
  v_row integer;
  v_errors jsonb;
  v_warnings jsonb;
  v_name text;
  v_contact text;
  v_company text;
  v_tax text;
  v_email text;
  v_phone text;
  v_address text;
  v_notes_raw text;
  v_notes text;
  v_type_label text;
  v_type_id uuid;
  v_source_id text;
  v_email_n text;
  v_phone_n text;
  v_tax_n text;
  v_normalized jsonb;
  v_staged integer := 0;
  v_invalid integer := 0;
  v_total integer;
begin
  if v_batch.status not in ('uploaded', 'validated') then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array'
     or pg_catalog.jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'rows must be an array of 1 to 500 items' using errcode = '22023';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_rows) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or pg_catalog.jsonb_typeof(v_item -> 'row_number') <> 'number'
       or (v_item ->> 'row_number') !~ '^[0-9]{1,5}$'
       or (v_item ->> 'row_number')::integer not between 1 and 10000 then
      raise exception 'invalid row_number' using errcode = '22023';
    end if;
    v_row := (v_item ->> 'row_number')::integer;
    v_errors := '[]'::jsonb;
    v_warnings := '[]'::jsonb;

    v_name := nullif(pg_catalog.btrim(v_item ->> 'name'), '');
    v_contact := nullif(pg_catalog.btrim(v_item ->> 'contact_name'), '');
    v_company := nullif(pg_catalog.btrim(v_item ->> 'company_name'), '');
    v_tax := nullif(pg_catalog.btrim(v_item ->> 'tax_id'), '');
    v_email := nullif(pg_catalog.btrim(v_item ->> 'email'), '');
    v_phone := nullif(pg_catalog.btrim(v_item ->> 'phone'), '');
    v_address := nullif(pg_catalog.btrim(v_item ->> 'address'), '');
    v_notes_raw := nullif(pg_catalog.btrim(v_item ->> 'notes'), '');
    v_type_label := nullif(pg_catalog.btrim(v_item ->> 'customer_type'), '');
    v_source_id := nullif(pg_catalog.btrim(v_item ->> 'source_record_id'), '');

    if v_name is null then v_errors := v_errors || '["name_required"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_name, '')) > 200 then v_errors := v_errors || '["too_long:name"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_contact, '')) > 200 then v_errors := v_errors || '["too_long:contact_name"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_company, '')) > 200 then v_errors := v_errors || '["too_long:company_name"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_tax, '')) > 32 then v_errors := v_errors || '["too_long:tax_id"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_email, '')) > 254 then v_errors := v_errors || '["too_long:email"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_phone, '')) > 40 then v_errors := v_errors || '["too_long:phone"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_address, '')) > 500 then v_errors := v_errors || '["too_long:address"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_notes_raw, '')) > 5000 then v_errors := v_errors || '["too_long:notes"]'::jsonb; end if;
    if pg_catalog.char_length(coalesce(v_source_id, '')) > 120 then v_errors := v_errors || '["too_long:source_record_id"]'::jsonb; end if;

    v_email_n := public.normalize_client_email(v_email);
    v_phone_n := public.normalize_client_phone(v_phone);
    v_tax_n := public.normalize_client_tax_id(v_tax);

    if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_errors := v_errors || '["invalid_email"]'::jsonb;
    end if;
    if v_phone is not null and (v_phone_n is null or pg_catalog.length(v_phone_n) not between 6 and 15) then
      v_errors := v_errors || '["invalid_phone"]'::jsonb;
    end if;
    if v_tax is not null and (v_tax_n is null or pg_catalog.length(v_tax_n) not between 5 and 20) then
      v_errors := v_errors || '["invalid_tax_id"]'::jsonb;
    end if;

    v_type_id := null;
    if v_type_label is not null then
      select ct.id into v_type_id
      from public.customer_types ct
      where ct.tenant_id = v_batch.tenant_id
        and ct.active = true
        and pg_catalog.lower(pg_catalog.btrim(ct.name)) = pg_catalog.lower(v_type_label)
      order by ct.created_at
      limit 1;
      if v_type_id is null then
        v_warnings := v_warnings || '["customer_type_not_found"]'::jsonb;
      end if;
    end if;

    v_notes := case when pg_catalog.char_length(coalesce(v_notes_raw, '')) > 5000 then null
                    else imports_private.plain_text_to_rich_html(v_notes_raw) end;

    v_normalized := pg_catalog.jsonb_build_object(
      'name', pg_catalog.left(v_name, 200),
      'contact_name', pg_catalog.left(v_contact, 200),
      'company_name', pg_catalog.left(v_company, 200),
      'tax_id', pg_catalog.left(v_tax, 32),
      'email', pg_catalog.left(v_email, 254),
      'phone', pg_catalog.left(v_phone, 40),
      'address', pg_catalog.left(v_address, 500),
      'notes', v_notes,
      'customer_type_id', v_type_id,
      'customer_type_label', pg_catalog.left(v_type_label, 120)
    );

    if pg_catalog.jsonb_array_length(v_errors) > 0 then
      v_invalid := v_invalid + 1;
    end if;

    insert into imports_private.client_import_rows (
      batch_id, row_number, tenant_id, source_record_id, normalized,
      email_n, phone_n, phone_core, tax_n, row_hash, errors, warnings
    )
    values (
      v_batch.id, v_row, v_batch.tenant_id,
      case when pg_catalog.char_length(coalesce(v_source_id, '')) > 120 then null else v_source_id end,
      v_normalized, v_email_n, v_phone_n, imports_private.phone_core(v_phone_n), v_tax_n,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_normalized::text || '|' || coalesce(v_source_id, ''), 'UTF8')), 'hex'),
      v_errors, v_warnings
    )
    on conflict (batch_id, row_number) do update
    set source_record_id = excluded.source_record_id,
        normalized = excluded.normalized,
        email_n = excluded.email_n,
        phone_n = excluded.phone_n,
        phone_core = excluded.phone_core,
        tax_n = excluded.tax_n,
        row_hash = excluded.row_hash,
        errors = excluded.errors,
        warnings = excluded.warnings,
        classification = null,
        matched_client_id = null,
        matched_row_number = null,
        match_reasons = '{}'::text[],
        decision = null,
        staged_at = pg_catalog.now();
    v_staged := v_staged + 1;
  end loop;

  select pg_catalog.count(*)::integer into v_total
  from imports_private.client_import_rows r
  where r.batch_id = v_batch.id;
  if v_total > 10000 then
    raise exception 'batch exceeds 10000 rows' using errcode = '22023';
  end if;

  update imports_private.client_import_batches b
  set status = 'uploaded',
      total_rows = v_total,
      row_version = b.row_version + 1,
      updated_at = pg_catalog.now()
  where b.id = v_batch.id
  returning * into v_batch;

  return pg_catalog.jsonb_build_object(
    'batch_id', v_batch.id,
    'staged', v_staged,
    'invalid', v_invalid,
    'total_rows', v_total,
    'row_version', v_batch.row_version
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- RPC: finalize (classify every row; set-based)
-- ---------------------------------------------------------------------------

create function public.client_import_finalize(p_batch_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
begin
  if v_batch.status not in ('uploaded', 'validated') then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  if not exists (select 1 from imports_private.client_import_rows r where r.batch_id = v_batch.id) then
    raise exception 'batch has no rows' using errcode = '22023';
  end if;

  update imports_private.client_import_rows r
  set classification = case when pg_catalog.jsonb_array_length(r.errors) > 0 then 'error' else null end,
      matched_client_id = null,
      matched_row_number = null,
      match_reasons = '{}'::text[],
      decision = null
  where r.batch_id = v_batch.id;

  -- 1. Existing clients (same rules as create_client, plus origin id).
  with candidates as (
    select r.row_number, c.id as client_id, c.created_at, 'email'::text as reason
    from imports_private.client_import_rows r
    join public.clients c
      on c.tenant_id = v_batch.tenant_id
     and public.normalize_client_email(c.email) = r.email_n
    where r.batch_id = v_batch.id and r.classification is null and r.email_n is not null
    union all
    select r.row_number, c.id, c.created_at, 'phone'
    from imports_private.client_import_rows r
    join public.clients c
      on c.tenant_id = v_batch.tenant_id
     and public.normalize_client_phone(c.phone) = r.phone_n
    where r.batch_id = v_batch.id and r.classification is null and r.phone_n is not null
    union all
    select r.row_number, c.id, c.created_at, 'tax_id'
    from imports_private.client_import_rows r
    join public.clients c
      on c.tenant_id = v_batch.tenant_id
     and public.normalize_client_tax_id(c.tax_id) = r.tax_n
    where r.batch_id = v_batch.id and r.classification is null and r.tax_n is not null
    union all
    select r.row_number, c.id, c.created_at, 'source_record'
    from imports_private.client_import_rows r
    join public.clients c
      on c.tenant_id = v_batch.tenant_id
     and c.source_system = v_batch.source_system
     and c.source_record_id = r.source_record_id
    where r.batch_id = v_batch.id and r.classification is null and r.source_record_id is not null
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

  -- 2. Duplicates inside the file: a later valid row repeating a key of an
  --    earlier valid row (error rows never block a later row).
  with keys as (
    select r.row_number, 'e:' || r.email_n as k from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and pg_catalog.jsonb_array_length(r.errors) = 0 and r.email_n is not null
    union all
    select r.row_number, 'p:' || r.phone_n from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and pg_catalog.jsonb_array_length(r.errors) = 0 and r.phone_n is not null
    union all
    select r.row_number, 't:' || r.tax_n from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and pg_catalog.jsonb_array_length(r.errors) = 0 and r.tax_n is not null
    union all
    select r.row_number, 's:' || r.source_record_id from imports_private.client_import_rows r
    where r.batch_id = v_batch.id and pg_catalog.jsonb_array_length(r.errors) = 0 and r.source_record_id is not null
  ),
  firsts as (
    select k, pg_catalog.min(row_number) as first_row from keys group by k
  ),
  dups as (
    select keys.row_number, pg_catalog.min(firsts.first_row) as first_row,
           pg_catalog.array_agg(distinct pg_catalog.left(keys.k, 1) order by pg_catalog.left(keys.k, 1)) as kinds
    from keys join firsts using (k)
    where keys.row_number > firsts.first_row
    group by keys.row_number
  )
  update imports_private.client_import_rows r
  set classification = 'duplicate_in_file',
      matched_row_number = d.first_row,
      match_reasons = pg_catalog.array_replace(pg_catalog.array_replace(pg_catalog.array_replace(pg_catalog.array_replace(
        d.kinds, 'e', 'email'), 'p', 'phone'), 't', 'tax_id'), 's', 'source_record')
  from dups d
  where r.batch_id = v_batch.id and r.row_number = d.row_number and r.classification is null;

  -- 3. Possible duplicates: the phone only matches without the 34/0034 prefix.
  --    Materialized: the tenant's keys are computed once, then hash-joined.
  with existing as materialized (
    select c.id, c.created_at, imports_private.phone_core(public.normalize_client_phone(c.phone)) as core
    from public.clients c
    where c.tenant_id = v_batch.tenant_id and c.phone is not null
  ),
  matches as (
    select distinct on (r.row_number) r.row_number, e.id
    from imports_private.client_import_rows r
    join existing e on e.core = r.phone_core
    where r.batch_id = v_batch.id and r.classification is null and r.phone_core is not null
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
  where r.batch_id = v_batch.id and r.classification is null;

  -- Default decisions: never overwrite, skip anything doubtful.
  update imports_private.client_import_rows r
  set decision = case
    when r.classification = 'valid' then 'create'
    when r.classification = 'duplicate_existing' and v_batch.duplicate_strategy = 'fill_blanks' then 'fill_blanks'
    else 'skip'
  end
  where r.batch_id = v_batch.id;

  update imports_private.client_import_batches b
  set status = 'validated',
      row_version = b.row_version + 1,
      updated_at = pg_catalog.now()
  where b.id = v_batch.id;
  perform imports_private.refresh_batch_counters(v_batch.id);

  select * into v_batch from imports_private.client_import_batches b where b.id = p_batch_id;
  return imports_private.batch_json(v_batch);
end;
$function$;

-- ---------------------------------------------------------------------------
-- RPC: summary for the review step (read-only)
-- ---------------------------------------------------------------------------

create function public.client_import_summary(p_batch_id uuid, p_limit integer default 50)
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
      select pg_catalog.jsonb_agg(x.item order by x.row_number)
      from (
        select r.row_number, pg_catalog.jsonb_build_object(
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
        ) as item
        from imports_private.client_import_rows r
        left join public.clients c on c.id = r.matched_client_id and c.tenant_id = v_batch.tenant_id
        where r.batch_id = v_batch.id
        order by (r.classification = 'valid'), r.row_number
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- RPC: duplicate strategy and per-row decisions (before commit only)
-- ---------------------------------------------------------------------------

create function public.client_import_set_strategy(
  p_batch_id uuid,
  p_strategy text,
  p_confirm boolean default false
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
begin
  if v_batch.status <> 'validated' then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  if coalesce(p_strategy, '') not in ('skip', 'fill_blanks') then
    raise exception 'invalid strategy' using errcode = '22023';
  end if;
  if p_strategy = 'fill_blanks' and p_confirm is not true then
    raise exception 'fill_blanks requires confirmation' using errcode = '22023';
  end if;

  update imports_private.client_import_rows r
  set decision = case when p_strategy = 'fill_blanks' then 'fill_blanks' else 'skip' end
  where r.batch_id = v_batch.id and r.classification = 'duplicate_existing';

  update imports_private.client_import_batches b
  set duplicate_strategy = p_strategy,
      row_version = b.row_version + 1,
      updated_at = pg_catalog.now()
  where b.id = v_batch.id
  returning * into v_batch;

  return imports_private.batch_json(v_batch);
end;
$function$;

create function public.client_import_set_row_decisions(
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

-- ---------------------------------------------------------------------------
-- RPC: commit one chunk (resumable, optimistic version, one transaction)
-- ---------------------------------------------------------------------------

create function public.client_import_commit_chunk(
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
    raise exception 'row_version_conflict' using errcode = '40001', detail = v_batch.row_version::text;
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
-- RPC: cancel (before any write) and revert (after commit or a partial commit)
-- ---------------------------------------------------------------------------

create function public.client_import_cancel(p_batch_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
begin
  if v_batch.status not in ('uploaded', 'validated') then
    raise exception 'batch_state' using errcode = '55000', detail = v_batch.status;
  end if;
  update imports_private.client_import_batches b
  set status = 'cancelled', row_version = b.row_version + 1, updated_at = pg_catalog.now()
  where b.id = v_batch.id
  returning * into v_batch;
  return imports_private.batch_json(v_batch);
end;
$function$;

create function public.client_import_revert(p_batch_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_batch imports_private.client_import_batches%rowtype := imports_private.lock_batch(p_batch_id);
  v_row imports_private.client_import_rows%rowtype;
  v_client public.clients%rowtype;
  v_restore jsonb;
  v_field text;
  v_kept jsonb := '[]'::jsonb;
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

  update imports_private.client_import_batches b
  set status = 'reverted', reverted_at = pg_catalog.now(), row_version = b.row_version + 1, updated_at = pg_catalog.now()
  where b.id = v_batch.id;
  perform imports_private.refresh_batch_counters(v_batch.id);
  select * into v_batch from imports_private.client_import_batches b where b.id = v_batch.id;
  perform imports_private.log_batch_activity(v_batch, 'client_import.reverted');

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object('kept', v_kept);
end;
$function$;

-- ---------------------------------------------------------------------------
-- RPC: report rows and batch history (management only, read-only)
-- ---------------------------------------------------------------------------

create function public.client_import_report(p_batch_id uuid, p_offset integer default 0, p_limit integer default 1000)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_batch imports_private.client_import_batches%rowtype;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
begin
  select b.tenant_id into v_tenant from imports_private.client_import_batches b where b.id = p_batch_id;
  if v_tenant is null
     or not public.has_active_tenant_role(v_tenant, array['owner', 'admin', 'manager']::text[]) then
    raise exception 'import batch not found' using errcode = 'P0002';
  end if;
  perform imports_private.assert_import_access(v_tenant);
  select * into v_batch from imports_private.client_import_batches b where b.id = p_batch_id;

  return imports_private.batch_json(v_batch) || pg_catalog.jsonb_build_object(
    'offset', v_offset,
    'rows', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'row_number', r.row_number,
        'source_record_id', r.source_record_id,
        'name', r.normalized ->> 'name',
        'classification', r.classification,
        'decision', r.decision,
        'result', r.result,
        'result_reason', r.result_reason,
        'errors', r.errors,
        'warnings', r.warnings,
        'client_id', r.client_id,
        'matched_client_id', r.matched_client_id,
        'revert_result', r.revert_result
      ) order by r.row_number)
      from (
        select * from imports_private.client_import_rows r0
        where r0.batch_id = v_batch.id
        order by r0.row_number
        offset v_offset limit v_limit
      ) r
    ), '[]'::jsonb)
  );
end;
$function$;

create function public.client_import_list_batches(p_tenant_id uuid, p_limit integer default 20)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
begin
  perform imports_private.assert_import_access(p_tenant_id);
  return coalesce((
    select pg_catalog.jsonb_agg(imports_private.batch_json(b) order by b.created_at desc)
    from (
      select * from imports_private.client_import_batches b0
      where b0.tenant_id = p_tenant_id
      order by b0.created_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) b
  ), '[]'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Maintenance: purge staged rows after 30 days (service_role / cron only)
-- ---------------------------------------------------------------------------

create function public.client_import_purge_expired(p_limit integer default 50)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_ids uuid[];
  v_rows integer;
begin
  select pg_catalog.array_agg(b.id) into v_ids
  from (
    select b0.id from imports_private.client_import_batches b0
    where b0.expires_at < pg_catalog.now() and b0.rows_purged_at is null
    order by b0.expires_at
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
    for update skip locked
  ) b;

  if v_ids is null then
    return pg_catalog.jsonb_build_object('batches', 0, 'rows', 0);
  end if;

  delete from imports_private.client_import_rows r where r.batch_id = any (v_ids);
  get diagnostics v_rows = row_count;

  update imports_private.client_import_batches b
  set rows_purged_at = pg_catalog.now(),
      status = case when b.status in ('uploaded', 'validated') then 'expired' else b.status end,
      updated_at = pg_catalog.now()
  where b.id = any (v_ids);

  return pg_catalog.jsonb_build_object('batches', pg_catalog.cardinality(v_ids), 'rows', v_rows);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants: API RPCs for authenticated only; maintenance for service_role only.
-- ---------------------------------------------------------------------------

revoke all on function imports_private.guard_client_origin() from public;
revoke all on function imports_private.assert_import_access(uuid) from public;
revoke all on function imports_private.lock_batch(uuid) from public;
revoke all on function imports_private.plain_text_to_rich_html(text) from public;
revoke all on function imports_private.phone_core(text) from public;
revoke all on function imports_private.client_id_from_detail(text) from public;
revoke all on function imports_private.refresh_batch_counters(uuid) from public;
revoke all on function imports_private.batch_json(imports_private.client_import_batches) from public;
revoke all on function imports_private.log_batch_activity(imports_private.client_import_batches, text) from public;

revoke all on function public.client_import_create_batch(uuid, text, text, bigint, text, jsonb, text) from public, anon;
revoke all on function public.client_import_stage_rows(uuid, jsonb) from public, anon;
revoke all on function public.client_import_finalize(uuid) from public, anon;
revoke all on function public.client_import_summary(uuid, integer) from public, anon;
revoke all on function public.client_import_set_strategy(uuid, text, boolean) from public, anon;
revoke all on function public.client_import_set_row_decisions(uuid, integer[], text) from public, anon;
revoke all on function public.client_import_commit_chunk(uuid, integer, integer) from public, anon;
revoke all on function public.client_import_cancel(uuid) from public, anon;
revoke all on function public.client_import_revert(uuid) from public, anon;
revoke all on function public.client_import_report(uuid, integer, integer) from public, anon;
revoke all on function public.client_import_list_batches(uuid, integer) from public, anon;
revoke all on function public.client_import_purge_expired(integer) from public, anon, authenticated;

grant execute on function public.client_import_create_batch(uuid, text, text, bigint, text, jsonb, text) to authenticated;
grant execute on function public.client_import_stage_rows(uuid, jsonb) to authenticated;
grant execute on function public.client_import_finalize(uuid) to authenticated;
grant execute on function public.client_import_summary(uuid, integer) to authenticated;
grant execute on function public.client_import_set_strategy(uuid, text, boolean) to authenticated;
grant execute on function public.client_import_set_row_decisions(uuid, integer[], text) to authenticated;
grant execute on function public.client_import_commit_chunk(uuid, integer, integer) to authenticated;
grant execute on function public.client_import_cancel(uuid) to authenticated;
grant execute on function public.client_import_revert(uuid) to authenticated;
grant execute on function public.client_import_report(uuid, integer, integer) to authenticated;
grant execute on function public.client_import_list_batches(uuid, integer) to authenticated;
grant execute on function public.client_import_purge_expired(integer) to service_role;

comment on function public.client_import_commit_chunk(uuid, integer, integer) is
  'Migration V1. DEFINER: checks auth.uid(), active owner/admin/manager membership, active tenant and feature clients_import; creates clients through create_client_v2 (its own role, validation and duplicate checks apply) and never overwrites non-empty fields.';

commit;
