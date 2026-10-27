-- R5 · Direct writes to public.orders only through controlled RPCs.
--
-- authenticated holds table-level UPDATE on public.orders, and the policy
-- orders_update_operator lets every operative role (owner/admin/manager/staff)
-- PATCH the table directly through PostgREST. That skipped everything only the
-- RPCs check: archived immutability (20260917214500), row_version
-- (20260918140000), active catalogues and normalisation. Only the lifecycle,
-- total_amount and items_* columns had a guard. The app itself never updates
-- orders directly; its only direct write is the INSERT of POST /api/orders.
--
-- 1. tg_orders_write_guard, BEFORE INSERT OR UPDATE, SECURITY INVOKER:
--    * postgres / supabase_admin pass: migrations, seeds and the SECURITY
--      DEFINER RPCs owned by postgres (totals, lines, quote conversion, kiosk);
--    * UPDATE: id, tenant_id, reference, created_by and created_at never
--      change; any other change needs app.order_write = 'validated' in the
--      current transaction. A never-set custom GUC is NULL, and NULL means
--      "not allowed" (the lesson of 20261016125000);
--    * INSERT: created_by is NULL or the current user, never another member.
--    The trigger name sorts after the lifecycle, total and items guards, so
--    their error messages are unchanged.
-- 2. The eight SECURITY INVOKER RPCs that UPDATE public.orders set the marker
--    right before each UPDATE and clear it once, right after the FOUND check
--    that follows (PERFORM overwrites FOUND). ALTER FUNCTION ... SET
--    app.order_write was refused on local Supabase ("permission denied to set
--    parameter": postgres is not a superuser), so the marker uses set_config,
--    like convert_quote_to_order does with gestcopy.order_total_write.
--    Bodies are verbatim from their last migration; only the marker lines and
--    one comment per function are new. Grants and comments are kept by
--    CREATE OR REPLACE.
-- 3. INSERT on public.orders for authenticated becomes column-level: the 15
--    columns POST /api/orders writes, plus id. A direct insert can no longer
--    set archived_at, ready_at, delivered_at, customer_notification_*,
--    reference, metadata, requirements_override, received_at, row_version,
--    external_folder_url or the totals.
--
-- Not touched: RLS policies, SECURITY DEFINER RPCs, the existing guards and
-- activity triggers, Kiosk objects, data.
--
-- Rollback: supabase/rollbacks/20261022120000_order_direct_write_guard_v1.sql
-- (re-opens the direct-write gap; prefer fixing forward).

begin;

-- ---------------------------------------------------------------------------
-- 1. Guard
-- ---------------------------------------------------------------------------
create or replace function public.tg_orders_write_guard()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
begin
  -- Technical exceptions only: migrations, seeds and SECURITY DEFINER RPCs
  -- owned by postgres. No API role is exempt (service_role included).
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is not null
       and new.created_by is distinct from auth.uid() then
      raise exception 'order created_by must be the current user'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- The identity of an order never changes from the API, marker or not.
  if (new.id, new.tenant_id, new.reference, new.created_by, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.reference, old.created_by, old.created_at) then
    raise exception 'order identity columns are immutable'
      using errcode = '42501';
  end if;

  -- A never-set custom GUC is NULL: NULL means "not allowed".
  if coalesce(pg_catalog.current_setting('app.order_write', true), '')
     is distinct from 'validated' then
    raise exception 'orders can only change through controlled RPCs'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.tg_orders_write_guard() is
  'BEFORE INSERT OR UPDATE guard on public.orders. UPDATE needs app.order_write=validated (set by the order RPCs around their UPDATE) and never changes id/tenant_id/reference/created_by/created_at; INSERT keeps created_by NULL or auth.uid(). postgres/supabase_admin pass.';

drop trigger if exists trg_orders_write_guard on public.orders;
create trigger trg_orders_write_guard
  before insert or update on public.orders
  for each row
  execute function public.tg_orders_write_guard();

revoke all on function public.tg_orders_write_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The eight SECURITY INVOKER order RPCs: marker around their UPDATE
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- change_order_content_v2
-- Body verbatim from 20260919180000_order_content_external_folder_url.sql:4; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_content_v2 (
  p_order_id  uuid,
  p_field     text,
  p_value     text,
  p_tenant_id uuid,
  p_expected_version bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_normalized_value text;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_field is null
     or p_tenant_id is null then
    raise exception 'p_order_id, p_field and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_field not in (
    'title',
    'description',
    'notes',
    'external_folder_url'
  ) then
    raise exception 'invalid order content field'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- Archived orders are read-only (Order Editing V1 · E1).
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;

  if p_expected_version is null then
    raise exception 'p_expected_version is required'
      using errcode = '22023';
  end if;

  if v_order.row_version is distinct from p_expected_version then
    raise exception 'order has been modified since last read'
      using errcode = 'GCO01';
  end if;

  -- =======================================================
  -- TÍTULO
  -- =======================================================

  if p_field = 'title' then

    if p_value is null
       or pg_catalog.btrim(p_value) = '' then
      raise exception 'title cannot be empty'
        using errcode = '22023';
    end if;

    v_normalized_value := pg_catalog.btrim(p_value);

    if v_order.title is not distinct from v_normalized_value then
      return pg_catalog.jsonb_build_object(
        'order',
        pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'title', v_order.title,
          'description', v_order.description,
          'notes', v_order.notes,
          'external_folder_url', v_order.external_folder_url
        ),
        'field', p_field,
        'value', v_order.title
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set title = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- DESCRIPCIÓN
  -- =======================================================

  elsif p_field = 'description' then

    if p_value is null
       or pg_catalog.btrim(p_value) = '' then
      v_normalized_value := null;
    else
      v_normalized_value := pg_catalog.btrim(p_value);
    end if;

    if v_order.description is not distinct from v_normalized_value then
      return pg_catalog.jsonb_build_object(
        'order',
        pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'title', v_order.title,
          'description', v_order.description,
          'notes', v_order.notes,
          'external_folder_url', v_order.external_folder_url
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_order.description)
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set description = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- NOTAS
  -- =======================================================

  elsif p_field = 'notes' then

    if p_value is null
       or pg_catalog.btrim(p_value) = '' then
      v_normalized_value := null;
    else
      v_normalized_value := pg_catalog.btrim(p_value);
    end if;

    if v_order.notes is not distinct from v_normalized_value then
      return pg_catalog.jsonb_build_object(
        'order',
        pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'title', v_order.title,
          'description', v_order.description,
          'notes', v_order.notes,
          'external_folder_url', v_order.external_folder_url
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_order.notes)
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set notes = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- ENLACE EXTERNO (Drive / carpeta)
  -- Vacío => NULL. Solo http(s), máx 2048.
  -- =======================================================

  elsif p_field = 'external_folder_url' then

    if p_value is null
       or pg_catalog.btrim(p_value) = '' then
      v_normalized_value := null;
    else
      v_normalized_value := pg_catalog.btrim(p_value);

      if pg_catalog.char_length(v_normalized_value) > 2048 then
        raise exception 'invalid order content value'
          using errcode = '22023';
      end if;

      -- Align with API URL() + http(s)-only contract:
      -- scheme http/https, non-empty host, host without whitespace.
      -- Rejects bare "https://", "http://", whitespace-only hosts, and
      -- non-http(s) schemes (javascript:, data:, ftp:, …).
      if v_normalized_value !~* '^https?://[^[:space:]/?#]+([/?#]|$)' then
        raise exception 'invalid order content value'
          using errcode = '22023';
      end if;
    end if;

    if v_order.external_folder_url is not distinct from v_normalized_value then
      return pg_catalog.jsonb_build_object(
        'order',
        pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'title', v_order.title,
          'description', v_order.description,
          'notes', v_order.notes,
          'external_folder_url', v_order.external_folder_url
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_order.external_folder_url)
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set external_folder_url = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;

  end if;


  if not found then
    raise exception 'could not update order content'
      using errcode = 'P0001';
  end if;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  perform pg_catalog.set_config('app.order_write', '', true);


  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'title', v_updated.title,
      'description', v_updated.description,
      'notes', v_updated.notes,
      'external_folder_url', v_updated.external_folder_url
    ),
    'field', p_field,
    'value',
      case p_field
        when 'title'
          then pg_catalog.to_jsonb(v_updated.title)
        when 'description'
          then pg_catalog.to_jsonb(v_updated.description)
        when 'notes'
          then pg_catalog.to_jsonb(v_updated.notes)
        when 'external_folder_url'
          then pg_catalog.to_jsonb(v_updated.external_folder_url)
        else 'null'::jsonb
      end
  )
    || pg_catalog.jsonb_build_object(
      'version', v_updated.row_version::text
    );
