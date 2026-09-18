-- Files V1 · F2-A / F2-A.1 / F2-A.2 — order_files + HMAC capability
-- Blob storage lives in Cloudflare R2 (gestcopy-files). This migration is
-- metadata/tenancy only. Does not touch orders.row_version, E1/E2, Kiosk,
-- file_statuses, or external_folder_url.
--
-- F2-A.1: authenticated SELECT only; mutations via DEFINER RPCs + marker.
-- F2-A.2: HMAC capability (Vault files_signing_secret) on mutator RPCs.
-- No service_role path.

begin;

-- ---------------------------------------------------------------------------
-- Private HMAC helpers (F2-A.2)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS files_private;
REVOKE ALL ON SCHEMA files_private FROM PUBLIC;
REVOKE ALL ON SCHEMA files_private FROM anon;
REVOKE ALL ON SCHEMA files_private FROM authenticated;
REVOKE ALL ON SCHEMA files_private FROM service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA files_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION files_private.constant_time_equal(
  p_left text,
  p_right text
)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
DECLARE
  v_left bytea := pg_catalog.convert_to(coalesce(p_left, ''), 'UTF8');
  v_right bytea := pg_catalog.convert_to(coalesce(p_right, ''), 'UTF8');
  v_diff integer := 0;
  v_index integer;
BEGIN
  IF pg_catalog.octet_length(v_left) <> pg_catalog.octet_length(v_right) THEN
    RETURN false;
  END IF;
  IF pg_catalog.octet_length(v_left) = 0 THEN
    RETURN false;
  END IF;
  FOR v_index IN 0..pg_catalog.octet_length(v_left) - 1 LOOP
    v_diff := v_diff | (
      pg_catalog.get_byte(v_left, v_index)
      # pg_catalog.get_byte(v_right, v_index)
    );
  END LOOP;
  RETURN v_diff = 0;
END;
$function$;

CREATE OR REPLACE FUNCTION files_private.verify_files_capability(
  p_purpose text,
  p_user_id uuid,
  p_tenant_id uuid,
  p_order_id uuid,
  p_file_id uuid,
  p_issued_at bigint,
  p_signature text
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_secret text;
  v_expected text;
  v_message text;
BEGIN
  IF p_purpose IS NULL
     OR p_purpose NOT IN ('create', 'complete', 'delete')
     OR p_user_id IS NULL
     OR p_tenant_id IS NULL
     OR p_order_id IS NULL
     OR p_file_id IS NULL
     OR p_signature IS NULL
     OR p_signature !~ '^[a-f0-9]{64}$'
     OR p_issued_at IS NULL
     OR abs(
       extract(epoch FROM pg_catalog.now())::numeric - p_issued_at::numeric
     ) > 120
  THEN
    RETURN false;
  END IF;

  SELECT ds.decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'files_signing_secret'
  ORDER BY ds.updated_at DESC
  LIMIT 1;

  IF v_secret IS NULL OR octet_length(v_secret) < 32 THEN
    RETURN false;
  END IF;

  v_message :=
    'files-v1|'
    || p_purpose
    || '|'
    || p_user_id::text
    || '|'
    || p_tenant_id::text
    || '|'
    || p_order_id::text
    || '|'
    || p_file_id::text
    || '|'
    || p_issued_at::text;

  v_expected := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_message, 'UTF8'),
      pg_catalog.convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  RETURN files_private.constant_time_equal(v_expected, p_signature);
END;
$function$;

