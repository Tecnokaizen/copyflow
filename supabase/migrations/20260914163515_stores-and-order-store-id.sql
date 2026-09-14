-- Multi-tienda mínima: catálogo stores tenant-aware y orders.store_id.
-- No reutiliza order_contexts. No asigna tienda a pedidos existentes.

CREATE TABLE public.stores (
  id         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  tenant_id  uuid                     NOT NULL,
  name       text                     NOT NULL,
  code       text                     NULL,
  active     boolean                  NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stores_pkey PRIMARY KEY (id),
  CONSTRAINT stores_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT stores_tenant_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT stores_name_not_blank CHECK (length(btrim(name)) > 0)
);

ALTER TABLE public.stores
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE INDEX stores_tenant_active_idx
  ON public.stores USING btree (tenant_id, active);

CREATE TRIGGER stores_set_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY stores_select_member ON public.stores
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY stores_insert_management ON public.stores
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY stores_update_management ON public.stores
  FOR UPDATE
  TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

COMMENT ON TABLE public.stores IS
  'Tiendas/sedes operativas del tenant. No eliminar físicamente si hay pedidos: desactivar (active=false).';

-- Los default privileges del proyecto conceden MAINTAIN/REFERENCES/TRIGGER/TRUNCATE
-- a authenticated en tablas nuevas. TRUNCATE no está protegido por RLS.
-- La app solo necesita DML; las políticas RLS siguen filtrando filas.
REVOKE ALL ON TABLE public.stores FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stores TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stores TO postgres, service_role;

ALTER TABLE public.orders
  ADD COLUMN store_id uuid;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_store_fk
  FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores(tenant_id, id);

CREATE INDEX orders_tenant_store_idx
  ON public.orders USING btree (tenant_id, store_id)
  WHERE archived_at IS NULL;

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

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_details()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();

  v_old_code text;
  v_old_name text;
  v_new_code text;
  v_new_name text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with order details'
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


  -- PRIORIDAD
  if old.priority is distinct from new.priority then
    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.details_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'value', old.priority
      ),
      pg_catalog.jsonb_build_object(
        'value', new.priority
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'priority'
      )
    );
  end if;


  -- SERVICIO
  if old.service_id is distinct from new.service_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.service_id is not null then
      select null::text, name
      into v_old_code, v_old_name
      from public.services
      where tenant_id = new.tenant_id
        and id = old.service_id;
    end if;

    if new.service_id is not null then
      select null::text, name
      into v_new_code, v_new_name
      from public.services
      where tenant_id = new.tenant_id
        and id = new.service_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.service_id,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.service_id,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'service_id'
      )
    );
  end if;


  -- CANAL DE ENTRADA
  if old.entry_channel_id is distinct from new.entry_channel_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.entry_channel_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.entry_channels
      where tenant_id = new.tenant_id
        and id = old.entry_channel_id;
    end if;

    if new.entry_channel_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.entry_channels
      where tenant_id = new.tenant_id
        and id = new.entry_channel_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.entry_channel_id,
        'value_code', v_old_code,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.entry_channel_id,
        'value_code', v_new_code,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'entry_channel_id'
      )
    );
  end if;


  -- RESPONSABLE
  if old.assigned_team_member_id is distinct from new.assigned_team_member_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.assigned_team_member_id is not null then
      select null::text, name
      into v_old_code, v_old_name
      from public.team_members
      where tenant_id = new.tenant_id
        and id = old.assigned_team_member_id;
    end if;

    if new.assigned_team_member_id is not null then
      select null::text, name
      into v_new_code, v_new_name
      from public.team_members
      where tenant_id = new.tenant_id
        and id = new.assigned_team_member_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.assigned_team_member_id,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.assigned_team_member_id,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'assigned_team_member_id'
      )
    );
  end if;


  -- CONTEXTO
  if old.order_context_id is distinct from new.order_context_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.order_context_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.order_contexts
      where tenant_id = new.tenant_id
        and id = old.order_context_id;
    end if;

    if new.order_context_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.order_contexts
      where tenant_id = new.tenant_id
        and id = new.order_context_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.order_context_id,
        'value_code', v_old_code,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.order_context_id,
        'value_code', v_new_code,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'order_context_id'
      )
    );
  end if;



  -- TIENDA
  if old.store_id is distinct from new.store_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.store_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.stores
      where tenant_id = new.tenant_id
        and id = old.store_id;
    end if;

    if new.store_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.stores
      where tenant_id = new.tenant_id
        and id = new.store_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.store_id,
        'value_code', v_old_code,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.store_id,
        'value_code', v_new_code,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'store_id'
      )
    );
  end if;


  -- FECHA PREVISTA
  if old.due_at is distinct from new.due_at then
    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.details_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'value', old.due_at
      ),
      pg_catalog.jsonb_build_object(
        'value', new.due_at
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'due_at'
      )
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_orders_activity_log_details ON public.orders;

CREATE TRIGGER trg_orders_activity_log_details
  AFTER UPDATE OF priority, service_id, entry_channel_id, assigned_team_member_id, order_context_id, store_id, due_at
  ON public.orders
  FOR EACH ROW
  WHEN (
    (old.priority IS DISTINCT FROM new.priority)
    OR (old.service_id IS DISTINCT FROM new.service_id)
    OR (old.entry_channel_id IS DISTINCT FROM new.entry_channel_id)
    OR (old.assigned_team_member_id IS DISTINCT FROM new.assigned_team_member_id)
    OR (old.order_context_id IS DISTINCT FROM new.order_context_id)
    OR (old.store_id IS DISTINCT FROM new.store_id)
    OR (old.due_at IS DISTINCT FROM new.due_at)
  )
  EXECUTE FUNCTION public.tg_activity_log_order_details();

