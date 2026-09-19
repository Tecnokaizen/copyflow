-- Files V1 · maintenance cleanup for expired pending uploads
-- Server-only cross-tenant maintenance. Normal tenant access remains RLS-scoped.
-- R2 object deletion happens in the application before this RPC purges metadata.

begin;

CREATE OR REPLACE FUNCTION public.purge_expired_order_file(
  p_file_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_deleted_id uuid;
BEGIN
  IF p_file_id IS NULL THEN
    RAISE EXCEPTION 'file id required'
      USING ERRCODE = '22023';
  END IF;

  -- Defense in depth: this maintenance RPC is only for the server-side
  -- service role (or direct postgres maintenance).
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND CURRENT_USER IS DISTINCT FROM 'postgres'
  THEN
    RAISE EXCEPTION 'maintenance access denied'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.order_files
  WHERE id = p_file_id
    AND status = 'pending'
    AND deleted_at IS NULL
    AND upload_expires_at < pg_catalog.now()
  RETURNING id INTO v_deleted_id;

  RETURN v_deleted_id IS NOT NULL;
END;
$function$;

COMMENT ON FUNCTION public.purge_expired_order_file(uuid) IS
  'Server-only maintenance: hard-deletes metadata for an expired pending upload after the R2 object has been deleted.';

REVOKE ALL ON FUNCTION public.purge_expired_order_file(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_order_file(uuid)
  TO service_role, postgres;

commit;
