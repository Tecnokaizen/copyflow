-- A1: admit external_folder_url on change_order_content_v2 + activity.
-- Preserves concurrency, archived immutability, tenant checks, grants.

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

REVOKE ALL ON FUNCTION public.change_order_content_v2(uuid, text, text, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_order_content_v2(uuid, text, text, uuid, bigint) TO authenticated, postgres;

-- Activity for external_folder_url (same action/metadata pattern as other content fields).
CREATE OR REPLACE FUNCTION public.tg_activity_log_order_content()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with order content'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if old.title is distinct from new.title then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.title),
      pg_catalog.jsonb_build_object('value', new.title),
      pg_catalog.jsonb_build_object('reference', new.reference, 'field', 'title')
    );
  end if;

  if old.description is distinct from new.description then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.description),
      pg_catalog.jsonb_build_object('value', new.description),
      pg_catalog.jsonb_build_object('reference', new.reference, 'field', 'description')
    );
  end if;

  if old.notes is distinct from new.notes then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.notes),
      pg_catalog.jsonb_build_object('value', new.notes),
      pg_catalog.jsonb_build_object('reference', new.reference, 'field', 'notes')
    );
  end if;

  if old.external_folder_url is distinct from new.external_folder_url then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.external_folder_url),
      pg_catalog.jsonb_build_object('value', new.external_folder_url),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'external_folder_url'
      )
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_orders_activity_log_content ON public.orders;

CREATE TRIGGER trg_orders_activity_log_content
  AFTER UPDATE OF title, description, notes, external_folder_url ON public.orders
  FOR EACH ROW
  WHEN (
    (old.title IS DISTINCT FROM new.title)
    OR (old.description IS DISTINCT FROM new.description)
    OR (old.notes IS DISTINCT FROM new.notes)
    OR (old.external_folder_url IS DISTINCT FROM new.external_folder_url)
  )
  EXECUTE FUNCTION public.tg_activity_log_order_content();
