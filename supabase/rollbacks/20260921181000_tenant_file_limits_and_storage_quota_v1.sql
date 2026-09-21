begin;

drop function if exists public.update_tenant_files_max_file_bytes(uuid, bigint);
drop function if exists public.get_tenant_files_settings(uuid);
drop function if exists public.tenant_storage_usage(uuid);
drop function if exists public.resolve_tenant_max_file_bytes(uuid);
drop function if exists public.resolve_tenant_storage_limit_bytes(uuid);

-- Restore create_order_file_upload without quota/max-file hardening
-- (body from 20260918220000_order_files_v1.sql).
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
  'Controlled pending create. HMAC capability + app.order_file_action=create. storage_key server-side.';

revoke all on function public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text)
  from public;
grant execute on function public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text)
  to authenticated, postgres;

commit;
