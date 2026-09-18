-- Order Editing V1 · E1 — Archived immutability
--
-- "archived_at IS NOT NULL" becomes the read-only boundary in the database,
-- not only in the browser.
--
-- tg_orders_lifecycle_guard (20260917180000) only watches
-- status_id / ready_at / delivered_at / archived_at, so every other editing
-- RPC could still write to an archived order. This migration adds the same
-- archived rejection that change_order_status already performs to the six
-- editing RPCs that mutate public.orders.
--
-- Semantics, identical to change_order_status:
--   message  'order is archived'
--   SQLSTATE '42501'
--   checked right after the order row is locked FOR UPDATE, before any
--   mutation and before idempotent no-op paths.
--
-- Product decision (E1): a terminal (closed/cancelled) order that is NOT
-- archived stays fully editable, on purpose, to allow later administrative
-- corrections. No generic terminal lock is introduced here.
--
-- Signatures and payloads are unchanged. Bodies are reproduced verbatim from
-- 20260907171432_remote_schema.sql (and 20260914163515 for
-- change_order_details) with only the guard block added.
--
-- Not touched: change_order_status, archive_order, Kiosk objects,
-- tg_activity_log_order_created, app.order_lifecycle, app.kiosk_submission.

begin;

-- ---------------------------------------------------------------------------
-- change_order_content
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_content (
  p_order_id  uuid,
  p_field     text,
  p_value     text,
  p_tenant_id uuid
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
    'notes'
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
  -- Same semantics as change_order_status: reject before any mutation,
  -- including idempotent no-op paths.
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;


  -- =======================================================
  -- TÍTULO
  -- Obligatorio y no vacío.
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
          'notes', v_order.notes
        ),
        'field', p_field,
        'value', v_order.title
      );
    end if;

    update public.orders
    set title = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- DESCRIPCIÓN
  -- Vacío => NULL
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
          'notes', v_order.notes
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_order.description)
      );
    end if;

    update public.orders
    set description = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- NOTAS
  -- Vacío => NULL
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
          'notes', v_order.notes
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_order.notes)
      );
    end if;

    update public.orders
    set notes = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;

  end if;


  if not found then
    raise exception 'could not update order content'
      using errcode = 'P0001';
  end if;


  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'title', v_updated.title,
      'description', v_updated.description,
      'notes', v_updated.notes
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
        else 'null'::jsonb
      end
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- change_order_details
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_details (
  p_order_id  uuid,
  p_field     text,
  p_value     text,
  p_tenant_id uuid
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
      );
    end if;

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
      );
    end if;

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
      );
    end if;

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
      );
    end if;

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
      );
    end if;

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
      );
    end if;

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
      );
    end if;

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
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- change_order_management
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_management (
  p_order_id  uuid,
  p_field     text,
  p_value_id  uuid,
  p_tenant_id uuid
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
    );
  end if;

  -- -------------------------------------------------------
  -- Actualizar únicamente el campo solicitado.
  -- Sin SQL dinámico.
  -- -------------------------------------------------------

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
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- change_order_notification_status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_notification_status (
  p_order_id            uuid,
  p_notification_status text,
  p_tenant_id           uuid
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
    );
  end if;

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
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- assign_order_client
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_order_client (
  p_order_id  uuid,
  p_client_id uuid,
  p_tenant_id uuid
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

    );

  end if;


  -- ----------------------------------------------------------
  -- Asignar / cambiar / quitar
  -- ----------------------------------------------------------

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

  );

end;
$function$;

-- ---------------------------------------------------------------------------
-- create_client_and_assign_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_client_and_assign_order (
  p_order_id         uuid,
  p_customer_type_id uuid,
  p_name             text,
  p_contact_name     text,
  p_company_name     text,
  p_tax_id           text,
  p_email            text,
  p_phone            text,
  p_notes            text,
  p_tenant_id        uuid
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

  update public.orders
  set client_id = v_client.id
  where id = v_order.id
    and tenant_id = p_tenant_id;


  if not found then
    raise exception 'could not assign client to order'
      using errcode = 'P0001';
  end if;


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

  );

end;
$function$;

-- ---------------------------------------------------------------------------
-- Contract documentation
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.change_order_content(uuid, text, text, uuid) IS
  'INVOKER. Rejects archived orders (order is archived / 42501) before any mutation. p_tenant_id only from getCurrentContext().';

COMMENT ON FUNCTION public.change_order_details(uuid, text, text, uuid) IS
  'INVOKER. Rejects archived orders (order is archived / 42501) before any mutation. p_tenant_id only from getCurrentContext().';

COMMENT ON FUNCTION public.change_order_management(uuid, text, uuid, uuid) IS
  'INVOKER. Rejects archived orders (order is archived / 42501) before any mutation. p_tenant_id only from getCurrentContext().';

COMMENT ON FUNCTION public.change_order_notification_status(uuid, text, uuid) IS
  'INVOKER. Rejects archived orders (order is archived / 42501) before any mutation. p_tenant_id only from getCurrentContext().';

COMMENT ON FUNCTION public.assign_order_client(uuid, uuid, uuid) IS
  'INVOKER. Rejects archived orders (order is archived / 42501) before any mutation. p_tenant_id only from getCurrentContext().';

COMMENT ON FUNCTION public.create_client_and_assign_order(uuid, uuid, text, text, text, text, text, text, text, uuid) IS
  'INVOKER. Locks the order and rejects archived orders (order is archived / 42501) before creating the client. p_tenant_id only from getCurrentContext().';

commit;