end;
$function$;

-- ---------------------------------------------------------------------------
-- change_order_details_v2
-- Body verbatim from 20260918140000_order_concurrency_v1.sql:271; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_details_v2 (
  p_order_id  uuid,
  p_field     text,
  p_value     text,
  p_tenant_id uuid,
  p_expected_version bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;

  v_value_uuid uuid;
  v_due_at timestamptz;
  v_priority text;

  v_value_code text;
  v_value_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_field is null
     or p_tenant_id is null then
    raise exception 'p_order_id, p_field and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_field not in (
    'priority',
    'service_id',
    'entry_channel_id',
    'assigned_team_member_id',
    'order_context_id',
    'store_id',
    'due_at'
  ) then
    raise exception 'invalid order detail field'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- Archived orders are read-only (Order Editing V1 · E1).
  -- Same semantics as change_order_status: reject before any mutation,
  -- including idempotent no-op paths.
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;


  if p_expected_version is null then
    raise exception 'p_expected_version is required'
      using errcode = '22023';
  end if;

  if v_order.row_version is distinct from p_expected_version then
    raise exception 'order has been modified since last read'
      using errcode = 'GCO01';
  end if;


  -- =======================================================
  -- PRIORIDAD
  -- =======================================================

  if p_field = 'priority' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      raise exception 'priority cannot be null'
        using errcode = '22023';
    end if;

    v_priority := pg_catalog.lower(pg_catalog.btrim(p_value));

    if v_priority not in ('normal', 'high', 'urgent') then
      raise exception 'invalid priority'
        using errcode = '22023';
    end if;

    if v_order.priority is not distinct from v_priority then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value', v_priority
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set priority = v_priority
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- SERVICIO
  -- =======================================================

  elsif p_field = 'service_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid service_id'
            using errcode = '22023';
      end;

      select null::text, name
      into v_value_code, v_value_name
      from public.services
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid service for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.service_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'name', v_value_name
            )
          end
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set service_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- CANAL DE ENTRADA
  -- =======================================================

  elsif p_field = 'entry_channel_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid entry_channel_id'
            using errcode = '22023';
      end;

      select code, name
      into v_value_code, v_value_name
      from public.entry_channels
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid entry channel for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.entry_channel_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'code', v_value_code,
              'name', v_value_name
            )
          end
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set entry_channel_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- RESPONSABLE
  -- =======================================================

  elsif p_field = 'assigned_team_member_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid assigned_team_member_id'
            using errcode = '22023';
      end;

      select null::text, name
      into v_value_code, v_value_name
      from public.team_members
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid team member for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.assigned_team_member_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'name', v_value_name
            )
          end
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set assigned_team_member_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- CONTEXTO
  -- =======================================================

  elsif p_field = 'order_context_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid order_context_id'
            using errcode = '22023';
      end;

      select code, name
      into v_value_code, v_value_name
      from public.order_contexts
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid order context for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.order_context_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'code', v_value_code,
              'name', v_value_name
            )
          end
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set order_context_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;



  -- =======================================================
  -- TIENDA
  -- =======================================================

  elsif p_field = 'store_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid store_id'
            using errcode = '22023';
      end;

      select code, name
      into v_value_code, v_value_name
      from public.stores
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid store for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.store_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'store_id', v_order.store_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'code', v_value_code,
              'name', v_value_name
            )
          end
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set store_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- FECHA PREVISTA
  -- =======================================================

  elsif p_field = 'due_at' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_due_at := null;
    else
      begin
        v_due_at := pg_catalog.btrim(p_value)::timestamptz;
      exception
        when invalid_datetime_format
          or datetime_field_overflow then
          raise exception 'invalid due_at'
            using errcode = '22023';
      end;
    end if;

    if v_order.due_at is not distinct from v_due_at then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_due_at)
      )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
    end if;

    perform pg_catalog.set_config('app.order_write', 'validated', true);
    update public.orders
    set due_at = v_due_at
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;

  end if;


  if not found then
    raise exception 'could not update order details'
      using errcode = 'P0001';
  end if;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  perform pg_catalog.set_config('app.order_write', '', true);


  -- =======================================================
  -- RESPUESTA
  -- =======================================================

  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'priority', v_updated.priority,
      'service_id', v_updated.service_id,
      'entry_channel_id', v_updated.entry_channel_id,
      'assigned_team_member_id', v_updated.assigned_team_member_id,
      'order_context_id', v_updated.order_context_id,
      'store_id', v_updated.store_id,
      'due_at', v_updated.due_at
    ),
    'field', p_field,
    'value',
      case
        when p_field = 'priority'
          then pg_catalog.to_jsonb(v_updated.priority)

        when p_field = 'due_at'
          then pg_catalog.to_jsonb(v_updated.due_at)

        when v_value_uuid is null
          then 'null'::jsonb

        else pg_catalog.jsonb_build_object(
          'id', v_value_uuid,
          'code', v_value_code,
          'name', v_value_name
        )
      end
  )
    || pg_catalog.jsonb_build_object(
      'version', v_updated.row_version::text
    );
