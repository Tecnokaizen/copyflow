CREATE OR REPLACE FUNCTION public.list_order_activity (
  p_order_id uuid
)
  RETURNS TABLE (
    id              uuid,
    action          text,
    entity_type     text,
    entity_id       uuid,
    user_id         uuid,
    team_member_id  uuid,
    previous_values jsonb,
    new_values      jsonb,
    metadata        jsonb,
    created_at      timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null then
    raise exception 'not found'
      using errcode = 'P0002';
  end if;

  select o.tenant_id
    into v_tenant_id
  from public.orders o
  where o.id = p_order_id
    and public.is_tenant_member(o.tenant_id);

  if v_tenant_id is null then
    raise exception 'not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    al.id,
    al.action,
    al.entity_type,
    al.entity_id,
    al.user_id,
    al.team_member_id,
    al.previous_values,
    al.new_values,
    al.metadata,
    al.created_at
  from public.activity_log al
  where al.tenant_id = v_tenant_id
    and al.entity_type = 'order'
    and al.entity_id = p_order_id
  order by al.created_at asc;
end;
$function$;

COMMENT ON FUNCTION public.list_order_activity(uuid) IS
  'DEFINER acotado: historial de un pedido. Actor = auth.uid(). Tenant derivado de orders.id. No aceptar tenant_id del cliente.';

REVOKE ALL ON FUNCTION "public"."list_order_activity"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_order_activity"(uuid) FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."list_order_activity"(uuid)
  TO "authenticated";
