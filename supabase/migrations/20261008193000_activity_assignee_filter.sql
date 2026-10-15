-- Virtual filter for assignee changes.
-- Stored rows stay order.details_changed with metadata.field =
-- assigned_team_member_id. list_activity_log paginates before the
-- client can see that field, so the exclusive filter has to live here.
-- Historical rows are not rewritten. Rows without that field stay in
-- Cambio de detalles because they cannot be identified as assignee changes.

CREATE OR REPLACE FUNCTION public.list_activity_log (
  p_tenant_id   uuid,
  p_entity_type text                     DEFAULT NULL::text,
  p_action      text                     DEFAULT NULL::text,
  p_user_id     uuid                     DEFAULT NULL::uuid,
  p_from        timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_to          timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_page        integer                  DEFAULT 1,
  p_page_size   integer                  DEFAULT 25
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_page integer;
  v_page_size integer;
  v_offset integer;

  v_entity_type text;
  v_action text;

  v_result jsonb;
begin

  -- ==========================================================
  -- AUTH
  -- ==========================================================

  if auth.uid() is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- PERMISOS
  --
  -- Registro de actividad = supervisión.
  -- owner / admin / manager.
  -- ==========================================================

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner','admin','manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ==========================================================
  -- PAGINACIÓN
  -- ==========================================================

  v_page :=
    greatest(
      coalesce(p_page, 1),
      1
    );

  v_page_size :=
    least(
      greatest(
        coalesce(p_page_size, 25),
        1
      ),
      100
    );

  v_offset :=
    (v_page - 1) * v_page_size;


  -- ==========================================================
  -- FILTROS
  -- ==========================================================

  v_entity_type :=
    nullif(
      pg_catalog.btrim(p_entity_type),
      ''
    );

  v_action :=
    nullif(
      pg_catalog.btrim(p_action),
      ''
    );


  if p_from is not null
     and p_to is not null
     and p_from > p_to then
    raise exception 'invalid date range'
      using errcode = '22023';
  end if;


  -- ==========================================================
  -- CONSULTA
  -- ==========================================================

  with filtered as materialized (

    select
      al.id,
      al.created_at,

      al.user_id,
      al.team_member_id,

      al.action,
      al.entity_type,
      al.entity_id,

      al.previous_values,
      al.new_values,
      al.metadata

    from public.activity_log al

    where al.tenant_id = p_tenant_id

      and (
        v_entity_type is null
        or al.entity_type = v_entity_type
      )

      and (
        v_action is null
        or (
          v_action = 'order.assignee_changed'
          and al.action = 'order.details_changed'
          and al.metadata ->> 'field' = 'assigned_team_member_id'
        )
        or (
          v_action = 'order.details_changed'
          and al.action = 'order.details_changed'
          and coalesce(al.metadata ->> 'field', ''::text)
              is distinct from 'assigned_team_member_id'
        )
        or (
          v_action is distinct from 'order.assignee_changed'
          and v_action is distinct from 'order.details_changed'
          and al.action = v_action
        )
      )

      and (
        p_user_id is null
        or al.user_id = p_user_id
      )

      and (
        p_from is null
        or al.created_at >= p_from
      )

      and (
        p_to is null
        or al.created_at <= p_to
      )
  ),

  counted as (

    select
      pg_catalog.count(*) as total

    from filtered
  ),

  paged as (

    select *
    from filtered

    order by
      created_at desc,
      id desc

    limit v_page_size
    offset v_offset
  ),

  enriched as (

    select
      p.id,
      p.created_at,

      p.user_id,
      p.team_member_id,

      case
        when p.team_member_id is not null
          then 'team_member'

        when p.user_id is not null
          then 'user'

        else 'system'
      end as actor_type,

      case
        when p.team_member_id is not null
          then coalesce(
            nullif(pg_catalog.btrim(tm.name), ''),
            'Miembro del equipo'
          )

        when p.user_id is not null
          then coalesce(
            nullif(pg_catalog.btrim(pr.full_name), ''),
            'Usuario'
          )

        else 'Sistema'
      end as actor_name,

      p.action,
      p.entity_type,
      p.entity_id,

      case
        when p.entity_type = 'order'
          then coalesce(
            nullif(p.metadata ->> 'reference', ''),
            'Pedido'
          )

        when p.entity_type = 'client'
          then coalesce(
            nullif(p.metadata ->> 'client_name', ''),
            'Cliente'
          )

        when p.entity_type = 'quote'
          then coalesce(
            nullif(p.metadata ->> 'reference', ''),
            'Presupuesto'
          )

        else p.entity_type
      end as entity_label,

      nullif(
        p.metadata ->> 'field',
        ''
      ) as changed_field,

      p.previous_values,
      p.new_values,
      p.metadata

    from paged p

    left join public.profiles pr
      on pr.id = p.user_id

    left join public.team_members tm
      on tm.id = p.team_member_id
     and tm.tenant_id = p_tenant_id
  ),

  event_json as (

    select
      coalesce(

        pg_catalog.jsonb_agg(

          pg_catalog.jsonb_build_object(

            'id',
              e.id,

            'created_at',
              e.created_at,

            'actor_type',
              e.actor_type,

            'actor_name',
              e.actor_name,

            'user_id',
              e.user_id,

            'team_member_id',
              e.team_member_id,

            'action',
              e.action,

            'entity_type',
              e.entity_type,

            'entity_id',
              e.entity_id,

            'entity_label',
              e.entity_label,

            'changed_field',
              e.changed_field,

            'previous_values',
              e.previous_values,

            'new_values',
              e.new_values,

            'metadata',
              e.metadata

          )

          order by
            e.created_at desc,
            e.id desc

        ),

        '[]'::jsonb

      ) as events

    from enriched e
  )

  select
    pg_catalog.jsonb_build_object(

      'events',
        ej.events,

      'total',
        c.total,

      'page',
        v_page,

      'page_size',
        v_page_size,

      'total_pages',
        case
          when c.total = 0
            then 0
          else
            (
              (
                c.total + v_page_size - 1
              ) / v_page_size
            )
        end,

      'has_more',
        (
          v_page * v_page_size < c.total
        )

    )

  into v_result

  from counted c
  cross join event_json ej;


  return v_result;

end;
$function$;