end;
$function$;

-- ---------------------------------------------------------------------------
-- change_order_management_v2
-- Body verbatim from 20260918140000_order_concurrency_v1.sql:836; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_management_v2 (
  p_order_id  uuid,
  p_field     text,
  p_value_id  uuid,
  p_tenant_id uuid,
  p_expected_version bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_value_code text;
  v_value_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_field is null
     or p_tenant_id is null then
    raise exception 'p_order_id, p_field and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_field not in (
    'file_status_id',
    'quote_status_id',
    'payment_status_id',
    'delivery_method_id'
  ) then
    raise exception 'invalid management field'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- Archived orders are read-only (Order Editing V1 · E1).
  -- Same semantics as change_order_status: reject before any mutation,
  -- including idempotent no-op paths.
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;


  if p_expected_version is null then
    raise exception 'p_expected_version is required'
      using errcode = '22023';
  end if;

  if v_order.row_version is distinct from p_expected_version then
    raise exception 'order has been modified since last read'
      using errcode = 'GCO01';
  end if;

  -- -------------------------------------------------------
  -- Validar que la opción pertenece al catálogo correcto,
  -- al mismo tenant y está activa.
  -- NULL está permitido para limpiar el campo.
  -- -------------------------------------------------------

  if p_value_id is not null then

    case p_field

      when 'file_status_id' then
        select code, name
        into v_value_code, v_value_name
        from public.file_statuses
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

      when 'quote_status_id' then
        select code, name
        into v_value_code, v_value_name
        from public.quote_statuses
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

      when 'payment_status_id' then
        select code, name
        into v_value_code, v_value_name
        from public.payment_statuses
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

      when 'delivery_method_id' then
        select code, name
        into v_value_code, v_value_name
        from public.delivery_methods
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

    end case;

    if not found then
      raise exception 'invalid management option for current tenant'
        using errcode = '22023';
    end if;

  end if;

  -- -------------------------------------------------------
  -- Idempotencia: mismo valor = no UPDATE, no activity_log
  -- -------------------------------------------------------

  if
    (p_field = 'file_status_id'
      and v_order.file_status_id is not distinct from p_value_id)
    or
    (p_field = 'quote_status_id'
      and v_order.quote_status_id is not distinct from p_value_id)
    or
    (p_field = 'payment_status_id'
      and v_order.payment_status_id is not distinct from p_value_id)
    or
    (p_field = 'delivery_method_id'
      and v_order.delivery_method_id is not distinct from p_value_id)
  then
    return pg_catalog.jsonb_build_object(
      'order',
      pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'file_status_id', v_order.file_status_id,
        'quote_status_id', v_order.quote_status_id,
        'payment_status_id', v_order.payment_status_id,
        'delivery_method_id', v_order.delivery_method_id
      ),
      'field', p_field,
      'value',
        case
          when p_value_id is null then 'null'::jsonb
          else pg_catalog.jsonb_build_object(
            'id', p_value_id,
            'code', v_value_code,
            'name', v_value_name
          )
        end
    )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
  end if;

  -- -------------------------------------------------------
  -- Actualizar únicamente el campo solicitado.
  -- Sin SQL dinámico.
  -- -------------------------------------------------------

  perform pg_catalog.set_config('app.order_write', 'validated', true);
  update public.orders
  set
    file_status_id = case
      when p_field = 'file_status_id'
        then p_value_id
      else file_status_id
    end,

    quote_status_id = case
      when p_field = 'quote_status_id'
        then p_value_id
      else quote_status_id
    end,

    payment_status_id = case
      when p_field = 'payment_status_id'
        then p_value_id
      else payment_status_id
    end,

    delivery_method_id = case
      when p_field = 'delivery_method_id'
        then p_value_id
      else delivery_method_id
    end

  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_updated;

  if not found then
    raise exception 'could not update order management'
      using errcode = 'P0001';
  end if;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  perform pg_catalog.set_config('app.order_write', '', true);

  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'file_status_id', v_updated.file_status_id,
      'quote_status_id', v_updated.quote_status_id,
      'payment_status_id', v_updated.payment_status_id,
      'delivery_method_id', v_updated.delivery_method_id
    ),
    'field', p_field,
    'value',
      case
        when p_value_id is null then 'null'::jsonb
        else pg_catalog.jsonb_build_object(
          'id', p_value_id,
          'code', v_value_code,
          'name', v_value_name
        )
      end
  )
    || pg_catalog.jsonb_build_object(
      'version', v_updated.row_version::text
    );