CREATE OR REPLACE FUNCTION public.create_organization (
  p_name     text,
  p_slug     text,
  p_timezone text DEFAULT 'Europe/Madrid'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_slug text;
  v_timezone text;
  v_full_name text;
  v_tenant public.tenants%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  if exists (
    select 1
    from public.memberships m
    where m.user_id = v_user_id
      and m.role = 'owner'
      and m.active = true
  ) then
    raise exception 'organization limit reached'
      using errcode = '54000';
  end if;

  v_name := nullif(pg_catalog.btrim(p_name), '');

  if v_name is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  v_slug := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  v_slug := pg_catalog.regexp_replace(v_slug, '\s+', '-', 'g');

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if v_slug in (
    'app',
    'www',
    'api',
    'admin',
    'auth',
    'dashboard',
    'demo'
  ) then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenants t
    where t.slug = v_slug
  ) then
    raise exception 'slug already exists'
      using errcode = '23505';
  end if;

  v_timezone := nullif(pg_catalog.btrim(coalesce(p_timezone, '')), '');
  if v_timezone is null then
    v_timezone := 'Europe/Madrid';
  end if;

  select
    nullif(
      pg_catalog.btrim(
        coalesce(
          u.raw_user_meta_data ->> 'full_name',
          u.raw_user_meta_data ->> 'name',
          pg_catalog.split_part(coalesce(u.email, ''), '@', 1)
        )
      ),
      ''
    )
  into v_full_name
  from auth.users u
  where u.id = v_user_id;

  insert into public.profiles (
    id,
    full_name
  )
  values (
    v_user_id,
    v_full_name
  )
  on conflict (id) do nothing;

  insert into public.tenants (
    name,
    slug,
    active
  )
  values (
    v_name,
    v_slug,
    true
  )
  returning * into v_tenant;

  insert into public.memberships (
    tenant_id,
    user_id,
    role,
    active
  )
  values (
    v_tenant.id,
    v_user_id,
    'owner',
    true
  );

  insert into public.tenant_settings (
    tenant_id,
    business_name,
    timezone,
    locale,
    currency
  )
  values (
    v_tenant.id,
    v_name,
    v_timezone,
    'es-ES',
    'EUR'
  );

  insert into public.order_statuses (
    tenant_id,
    name,
    code,
    is_initial,
    is_ready,
    is_closed,
    is_cancelled,
    active,
    sort_order
  )
  values
    (
      v_tenant.id,
      'Recibido',
      'received',
      true,
      false,
      false,
      false,
      true,
      1
    ),
    (
      v_tenant.id,
      'En proceso',
      'in_progress',
      false,
      false,
      false,
      false,
      true,
      2
    ),
    (
      v_tenant.id,
      'Listo',
      'ready',
      false,
      true,
      false,
      false,
      true,
      3
    ),
    (
      v_tenant.id,
      'Entregado',
      'closed',
      false,
      false,
      true,
      false,
      true,
      4
    ),
    (
      v_tenant.id,
      'Cancelado',
      'cancelled',
      false,
      false,
      false,
      true,
      true,
      5
    );

  insert into public.customer_types (
    tenant_id,
    name,
    active,
    sort_order
  )
  values
    (v_tenant.id, 'Particular', true, 1),
    (v_tenant.id, 'Empresa', true, 2);

  insert into public.entry_channels (
    tenant_id,
    name,
    code,
    active,
    sort_order
  )
  values
    (v_tenant.id, 'Mostrador', 'counter', true, 1),
    (v_tenant.id, 'Teléfono', 'phone', true, 2),
    (v_tenant.id, 'Email', 'email', true, 3),
    (v_tenant.id, 'Web', 'web', true, 4);

  insert into public.stores (
    tenant_id,
    name,
    active
  )
  values (
    v_tenant.id,
    'Principal',
    true
  );

  return pg_catalog.jsonb_build_object(
    'tenant_id',
      v_tenant.id,
    'slug',
      v_tenant.slug,
    'name',
      v_tenant.name
  );
end;
$function$;

COMMENT ON FUNCTION public.create_organization(text, text, text) IS
  'DEFINER acotado: crea tenant + membership owner + tenant_settings + seed mínimo (incluye tienda Principal). Actor = auth.uid(). No aceptar user_id ni tenant_id del cliente. MVP: como máximo una membership owner activa por usuario.';

REVOKE ALL ON FUNCTION "public"."create_organization"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."create_organization"(text, text, text) FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."create_organization"(text, text, text)
  TO "authenticated", "postgres";

-- Backfill SUR4: crear las dos tiendas reales. Pedidos existentes quedan con store_id NULL
-- porque no hay información fiable de sede. No se inventan tiendas para otros tenants.

INSERT INTO public.stores (tenant_id, name, active)
SELECT t.id, v.name, true
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('Sur 4 Colores 1'),
    ('Sur 4 Colores 2')
) AS v(name)
WHERE t.slug = 'sur4'
ON CONFLICT (tenant_id, name) DO NOTHING;
