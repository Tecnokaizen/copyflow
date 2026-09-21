-- Settings V1 · tenant file limits + commercial storage quota enforcement.
--
-- Commercial quota: features.storage_bytes via plan_features.limit_value (bytes).
-- NULL / missing / disabled feature => quota not enforced (legacy-unconfigured).
-- Does NOT seed plan_features for mvp or assign quotas to real tenants.
--
-- Operational max per file: tenant_settings.preferences.files_v1.max_file_bytes
-- Platform hard ceiling remains 104857600 (100 MiB).
--
-- Units:
--   1 MiB = 1,048,576 bytes
--   1 GiB = 1,073,741,824 bytes

begin;

-- ---------------------------------------------------------------------------
-- resolve_tenant_storage_limit_bytes
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_storage_limit_bytes(
  p_tenant_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_limit bigint;
begin
  if p_tenant_id is null then
    return null;
  end if;

  select pf.limit_value
  into v_limit
  from public.subscriptions s
  join public.plans p
    on p.id = s.plan_id
  join public.plan_features pf
    on pf.plan_id = p.id
  join public.features f
    on f.id = pf.feature_id
  where s.tenant_id = p_tenant_id
    and s.status = any (array['trialing', 'active', 'past_due']::text[])
    and f.code = 'storage_bytes'
    and pf.enabled is true
  order by s.created_at desc
  limit 1;

  -- Missing feature row, disabled feature, or explicit NULL limit_value:
  -- legacy-unconfigured (do not enforce). limit_value = 0 means zero bytes.
  return v_limit;
end;
$function$;

comment on function public.resolve_tenant_storage_limit_bytes(uuid) is
  'Effective commercial storage quota in bytes from current subscription plan feature storage_bytes. NULL = not enforced / legacy-unconfigured.';

revoke all on function public.resolve_tenant_storage_limit_bytes(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tenant_storage_limit_bytes(uuid)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- resolve_tenant_max_file_bytes
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_max_file_bytes(
  p_tenant_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_raw text;
  v_value bigint;
  v_platform_max constant bigint := 104857600; -- 100 MiB
begin
  if p_tenant_id is null then
    return v_platform_max;
  end if;

  select ts.preferences -> 'files_v1' ->> 'max_file_bytes'
  into v_raw
  from public.tenant_settings ts
  where ts.tenant_id = p_tenant_id;

  if v_raw is null or btrim(v_raw) = '' then
    return v_platform_max;
  end if;

  begin
    v_value := v_raw::bigint;
  exception
    when others then
      return v_platform_max;
  end;

  if v_value is null or v_value <= 0 or v_value > v_platform_max then
    return v_platform_max;
  end if;

  return v_value;
end;
$function$;

comment on function public.resolve_tenant_max_file_bytes(uuid) is
  'Operational max file size for tenant from preferences.files_v1.max_file_bytes. Fallback 100 MiB. Never exceeds platform hard ceiling.';

revoke all on function public.resolve_tenant_max_file_bytes(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tenant_max_file_bytes(uuid)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- tenant_storage_usage (internal helper shape as jsonb)
-- ---------------------------------------------------------------------------
create or replace function public.tenant_storage_usage(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_file_count bigint := 0;
  v_reserved bigint := 0;
  v_ready bigint := 0;
  v_pending bigint := 0;
begin
  if p_tenant_id is null then
    raise exception 'tenant id required'
      using errcode = '22023';
  end if;

  select
    count(of.id) filter (where of.deleted_at is null),
    coalesce(sum(of.size_bytes) filter (where of.deleted_at is null), 0),
    coalesce(sum(of.size_bytes) filter (
      where of.deleted_at is null and of.status = 'ready'
    ), 0),
    coalesce(sum(of.size_bytes) filter (
      where of.deleted_at is null and of.status = 'pending'
    ), 0)
  into v_file_count, v_reserved, v_ready, v_pending
  from public.order_files of
  where of.tenant_id = p_tenant_id;

  return pg_catalog.jsonb_build_object(
    'file_count', v_file_count,
    'reserved_bytes', v_reserved,
    'ready_bytes', v_ready,
    'pending_bytes', v_pending
  );
end;
$function$;

comment on function public.tenant_storage_usage(uuid) is
  'Tenant-scoped storage usage. reserved_bytes = sum(size_bytes) where deleted_at is null (ready + pending).';

revoke all on function public.tenant_storage_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.tenant_storage_usage(uuid)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- get_tenant_files_settings (Settings UI)
-- ---------------------------------------------------------------------------
create or replace function public.get_tenant_files_settings(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_usage jsonb;
  v_limit bigint;
  v_max_file bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null then
    raise exception 'tenant id required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  v_usage := public.tenant_storage_usage(p_tenant_id);
  v_limit := public.resolve_tenant_storage_limit_bytes(p_tenant_id);
  v_max_file := public.resolve_tenant_max_file_bytes(p_tenant_id);

  return pg_catalog.jsonb_build_object(
    'storage_limit_bytes', to_jsonb(v_limit),
    'max_file_bytes', v_max_file,
    'platform_max_file_bytes', 104857600,
    'file_count', v_usage -> 'file_count',
    'reserved_bytes', v_usage -> 'reserved_bytes',
    'ready_bytes', v_usage -> 'ready_bytes',
    'pending_bytes', v_usage -> 'pending_bytes',
    'quota_configured', (v_limit is not null)
  );
end;
$function$;

comment on function public.get_tenant_files_settings(uuid) is
  'Settings read model for /settings/files. owner/admin/manager only. storage_limit_bytes null = Sin cuota configurada.';

revoke all on function public.get_tenant_files_settings(uuid)
  from public, anon;
grant execute on function public.get_tenant_files_settings(uuid)
  to authenticated, postgres, service_role;

-- ---------------------------------------------------------------------------
-- update_tenant_files_max_file_bytes
-- Merges preferences.files_v1 without wiping neighboring keys.
-- SECURITY DEFINER so manager can write (tenant_settings UPDATE is owner/admin).
-- ---------------------------------------------------------------------------
create or replace function public.update_tenant_files_max_file_bytes(
  p_tenant_id uuid,
  p_max_file_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_platform_max constant bigint := 104857600;
  v_files jsonb;
  v_prefs jsonb;
  v_updated public.tenant_settings%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null then
    raise exception 'tenant id required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if p_max_file_bytes is null
     or p_max_file_bytes <= 0
     or p_max_file_bytes > v_platform_max
     or p_max_file_bytes <> trunc(p_max_file_bytes)
  then
    raise exception 'invalid_max_file_bytes'
      using errcode = '22023';
  end if;

  select coalesce(ts.preferences, '{}'::jsonb)
  into v_prefs
  from public.tenant_settings ts
  where ts.tenant_id = p_tenant_id
  for update;

  if not found then
    insert into public.tenant_settings (tenant_id, preferences)
    values (p_tenant_id, '{}'::jsonb)
    returning preferences into v_prefs;
  end if;

  v_files := coalesce(v_prefs -> 'files_v1', '{}'::jsonb);
  if jsonb_typeof(v_files) is distinct from 'object' then
    v_files := '{}'::jsonb;
  end if;

  if not (v_files ? 'version') then
    v_files := v_files || jsonb_build_object('version', 1);
  end if;

  v_files := v_files || jsonb_build_object('max_file_bytes', p_max_file_bytes);
  v_prefs := jsonb_set(v_prefs, '{files_v1}', v_files, true);

  update public.tenant_settings
  set
    preferences = v_prefs,
    updated_at = pg_catalog.now()
  where tenant_id = p_tenant_id
  returning * into v_updated;

  return public.get_tenant_files_settings(p_tenant_id);
end;
$function$;

comment on function public.update_tenant_files_max_file_bytes(uuid, bigint) is
  'Merges preferences.files_v1.max_file_bytes for owner/admin/manager. Preserves neighboring preference keys. Caps at 100 MiB.';

revoke all on function public.update_tenant_files_max_file_bytes(uuid, bigint)
  from public, anon;
grant execute on function public.update_tenant_files_max_file_bytes(uuid, bigint)
  to authenticated, postgres, service_role;

-- ---------------------------------------------------------------------------
-- create_order_file_upload · harden with max-file + atomic quota
-- ---------------------------------------------------------------------------
create or replace function public.create_order_file_upload(
  p_order_id uuid,
  p_file_id uuid,
  p_original_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_upload_expires_at timestamptz,
  p_issued_at bigint,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_storage_key text;
  v_row public.order_files%rowtype;
  v_platform_max constant bigint := 104857600;
  v_max_file bigint;
  v_storage_limit bigint;
  v_reserved bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_file_id is null
     or p_original_name is null
     or p_size_bytes is null
     or p_upload_expires_at is null
     or p_issued_at is null
     or p_signature is null
  then
    raise exception 'required arguments missing'
      using errcode = '22023';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  if not public.has_tenant_role(
    v_order.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;

  if not files_private.verify_files_capability(
    'create',
    v_user_id,
    v_order.tenant_id,
    p_order_id,
    p_file_id,
    p_issued_at,
    p_signature
  ) then
    raise exception 'invalid capability'
      using errcode = '42501';
  end if;

  -- Serialize quota checks per tenant for concurrent INIT.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('file-quota:' || v_order.tenant_id::text, 0)
  );

  v_max_file := public.resolve_tenant_max_file_bytes(v_order.tenant_id);
  if p_size_bytes <= 0
     or p_size_bytes > v_max_file
     or p_size_bytes > v_platform_max
  then
    raise exception 'file_too_large'
      using errcode = '22023';
  end if;

  v_storage_limit := public.resolve_tenant_storage_limit_bytes(v_order.tenant_id);
  if v_storage_limit is not null then
    select coalesce(sum(of.size_bytes), 0)
    into v_reserved
    from public.order_files of
    where of.tenant_id = v_order.tenant_id
      and of.deleted_at is null;

    if v_reserved + p_size_bytes > v_storage_limit then
      raise exception 'storage_quota_exceeded'
        using errcode = 'P0001';
    end if;
  end if;

  v_storage_key :=
    'orders/'
    || v_order.tenant_id::text
    || '/'
    || v_order.id::text
    || '/'
    || p_file_id::text;

  perform pg_catalog.set_config('app.order_file_action', 'create', true);

  insert into public.order_files (
    id,
    tenant_id,
    order_id,
    original_name,
    content_type,
    size_bytes,
    storage_provider,
    storage_key,
    status,
    uploaded_by,
    upload_expires_at
  ) values (
    p_file_id,
    v_order.tenant_id,
    v_order.id,
    p_original_name,
    nullif(btrim(p_content_type), ''),
    p_size_bytes,
    'r2',
    v_storage_key,
    'pending',
    v_user_id,
    p_upload_expires_at
  )
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'file', public.order_file_public_json(v_row),
    'storage_key', v_row.storage_key,
    'upload_expires_at', v_row.upload_expires_at
  );
end;
$function$;

comment on function public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text) is
  'Controlled pending create. HMAC + max_file + atomic storage quota (advisory lock file-quota:tenant). NULL quota = not enforced.';

revoke all on function public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text)
  from public;
grant execute on function public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text)
  to authenticated, postgres;

commit;