end;
$function$;

-- ---------------------------------------------------------------------------
-- change_order_notification_status_v2
-- Body verbatim from 20260918140000_order_concurrency_v1.sql:1077; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_notification_status_v2 (
  p_order_id            uuid,
  p_notification_status text,
  p_tenant_id           uuid,
  p_expected_version    bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_notification_status is null
     or p_tenant_id is null then
    raise exception
      'p_order_id, p_notification_status and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_notification_status not in (
    'not_notified',
    'notified',
    'notified_no_pickup'
  ) then
    raise exception 'invalid customer notification status'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- Archived orders are read-only (Order Editing V1 · E1).
  -- Same semantics as change_order_status: reject before any mutation,
  -- including idempotent no-op paths.
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;


  if p_expected_version is null then
    raise exception 'p_expected_version is required'
      using errcode = '22023';
  end if;

  if v_order.row_version is distinct from p_expected_version then
    raise exception 'order has been modified since last read'
      using errcode = 'GCO01';
  end if;

  -- Mismo valor: operación idempotente, sin UPDATE ni activity_log.
  if v_order.customer_notification_status
       is not distinct from p_notification_status then
    return pg_catalog.jsonb_build_object(
      'order',
      pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'customer_notification_status',
          v_order.customer_notification_status,
        'customer_notified_at',
          v_order.customer_notified_at,
        'customer_notified_by',
          v_order.customer_notified_by
      )
    )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
  end if;

  perform pg_catalog.set_config('app.order_write', 'validated', true);
  update public.orders
  set
    customer_notification_status = p_notification_status,

    customer_notified_at = case
      when p_notification_status = 'not_notified'
        then null

      -- Primera notificación real.
      when v_order.customer_notified_at is null
        then v_now

      -- Si ya estaba avisado, conservamos cuándo se avisó.
      else v_order.customer_notified_at
    end,

    customer_notified_by = case
      when p_notification_status = 'not_notified'
        then null

      -- Primera notificación real.
      when v_order.customer_notified_by is null
        then v_user_id

      -- Pasar Avisado -> Avisado pero no viene no cambia
      -- quién realizó originalmente el aviso.
      else v_order.customer_notified_by
    end

  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_updated;

  if not found then
    raise exception 'could not update order'
      using errcode = 'P0001';
  end if;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  perform pg_catalog.set_config('app.order_write', '', true);

  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'customer_notification_status',
        v_updated.customer_notification_status,
      'customer_notified_at',
        v_updated.customer_notified_at,
      'customer_notified_by',
        v_updated.customer_notified_by
    )
  )
    || pg_catalog.jsonb_build_object(
      'version', v_updated.row_version::text
    );