REVOKE ALL ON FUNCTION files_private.constant_time_equal(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION files_private.verify_files_capability(
  text, uuid, uuid, uuid, uuid, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA files_private
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  original_name text NOT NULL,
  content_type text,
  size_bytes bigint NOT NULL,
  storage_provider text NOT NULL DEFAULT 'r2',
  storage_key text NOT NULL,
  status text NOT NULL,
  etag text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  upload_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,

  CONSTRAINT order_files_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT order_files_tenant_storage_key_unique UNIQUE (tenant_id, storage_key),
  CONSTRAINT order_files_size_bytes_check CHECK (
    size_bytes > 0 AND size_bytes <= 104857600
  ),
  CONSTRAINT order_files_storage_provider_check CHECK (storage_provider = 'r2'),
  CONSTRAINT order_files_status_check CHECK (status IN ('pending', 'ready')),
  CONSTRAINT order_files_status_shape_check CHECK (
    (
      status = 'pending'
      AND completed_at IS NULL
      AND etag IS NULL
    )
    OR (
      status = 'ready'
      AND completed_at IS NOT NULL
      AND etag IS NOT NULL
    )
  ),
  CONSTRAINT order_files_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT order_files_order_fk
    FOREIGN KEY (tenant_id, order_id)
    REFERENCES public.orders(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT order_files_uploaded_by_membership_fk
    FOREIGN KEY (tenant_id, uploaded_by)
    REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT order_files_deleted_by_membership_fk
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX order_files_order_alive_idx
  ON public.order_files (tenant_id, order_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX order_files_tenant_alive_idx
  ON public.order_files (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX order_files_tenant_status_alive_idx
  ON public.order_files (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX order_files_pending_expiry_idx
  ON public.order_files (upload_expires_at)
  WHERE status = 'pending' AND deleted_at IS NULL;

COMMENT ON TABLE public.order_files IS
  'Files V1 metadata for order attachments. Blobs in private R2. Mutations only via create/complete/soft_delete RPCs + app.order_file_action marker.';

ALTER TABLE public.order_files ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Immutability guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_order_files_immutable_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
  THEN
    RAISE EXCEPTION 'order_files immutable columns cannot change'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_order_files_immutable_columns() IS
  'BEFORE UPDATE: blocks id/tenant_id/order_id/storage_key/uploaded_by/storage_provider changes.';

DROP TRIGGER IF EXISTS trg_order_files_immutable_columns ON public.order_files;
CREATE TRIGGER trg_order_files_immutable_columns
  BEFORE UPDATE ON public.order_files
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_order_files_immutable_columns();

REVOKE ALL ON FUNCTION public.tg_order_files_immutable_columns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_order_files_immutable_columns() TO postgres;

-- ---------------------------------------------------------------------------
-- Mutation marker guard (create / complete / delete)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_order_files_mutation_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  v_marker text;
  v_complete_change boolean;
  v_delete_change boolean;
  v_other_change boolean;
BEGIN
  -- Migrations/seeds only: no JWT. DEFINER RPCs keep auth.uid() set and must
  -- supply app.order_file_action — do not exempt solely because CURRENT_USER
  -- is postgres (DEFINER runs as owner).
  IF auth.uid() IS NULL AND CURRENT_USER IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  v_marker := coalesce(
    pg_catalog.current_setting('app.order_file_action', true),
    ''
  );

  IF TG_OP = 'INSERT' THEN
    IF v_marker IS DISTINCT FROM 'create' THEN
      RAISE EXCEPTION
        'order_files can only be inserted through controlled RPCs'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_complete_change :=
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.etag IS DISTINCT FROM OLD.etag
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at;

  v_delete_change :=
    NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by;

  v_other_change :=
    NEW.original_name IS DISTINCT FROM OLD.original_name
    OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
    OR NEW.upload_expires_at IS DISTINCT FROM OLD.upload_expires_at;

  IF v_other_change THEN
    RAISE EXCEPTION
      'order_files fields can only change through controlled RPCs'
      USING ERRCODE = '42501';
  END IF;

  IF v_complete_change AND v_marker IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION
      'order_files complete fields can only change through controlled RPCs'
      USING ERRCODE = '42501';
  END IF;

  IF v_delete_change AND v_marker IS DISTINCT FROM 'delete' THEN
    RAISE EXCEPTION
      'order_files delete fields can only change through controlled RPCs'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_order_files_mutation_guard() IS
  'BEFORE INSERT/UPDATE: requires app.order_file_action marker (create|complete|delete). Blocks PostgREST/direct forged transitions.';

DROP TRIGGER IF EXISTS trg_order_files_mutation_guard ON public.order_files;
CREATE TRIGGER trg_order_files_mutation_guard
  BEFORE INSERT OR UPDATE ON public.order_files
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_order_files_mutation_guard();

REVOKE ALL ON FUNCTION public.tg_order_files_mutation_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_order_files_mutation_guard() TO postgres;

-- ---------------------------------------------------------------------------
-- Activity: pending -> ready / soft-delete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_activity_log_order_file()
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

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot change with order file activity'
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

  IF OLD.status = 'pending'
     AND NEW.status = 'ready'
     AND OLD.completed_at IS NULL
     AND NEW.completed_at IS NOT NULL
  THEN
    IF NOT public.has_tenant_role(
      NEW.tenant_id,
      ARRAY['owner', 'admin', 'manager', 'staff']::text[]
    ) THEN
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
      'order.file_uploaded',
      'order',
      NEW.order_id,
      pg_catalog.jsonb_build_object('status', OLD.status),
      pg_catalog.jsonb_build_object('status', NEW.status),
      pg_catalog.jsonb_build_object(
        'file_id', NEW.id,
        'original_name', NEW.original_name,
        'content_type', NEW.content_type,
        'size_bytes', NEW.size_bytes,
        'storage_provider', NEW.storage_provider
      )
    );
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF NOT public.has_tenant_role(
      NEW.tenant_id,
      ARRAY['owner', 'admin', 'manager', 'staff']::text[]
    ) THEN
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
      'order.file_deleted',
      'order',
      NEW.order_id,
      pg_catalog.jsonb_build_object('deleted_at', OLD.deleted_at),
      pg_catalog.jsonb_build_object('deleted_at', NEW.deleted_at),
      pg_catalog.jsonb_build_object(
        'file_id', NEW.id,
        'original_name', NEW.original_name,
        'content_type', NEW.content_type,
        'size_bytes', NEW.size_bytes,
        'storage_provider', NEW.storage_provider
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_activity_log_order_file() IS
  'DEFINER: logs order.file_uploaded on pending->ready and order.file_deleted on soft-delete.';

DROP TRIGGER IF EXISTS trg_order_files_activity_log ON public.order_files;
CREATE TRIGGER trg_order_files_activity_log
  AFTER UPDATE ON public.order_files
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_activity_log_order_file();

REVOKE ALL ON FUNCTION public.tg_activity_log_order_file() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_activity_log_order_file() TO postgres;

-- ---------------------------------------------------------------------------
-- RLS: SELECT only for authenticated
-- ---------------------------------------------------------------------------
CREATE POLICY order_files_select_member ON public.order_files
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

REVOKE ALL ON TABLE public.order_files FROM PUBLIC;
REVOKE ALL ON TABLE public.order_files FROM authenticated;
GRANT SELECT ON TABLE public.order_files TO authenticated;
GRANT ALL ON TABLE public.order_files TO postgres;

-- ---------------------------------------------------------------------------
-- Helper: public file jsonb (no storage_key / etag / tenant secrets)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_file_public_json(p_row public.order_files)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'id', p_row.id,
    'original_name', p_row.original_name,
    'content_type', p_row.content_type,
    'size_bytes', p_row.size_bytes,
    'status', p_row.status,
    'created_at', p_row.created_at,
    'completed_at', p_row.completed_at,
    'uploaded_by', p_row.uploaded_by
  );
$function$;

REVOKE ALL ON FUNCTION public.order_file_public_json(public.order_files) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_file_public_json(public.order_files) TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- RPC: create pending upload (+ HMAC capability)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_file_upload(
  p_order_id uuid,
  p_file_id uuid,
  p_original_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_upload_expires_at timestamptz,
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
  v_storage_key text;
  v_row public.order_files%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF p_order_id IS NULL
     OR p_file_id IS NULL
     OR p_original_name IS NULL
     OR p_size_bytes IS NULL
     OR p_upload_expires_at IS NULL
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
    'create',
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

  v_storage_key :=
    'orders/'
    || v_order.tenant_id::text
    || '/'
    || v_order.id::text
    || '/'
    || p_file_id::text;

  PERFORM pg_catalog.set_config('app.order_file_action', 'create', true);

  INSERT INTO public.order_files (
    id,
    tenant_id,
    order_id,
    original_name,
    content_type,
    size_bytes,
    storage_provider,
    storage_key,
    status,
    uploaded_by,
    upload_expires_at
  ) VALUES (
    p_file_id,
    v_order.tenant_id,
    v_order.id,
    p_original_name,
    NULLIF(btrim(p_content_type), ''),
    p_size_bytes,
    'r2',
    v_storage_key,
    'pending',
    v_user_id,
    p_upload_expires_at
  )
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    'file', public.order_file_public_json(v_row),
    'storage_key', v_row.storage_key,
    'upload_expires_at', v_row.upload_expires_at
  );
END;
$function$;

COMMENT ON FUNCTION public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text) IS
  'Controlled pending create. HMAC capability + app.order_file_action=create. storage_key server-side.';

REVOKE ALL ON FUNCTION public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- RPC: complete upload (after backend HEAD R2 size check)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_order_file_upload(
  p_order_id uuid,
  p_file_id uuid,
  p_etag text,
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
     OR p_etag IS NULL
     OR btrim(p_etag) = ''
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
    'complete',
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

  IF NOT FOUND OR v_file.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'file not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_file.status = 'ready' THEN
    RETURN pg_catalog.jsonb_build_object(
      'file', public.order_file_public_json(v_file),
      'replay', true
    );
  END IF;

  IF v_file.upload_expires_at < pg_catalog.now() THEN
    RAISE EXCEPTION 'upload expired'
      USING ERRCODE = '22023';
  END IF;

  IF v_file.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'file not pending'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.order_file_action', 'complete', true);

  UPDATE public.order_files
  SET
    status = 'ready',
    etag = p_etag,
    completed_at = pg_catalog.now()
  WHERE id = v_file.id
    AND tenant_id = v_file.tenant_id
    AND status = 'pending'
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    SELECT *
    INTO v_updated
    FROM public.order_files
    WHERE id = v_file.id
      AND tenant_id = v_file.tenant_id
      AND status = 'ready'
      AND deleted_at IS NULL;

    IF FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'file', public.order_file_public_json(v_updated),
        'replay', true
      );
    END IF;

    RAISE EXCEPTION 'could not complete upload'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'file', public.order_file_public_json(v_updated),
    'replay', false
  );
END;
$function$;

COMMENT ON FUNCTION public.complete_order_file_upload(uuid, uuid, text, bigint, text) IS
  'Controlled pending->ready. HMAC capability + marker. Backend verifies R2 size via HEAD before calling.';

REVOKE ALL ON FUNCTION public.complete_order_file_upload(uuid, uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_order_file_upload(uuid, uuid, text, bigint, text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- RPC: soft delete (R2 delete is API best-effort after)
-- ---------------------------------------------------------------------------
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

commit;
