-- Rollback (NON-DESTRUCTIVE) for 20261014120000_files_storage_deletions_v1.sql
--
-- Use only if the new database behaviour itself must be withdrawn. Rolling
-- back the APPLICATION alone does not need this script: previous code works
-- with the new RPCs (it ignores storage_deletion_id).
--
-- What it does:
--   * restores the previous soft_delete_order_file / soft_delete_quote_file
--     bodies (no enqueue; same signatures and grants);
--   * freezes outbox processing by revoking service_role EXECUTE on the
--     maintenance RPCs.
-- What it deliberately does NOT do:
--   * drop files_private.storage_deletions / storage_deletion_events or any
--     function: pending tasks and their trace are preserved for a later
--     re-forward (new migration re-granting EXECUTE) or manual processing.
--
-- After running it, the cleanup cron of the NEW code fails closed (500) and
-- deletes nothing; deploy the previous application code together with it.
-- Verify with the queries at the end.

begin;

CREATE OR REPLACE FUNCTION public.soft_delete_order_file(
  p_order_id uuid,
  p_file_id uuid,
  p_issued_at bigint,
  p_signature text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_file public.order_files%ROWTYPE;
  v_updated public.order_files%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF p_order_id IS NULL
     OR p_file_id IS NULL
     OR p_issued_at IS NULL
     OR p_signature IS NULL
  THEN
    RAISE EXCEPTION 'required arguments missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_tenant_role(
    v_order.tenant_id,
    ARRAY['owner', 'admin', 'manager', 'staff']::text[]
  ) THEN
    RAISE EXCEPTION 'tenant access denied'
      USING ERRCODE = '42501';
  END IF;

  IF v_order.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'order is archived'
      USING ERRCODE = '42501';
  END IF;

  IF NOT files_private.verify_files_capability(
    'delete',
    v_user_id,
    v_order.tenant_id,
    p_order_id,
    p_file_id,
    p_issued_at,
    p_signature
  ) THEN
    RAISE EXCEPTION 'invalid capability'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_file
  FROM public.order_files
  WHERE id = p_file_id
    AND order_id = p_order_id
    AND tenant_id = v_order.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'file not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_file.deleted_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id,
      'storage_key', v_file.storage_key,
      'replay', true
    );
  END IF;

  PERFORM pg_catalog.set_config('app.order_file_action', 'delete', true);

  UPDATE public.order_files
  SET
    deleted_at = pg_catalog.now(),
    deleted_by = v_user_id
  WHERE id = v_file.id
    AND tenant_id = v_file.tenant_id
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id,
      'storage_key', v_file.storage_key,
      'replay', true
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id,
    'storage_key', v_updated.storage_key,
    'replay', false
  );
END;
$function$;

COMMENT ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text) IS
  'Controlled soft-delete. HMAC capability + marker. Idempotent. Does not touch R2.';

REVOKE ALL ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text)
  TO authenticated, postgres;

CREATE OR REPLACE FUNCTION public.soft_delete_quote_file(
  p_quote_id uuid,
  p_file_id uuid,
  p_issued_at bigint,
  p_signature text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_quote public.quotes%rowtype;
  v_file public.quote_files%rowtype;
  v_updated public.quote_files%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_quote_id IS NULL OR p_file_id IS NULL
     OR p_issued_at IS NULL OR p_signature IS NULL
  THEN
    RAISE EXCEPTION 'required arguments missing' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.tenant_has_feature(v_quote.tenant_id, 'quotes')
     OR NOT public.has_tenant_role(
       v_quote.tenant_id,
       ARRAY['owner', 'admin', 'manager', 'staff']::text[]
     )
  THEN
    RAISE EXCEPTION 'tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF NOT files_private.verify_quote_files_capability(
    'delete', v_user_id, v_quote.tenant_id, p_quote_id, p_file_id,
    p_issued_at, p_signature
  ) THEN
    RAISE EXCEPTION 'invalid capability' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_file
  FROM public.quote_files
  WHERE id = p_file_id AND quote_id = p_quote_id AND tenant_id = v_quote.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'file not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_file.deleted_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id, 'storage_key', v_file.storage_key, 'replay', true
    );
  END IF;

  PERFORM pg_catalog.set_config('app.quote_file_action', 'delete', true);

  UPDATE public.quote_files
  SET deleted_at = pg_catalog.now(), deleted_by = v_user_id
  WHERE id = v_file.id AND tenant_id = v_file.tenant_id AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id, 'storage_key', v_updated.storage_key, 'replay', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.soft_delete_quote_file(uuid, uuid, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_quote_file(uuid, uuid, bigint, text)
  TO authenticated, postgres;

REVOKE EXECUTE ON FUNCTION public.claim_expired_file_uploads(integer) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.claim_storage_deletions(integer, integer) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.claim_storage_deletion(uuid, integer) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.finish_storage_deletion(uuid, uuid, text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.storage_deletion_backlog() FROM service_role;

commit;

-- Verification (expect: outbox rows preserved, no service_role EXECUTE):
--   select status, count(*) from files_private.storage_deletions group by status;
--   select has_function_privilege('service_role', 'public.finish_storage_deletion(uuid,uuid,text,text)', 'EXECUTE');
--   select pg_get_functiondef('public.soft_delete_order_file(uuid,uuid,bigint,text)'::regprocedure) !~ 'enqueue_storage_deletion';