end;
$function$;

-- ---------------------------------------------------------------------------
-- assign_order_client_v2
-- Body verbatim from 20260918140000_order_concurrency_v1.sql:1233; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_order_client_v2 (
  p_order_id  uuid,
  p_client_id uuid,
  p_tenant_id uuid,
  p_expected_version bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();

  v_order public.orders%rowtype;
  v_client_json jsonb := null;

begin

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ----------------------------------------------------------
  -- Argumentos obligatorios
  -- ----------------------------------------------------------

  if p_order_id is null
     or p_tenant_id is null then
    raise exception 'p_order_id and p_tenant_id are required'
      using errcode = '22023';
  end if;


  -- ----------------------------------------------------------
  -- Rol operativo dentro del tenant
  -- ----------------------------------------------------------

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ----------------------------------------------------------
  -- Pedido tenant-aware + bloqueo
  -- ----------------------------------------------------------

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;


  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- Archived orders are read-only (Order Editing V1 · E1).
  -- Same semantics as change_order_status: reject before any mutation,
  -- including idempotent no-op paths.
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;


  if p_expected_version is null then
    raise exception 'p_expected_version is required'
      using errcode = '22023';
  end if;

  if v_order.row_version is distinct from p_expected_version then
    raise exception 'order has been modified since last read'
      using errcode = 'GCO01';
  end if;


  -- ----------------------------------------------------------
  -- Cliente tenant-aware
  --
  -- NULL está permitido.
  -- Si hay cliente, debe existir, pertenecer al tenant
  -- y estar activo.
  -- ----------------------------------------------------------

  if p_client_id is not null then

    select pg_catalog.jsonb_build_object(
      'id', c.id,
      'customer_type_id', c.customer_type_id,
      'customer_type_name', ct.name,
      'name', c.name,
      'contact_name', c.contact_name,
      'company_name', c.company_name,
      'tax_id', c.tax_id,
      'email', c.email,
      'phone', c.phone,
      'notes', c.notes
    )
    into v_client_json

    from public.clients c

    left join public.customer_types ct
      on ct.id = c.customer_type_id
     and ct.tenant_id = c.tenant_id

    where c.id = p_client_id
      and c.tenant_id = p_tenant_id
      and c.active = true;


    if not found then
      raise exception 'client not found'
        using errcode = 'P0002';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- Idempotencia
  --
  -- Si ya tiene ese mismo cliente, no hacemos UPDATE.
  -- Evita escrituras/auditoría innecesarias.
  -- ----------------------------------------------------------

  if v_order.client_id is not distinct from p_client_id then

    return pg_catalog.jsonb_build_object(

      'order',

      pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'client_id', v_order.client_id
      ),

      'client',
      v_client_json

    )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );

  end if;


  -- ----------------------------------------------------------
  -- Asignar / cambiar / quitar
  -- ----------------------------------------------------------

  perform pg_catalog.set_config('app.order_write', 'validated', true);
  update public.orders
  set client_id = p_client_id

  where id = p_order_id
    and tenant_id = p_tenant_id

  returning *
  into v_order;


  if not found then
    raise exception 'could not update order client'
      using errcode = 'P0001';
  end if;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  perform pg_catalog.set_config('app.order_write', '', true);


  -- ----------------------------------------------------------
  -- Respuesta
  -- ----------------------------------------------------------

  return pg_catalog.jsonb_build_object(

    'order',

    pg_catalog.jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'client_id', v_order.client_id
    ),

    'client',
    v_client_json

  )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );

