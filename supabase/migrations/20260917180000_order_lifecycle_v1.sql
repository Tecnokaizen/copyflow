-- Order Lifecycle V1 — DB integrity
-- Controlled status/archive mutations via transaction-local GUC.
-- Does not modify Kiosk (app.kiosk_submission / tg_activity_log_order_created).

-- ---------------------------------------------------------------------------
-- 1) BEFORE UPDATE guard: lifecycle columns only with app.order_lifecycle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_orders_lifecycle_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  v_marker text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status_id IS NOT DISTINCT FROM OLD.status_id
     AND NEW.ready_at IS NOT DISTINCT FROM OLD.ready_at
     AND NEW.delivered_at IS NOT DISTINCT FROM OLD.delivered_at
     AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
    RETURN NEW;
  END IF;

  -- Technical exceptions for migrations/seeds only. No authenticated bypass.
  IF CURRENT_USER IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  v_marker := coalesce(
    pg_catalog.current_setting('app.order_lifecycle', true),
    ''
  );

  IF v_marker IS DISTINCT FROM 'validated' THEN
    RAISE EXCEPTION
      'order lifecycle fields can only change through controlled RPCs'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_orders_lifecycle_guard() IS
  'BEFORE UPDATE guard. Blocks direct changes to status_id/ready_at/delivered_at/archived_at unless app.order_lifecycle=validated (transaction-local) or current_user is postgres/supabase_admin.';

DROP TRIGGER IF EXISTS trg_orders_lifecycle_guard ON public.orders;
CREATE TRIGGER trg_orders_lifecycle_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_orders_lifecycle_guard();

REVOKE ALL ON FUNCTION public.tg_orders_lifecycle_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_orders_lifecycle_guard() TO postgres;

-- ---------------------------------------------------------------------------
-- 2) change_order_status — archive reject + validated GUC + sticky timestamps
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_order_status (
  p_order_id  uuid,
  p_status_id uuid,
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
    );
  END IF;

  PERFORM pg_catalog.set_config('app.order_lifecycle', 'validated', true);

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
  );
END;
$function$;

COMMENT ON FUNCTION public.change_order_status(uuid, uuid, uuid) IS
  'INVOKER. Controlled status change. Sets app.order_lifecycle=validated for the guard. Rejects archived orders. ready_at/delivered_at sticky. Audit via trg_orders_activity_log_status.';

-- ---------------------------------------------------------------------------
-- 3) archive_order — terminal only, sticky archived_at, no status change
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

COMMENT ON FUNCTION public.archive_order(uuid, uuid) IS
  'INVOKER. Archives a terminal (closed or cancelled) order. Sets app.order_lifecycle=validated. Idempotent if already archived. Does not change status_id. Viewer denied.';

REVOKE ALL ON FUNCTION public.archive_order(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_order(uuid, uuid) TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- 4) Audit: order.archived (does not touch tg_activity_log_order_created)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_activity_log_order_archived()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot change with archive'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_tenant_member(NEW.tenant_id) THEN
    RAISE EXCEPTION 'tenant access denied'
      USING ERRCODE = '42501';
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
  ) VALUES (
    NEW.tenant_id,
    v_actor,
    NULL,
    'order.archived',
    'order',
    NEW.id,
    pg_catalog.jsonb_build_object(
      'archived_at', OLD.archived_at
    ),
    pg_catalog.jsonb_build_object(
      'archived_at', NEW.archived_at
    ),
    pg_catalog.jsonb_build_object(
      'reference', NEW.reference,
      'status_id', NEW.status_id
    )
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_activity_log_order_archived() IS
  'DEFINER acotado: INSERT activity_log order.archived when archived_at goes from null to set. Does not touch Kiosk created audit.';

DROP TRIGGER IF EXISTS trg_orders_activity_log_archived ON public.orders;
CREATE TRIGGER trg_orders_activity_log_archived
  AFTER UPDATE OF archived_at ON public.orders
  FOR EACH ROW
  WHEN (OLD.archived_at IS DISTINCT FROM NEW.archived_at)
  EXECUTE FUNCTION public.tg_activity_log_order_archived();

REVOKE ALL ON FUNCTION public.tg_activity_log_order_archived() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_activity_log_order_archived() TO postgres;
