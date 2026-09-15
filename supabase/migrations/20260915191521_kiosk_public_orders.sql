-- Public Kiosk orders remain server-mediated. Anon receives no table grants.
-- The Kiosk channel is tenant configuration and can be disabled per tenant.

INSERT INTO public.entry_channels (
  tenant_id,
  name,
  code,
  active,
  sort_order
)
SELECT
  t.id,
  'Kiosk',
  'kiosk',
  true,
  COALESCE((
    SELECT MAX(ec.sort_order) + 1
    FROM public.entry_channels ec
    WHERE ec.tenant_id = t.id
  ), 1)
FROM public.tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_created()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := auth.role();
  v_is_kiosk boolean :=
    v_actor IS NULL
    AND v_role = 'service_role'
    AND new.created_by IS NULL
    AND new.metadata ->> 'source' = 'kiosk';
BEGIN
  IF tg_op <> 'INSERT' THEN
    RETURN new;
  END IF;

  IF v_actor IS NULL AND NOT v_is_kiosk THEN
    RAISE EXCEPTION 'not authenticated'
      USING errcode = '28000';
  END IF;

  IF NOT v_is_kiosk
     AND NOT public.has_tenant_role(
       new.tenant_id,
       ARRAY['owner', 'admin', 'manager', 'staff']::text[]
     ) THEN
    RAISE EXCEPTION 'tenant access denied'
      USING errcode = '42501';
  END IF;

  INSERT INTO public.activity_log (
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
  VALUES (
    new.tenant_id,
    v_actor,
    NULL,
    'order.created',
    'order',
    new.id,
    NULL,
    pg_catalog.jsonb_build_object(
      'title', new.title,
      'status_id', new.status_id,
      'priority', new.priority,
      'client_id', new.client_id,
      'service_id', new.service_id,
      'assigned_team_member_id', new.assigned_team_member_id,
      'entry_channel_id', new.entry_channel_id,
      'order_context_id', new.order_context_id,
      'due_at', new.due_at
    ),
    pg_catalog.jsonb_build_object(
      'reference', new.reference,
      'source', CASE WHEN v_is_kiosk THEN 'kiosk' ELSE 'internal' END
    )
  );

  RETURN new;
END;
$function$;

COMMENT ON FUNCTION public.tg_activity_log_order_created() IS
  'Audits internal orders with their auth actor and server-mediated Kiosk orders with a null actor. Kiosk requires service_role, created_by null and metadata.source=kiosk.';

REVOKE ALL ON FUNCTION public.tg_activity_log_order_created() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_activity_log_order_created() FROM anon;
REVOKE ALL ON FUNCTION public.tg_activity_log_order_created() FROM authenticated;
REVOKE ALL ON FUNCTION public.tg_activity_log_order_created() FROM service_role;
GRANT EXECUTE ON FUNCTION public.tg_activity_log_order_created() TO postgres;