end;
$function$;

-- ---------------------------------------------------------------------------
-- create_client_and_assign_order_v2
-- Body verbatim from 20260918140000_order_concurrency_v1.sql:1441; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_client_and_assign_order_v2 (
  p_order_id         uuid,
  p_customer_type_id uuid,
  p_name             text,
  p_contact_name     text,
  p_company_name     text,
  p_tax_id           text,
  p_email            text,
  p_phone            text,
  p_notes            text,
  p_tenant_id        uuid,
  p_expected_version bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();

  v_order public.orders%rowtype;
  v_client public.clients%rowtype;
  v_duplicate public.clients%rowtype;

  v_name text;
  v_contact_name text;
  v_company_name text;
  v_tax_id text;
  v_email text;
  v_phone text;
  v_notes text;

  v_email_normalized text;
  v_phone_normalized text;
  v_tax_id_normalized text;

  v_email_match boolean;
  v_phone_match boolean;
  v_tax_id_match boolean;

begin

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ----------------------------------------------------------
  -- Parámetros obligatorios
  -- ----------------------------------------------------------

  if p_order_id is null
     or p_tenant_id is null then
    raise exception 'p_order_id and p_tenant_id are required'
      using errcode = '22023';
  end if;


  -- ----------------------------------------------------------
  -- Rol operativo dentro del tenant
  -- ----------------------------------------------------------

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ----------------------------------------------------------
  -- Normalización básica de entrada
  -- ----------------------------------------------------------

  v_name := nullif(pg_catalog.btrim(p_name), '');

  if v_name is null then
    raise exception 'client name cannot be empty'
      using errcode = '22023';
  end if;


  v_contact_name := nullif(pg_catalog.btrim(p_contact_name), '');
  v_company_name := nullif(pg_catalog.btrim(p_company_name), '');
  v_tax_id := nullif(pg_catalog.btrim(p_tax_id), '');
  v_email := nullif(pg_catalog.btrim(p_email), '');
  v_phone := nullif(pg_catalog.btrim(p_phone), '');
  v_notes := nullif(pg_catalog.btrim(p_notes), '');


  -- ----------------------------------------------------------
  -- Valores fuertes normalizados
  -- ----------------------------------------------------------

  v_email_normalized :=
    public.normalize_client_email(v_email);

  v_phone_normalized :=
    public.normalize_client_phone(v_phone);

  v_tax_id_normalized :=
    public.normalize_client_tax_id(v_tax_id);


  -- ----------------------------------------------------------
  -- Customer type tenant-aware
  -- ----------------------------------------------------------

  if p_customer_type_id is not null then

    perform 1
    from public.customer_types
    where id = p_customer_type_id
      and tenant_id = p_tenant_id
      and active = true;

    if not found then
      raise exception 'invalid customer type for current tenant'
        using errcode = '22023';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- Pedido:
  -- bloquearlo antes de crear/asignar cliente.
  -- ----------------------------------------------------------

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;


  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- Archived orders are read-only (Order Editing V1 · E1).
  -- Same semantics as change_order_status: reject before any mutation,
  -- including idempotent no-op paths.
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;


  if p_expected_version is null then
    raise exception 'p_expected_version is required'
      using errcode = '22023';
  end if;

  if v_order.row_version is distinct from p_expected_version then
    raise exception 'order has been modified since last read'
      using errcode = 'GCO01';
  end if;


  -- ----------------------------------------------------------
  -- DUPLICADOS FUERTES
  --
  -- Email
  -- Teléfono
  -- NIF/CIF
  --
  -- Solo dentro del tenant.
  -- ----------------------------------------------------------

  select *
  into v_duplicate
  from public.clients c
  where c.tenant_id = p_tenant_id

    and (

      (
        v_email_normalized is not null
        and public.normalize_client_email(c.email)
          = v_email_normalized
      )

      or

      (
        v_phone_normalized is not null
        and public.normalize_client_phone(c.phone)
          = v_phone_normalized
      )

      or

      (
        v_tax_id_normalized is not null
        and public.normalize_client_tax_id(c.tax_id)
          = v_tax_id_normalized
      )

    )

  order by c.created_at
  limit 1;


  if found then

    v_email_match :=
      v_email_normalized is not null
      and public.normalize_client_email(v_duplicate.email)
        = v_email_normalized;

    v_phone_match :=
      v_phone_normalized is not null
      and public.normalize_client_phone(v_duplicate.phone)
        = v_phone_normalized;

    v_tax_id_match :=
      v_tax_id_normalized is not null
      and public.normalize_client_tax_id(v_duplicate.tax_id)
        = v_tax_id_normalized;


    raise exception 'client_duplicate'
      using
        errcode = '23505',

        detail = pg_catalog.jsonb_build_object(
          'client_id', v_duplicate.id,
          'client_name', v_duplicate.name,
          'email', v_duplicate.email,
          'phone', v_duplicate.phone,
          'tax_id', v_duplicate.tax_id,
          'email_match', v_email_match,
          'phone_match', v_phone_match,
          'tax_id_match', v_tax_id_match
        )::text,

        hint = 'Use the existing client instead of creating a duplicate';

  end if;


  -- ----------------------------------------------------------
  -- Crear cliente
  -- ----------------------------------------------------------

  begin

    insert into public.clients (
      tenant_id,
      customer_type_id,
      name,
      contact_name,
      company_name,
      tax_id,
      email,
      phone,
      notes,
      active,
      created_by
    )
    values (
      p_tenant_id,
      p_customer_type_id,
      v_name,
      v_contact_name,
      v_company_name,
      v_tax_id,
      v_email,
      v_phone,
      v_notes,
      true,
      v_user_id
    )
    returning *
    into v_client;


  exception
    when unique_violation then

      -- Protección adicional frente a condición de carrera.
      raise exception 'client_duplicate'
        using
          errcode = '23505',
          hint =
            'A client with the same email, phone or tax ID already exists';

  end;


  -- ----------------------------------------------------------
  -- Asignarlo al pedido
  -- ----------------------------------------------------------

  perform pg_catalog.set_config('app.order_write', 'validated', true);
  update public.orders
  set client_id = v_client.id
  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_order;


  if not found then
    raise exception 'could not assign client to order'
      using errcode = 'P0001';
  end if;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  perform pg_catalog.set_config('app.order_write', '', true);


  -- ----------------------------------------------------------
  -- Respuesta existente:
  -- NO cambiamos contrato con Next.
  -- ----------------------------------------------------------

  return pg_catalog.jsonb_build_object(

    'order',

    pg_catalog.jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'client_id', v_client.id
    ),

    'client',

    pg_catalog.to_jsonb(v_client)
      - 'metadata'
      - 'created_by'

  )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );

end;
$function$;

-- ---------------------------------------------------------------------------
-- change_order_status_v2
-- Body verbatim from 20260918140000_order_concurrency_v1.sql:1788; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_status_v2 (
  p_order_id  uuid,
  p_status_id uuid,
  p_tenant_id uuid,
  p_expected_version bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_order public.orders%rowtype;
  v_new_status public.order_statuses%rowtype;
  v_updated public.orders%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF p_order_id IS NULL OR p_status_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id, p_status_id and p_tenant_id are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_tenant_role(
    p_tenant_id,
    ARRAY['owner', 'admin', 'manager', 'staff']::text[]
  ) THEN
    RAISE EXCEPTION 'tenant access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_order.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'order is archived'
      USING ERRCODE = '42501';
  END IF;


  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'p_expected_version is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_order.row_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'order has been modified since last read'
      USING ERRCODE = 'GCO01';
  END IF;

  SELECT *
  INTO v_new_status
  FROM public.order_statuses
  WHERE id = p_status_id
    AND tenant_id = p_tenant_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid order status'
      USING ERRCODE = '22023';
  END IF;

  IF v_order.status_id IS NOT DISTINCT FROM v_new_status.id THEN
    RETURN pg_catalog.jsonb_build_object(
      'order', pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'status_id', v_order.status_id,
        'ready_at', v_order.ready_at,
        'delivered_at', v_order.delivered_at,
        'archived_at', v_order.archived_at
      ),
      'status', pg_catalog.jsonb_build_object(
        'id', v_new_status.id,
        'tenant_id', v_new_status.tenant_id,
        'code', v_new_status.code,
        'name', v_new_status.name,
        'is_ready', v_new_status.is_ready,
        'is_closed', v_new_status.is_closed,
        'is_cancelled', v_new_status.is_cancelled
      )
    )
    || pg_catalog.jsonb_build_object(
      'version', v_order.row_version::text
    );
  END IF;

  PERFORM pg_catalog.set_config('app.order_lifecycle', 'validated', true);

  PERFORM pg_catalog.set_config('app.order_write', 'validated', true);
  UPDATE public.orders
  SET
    status_id = v_new_status.id,
    updated_at = v_now,
    ready_at = CASE
      WHEN v_new_status.is_ready IS TRUE AND ready_at IS NULL THEN v_now
      ELSE ready_at
    END,
    delivered_at = CASE
      WHEN v_new_status.is_closed IS TRUE
        AND v_new_status.is_cancelled IS NOT TRUE
        AND delivered_at IS NULL THEN v_now
      ELSE delivered_at
    END
  WHERE id = v_order.id
    AND tenant_id = p_tenant_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not update order'
      USING ERRCODE = 'P0001';
  END IF;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  PERFORM pg_catalog.set_config('app.order_write', '', true);

  RETURN pg_catalog.jsonb_build_object(
    'order', pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'status_id', v_updated.status_id,
      'ready_at', v_updated.ready_at,
      'delivered_at', v_updated.delivered_at,
      'archived_at', v_updated.archived_at
    ),
    'status', pg_catalog.jsonb_build_object(
      'id', v_new_status.id,
      'tenant_id', v_new_status.tenant_id,
      'code', v_new_status.code,
      'name', v_new_status.name,
      'is_ready', v_new_status.is_ready,
      'is_closed', v_new_status.is_closed,
      'is_cancelled', v_new_status.is_cancelled
    )
  )
    || pg_catalog.jsonb_build_object(
      'version', v_updated.row_version::text
    );
END;
$function$;

-- ---------------------------------------------------------------------------
-- archive_order
-- Body verbatim from 20260917180000_order_lifecycle_v1.sql:200; only the app.order_write lines are new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_order (
  p_order_id  uuid,
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_order public.orders%rowtype;
  v_status public.order_statuses%rowtype;
  v_updated public.orders%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF p_order_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id and p_tenant_id are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_tenant_role(
    p_tenant_id,
    ARRAY['owner', 'admin', 'manager', 'staff']::text[]
  ) THEN
    RAISE EXCEPTION 'tenant access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_status
  FROM public.order_statuses
  WHERE id = v_order.status_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid order status'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotent: already archived → return current row, no write.
  IF v_order.archived_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'order', pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'status_id', v_order.status_id,
        'archived_at', v_order.archived_at
      ),
      'replay', true
    );
  END IF;

  IF v_status.is_closed IS NOT TRUE AND v_status.is_cancelled IS NOT TRUE THEN
    RAISE EXCEPTION 'order is not terminal'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.set_config('app.order_lifecycle', 'validated', true);

  PERFORM pg_catalog.set_config('app.order_write', 'validated', true);
  UPDATE public.orders
  SET
    archived_at = v_now,
    updated_at = v_now
  WHERE id = v_order.id
    AND tenant_id = p_tenant_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not archive order'
      USING ERRCODE = 'P0001';
  END IF;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  PERFORM pg_catalog.set_config('app.order_write', '', true);

  RETURN pg_catalog.jsonb_build_object(
    'order', pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'status_id', v_updated.status_id,
      'archived_at', v_updated.archived_at
    ),
    'replay', false
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Direct INSERT limited to what POST /api/orders writes (+ id)
-- ---------------------------------------------------------------------------
revoke insert on table public.orders from authenticated;
grant insert (
  id,
  tenant_id,
  title,
  description,
  client_id,
  service_id,
  assigned_team_member_id,
  status_id,
  entry_channel_id,
  order_context_id,
  store_id,
  priority,
  due_at,
  notes,
  file_status_id,
  created_by
) on table public.orders to authenticated;

commit;
