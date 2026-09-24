-- Quote Files V1. Additive. order_files stays order-only.
-- Shared tenant quota sums order_files + quote_files under the existing
-- advisory lock namespace file-quota:{tenant_id}.

begin;

-- ---------------------------------------------------------------------------
-- Quote capability. Do not replace files_private.verify_files_capability.
-- Payload: files-v1-quote|purpose|user|tenant|quote_id|file_id|issued_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION files_private.verify_quote_files_capability(
  p_purpose text,
  p_user_id uuid,
  p_tenant_id uuid,
  p_quote_id uuid,
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
  v_message text;
  v_expected text;
BEGIN
  IF p_purpose IS NULL
     OR p_purpose NOT IN ('create', 'complete', 'delete')
     OR p_user_id IS NULL
     OR p_tenant_id IS NULL
     OR p_quote_id IS NULL
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
    'files-v1-quote|'
    || p_purpose
    || '|'
    || p_user_id::text
    || '|'
    || p_tenant_id::text
    || '|'
    || p_quote_id::text
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

REVOKE ALL ON FUNCTION files_private.verify_quote_files_capability(
  text, uuid, uuid, uuid, uuid, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE public.quote_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  quote_id uuid NOT NULL,
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

  CONSTRAINT quote_files_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT quote_files_tenant_storage_key_unique UNIQUE (tenant_id, storage_key),
  CONSTRAINT quote_files_size_bytes_check CHECK (
    size_bytes > 0 AND size_bytes <= 104857600
  ),
  CONSTRAINT quote_files_storage_provider_check CHECK (storage_provider = 'r2'),
  CONSTRAINT quote_files_status_check CHECK (status IN ('pending', 'ready')),
  CONSTRAINT quote_files_status_shape_check CHECK (
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
  CONSTRAINT quote_files_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT quote_files_quote_fk
    FOREIGN KEY (tenant_id, quote_id)
    REFERENCES public.quotes(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT quote_files_uploaded_by_membership_fk
    FOREIGN KEY (tenant_id, uploaded_by)
    REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT quote_files_deleted_by_membership_fk
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX quote_files_quote_alive_idx
  ON public.quote_files (tenant_id, quote_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX quote_files_tenant_alive_idx
  ON public.quote_files (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX quote_files_pending_expiry_idx
  ON public.quote_files (upload_expires_at)
  WHERE status = 'pending' AND deleted_at IS NULL;

COMMENT ON TABLE public.quote_files IS
  'Quote Files V1 metadata. Blobs in the same private R2 bucket as order files. Key quotes/{tenant}/{quote}/{file}. Mutations only via quote file RPCs.';

ALTER TABLE public.quote_files ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tg_quote_files_immutable_columns()
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
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
  THEN
    RAISE EXCEPTION 'quote_files immutable columns cannot change'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_quote_files_immutable_columns ON public.quote_files;
CREATE TRIGGER trg_quote_files_immutable_columns
  BEFORE UPDATE ON public.quote_files
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_quote_files_immutable_columns();

REVOKE ALL ON FUNCTION public.tg_quote_files_immutable_columns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_quote_files_immutable_columns() TO postgres;

CREATE OR REPLACE FUNCTION public.tg_quote_files_mutation_guard()
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
  IF auth.uid() IS NULL AND CURRENT_USER IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  v_marker := coalesce(
    pg_catalog.current_setting('app.quote_file_action', true),
    ''
  );

  IF TG_OP = 'INSERT' THEN
    IF v_marker IS DISTINCT FROM 'create' THEN
      RAISE EXCEPTION
        'quote_files can only be inserted through controlled RPCs'
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
      'quote_files fields can only change through controlled RPCs'
      USING ERRCODE = '42501';
  END IF;

  IF v_complete_change AND v_marker IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION
      'quote_files complete fields can only change through controlled RPCs'
      USING ERRCODE = '42501';
  END IF;

  IF v_delete_change AND v_marker IS DISTINCT FROM 'delete' THEN
    RAISE EXCEPTION
      'quote_files delete fields can only change through controlled RPCs'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_quote_files_mutation_guard ON public.quote_files;
CREATE TRIGGER trg_quote_files_mutation_guard
  BEFORE INSERT OR UPDATE ON public.quote_files
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_quote_files_mutation_guard();

REVOKE ALL ON FUNCTION public.tg_quote_files_mutation_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_quote_files_mutation_guard() TO postgres;

CREATE OR REPLACE FUNCTION public.tg_activity_log_quote_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reference text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot change with quote file activity'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF NOT public.tenant_has_feature(NEW.tenant_id, 'quotes')
     OR NOT public.has_tenant_role(
       NEW.tenant_id,
       ARRAY['owner', 'admin', 'manager', 'staff']::text[]
     )
  THEN
    RAISE EXCEPTION 'tenant access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT q.reference
  INTO v_reference
  FROM public.quotes q
  WHERE q.id = NEW.quote_id
    AND q.tenant_id = NEW.tenant_id;

  IF OLD.status = 'pending'
     AND NEW.status = 'ready'
     AND OLD.completed_at IS NULL
     AND NEW.completed_at IS NOT NULL
  THEN
    INSERT INTO public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    ) VALUES (
      NEW.tenant_id, v_actor, NULL, 'quote.file_uploaded', 'quote', NEW.quote_id,
      pg_catalog.jsonb_build_object('status', OLD.status),
      pg_catalog.jsonb_build_object('status', NEW.status),
      pg_catalog.jsonb_build_object(
        'file_id', NEW.id,
        'original_name', NEW.original_name,
        'content_type', NEW.content_type,
        'size_bytes', NEW.size_bytes,
        'storage_provider', NEW.storage_provider,
        'reference', v_reference,
        'quote_reference', v_reference
      )
    );
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    ) VALUES (
      NEW.tenant_id, v_actor, NULL, 'quote.file_deleted', 'quote', NEW.quote_id,
      pg_catalog.jsonb_build_object('deleted_at', OLD.deleted_at),
      pg_catalog.jsonb_build_object('deleted_at', NEW.deleted_at),
      pg_catalog.jsonb_build_object(
        'file_id', NEW.id,
        'original_name', NEW.original_name,
        'content_type', NEW.content_type,
        'size_bytes', NEW.size_bytes,
        'storage_provider', NEW.storage_provider,
        'reference', v_reference,
        'quote_reference', v_reference
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_quote_files_activity_log ON public.quote_files;
CREATE TRIGGER trg_quote_files_activity_log
  AFTER UPDATE ON public.quote_files
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_activity_log_quote_file();

REVOKE ALL ON FUNCTION public.tg_activity_log_quote_file() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_activity_log_quote_file() TO postgres;

CREATE POLICY quote_files_select_operative ON public.quote_files
  FOR SELECT
  TO authenticated
  USING (
    public.tenant_has_feature(tenant_id, 'quotes')
    AND public.has_tenant_role(
      tenant_id,
      ARRAY['owner', 'admin', 'manager', 'staff']::text[]
    )
  );

REVOKE ALL ON TABLE public.quote_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.quote_files TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_file_public_json(p_row public.quote_files)
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

REVOKE ALL ON FUNCTION public.quote_file_public_json(public.quote_files) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_file_public_json(public.quote_files)
  TO authenticated, postgres;

-- Shared tenant totals. Shape unchanged. Not a separate commercial quota.
CREATE OR REPLACE FUNCTION public.tenant_storage_usage(p_tenant_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_file_count bigint := 0;
  v_reserved bigint := 0;
  v_ready bigint := 0;
  v_pending bigint := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant id required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    count(*) FILTER (WHERE deleted_at IS NULL),
    coalesce(sum(size_bytes) FILTER (WHERE deleted_at IS NULL), 0),
    coalesce(sum(size_bytes) FILTER (WHERE deleted_at IS NULL AND status = 'ready'), 0),
    coalesce(sum(size_bytes) FILTER (WHERE deleted_at IS NULL AND status = 'pending'), 0)
  INTO v_file_count, v_reserved, v_ready, v_pending
  FROM (
    SELECT size_bytes, status, deleted_at
    FROM public.order_files
    WHERE tenant_id = p_tenant_id
    UNION ALL
    SELECT size_bytes, status, deleted_at
    FROM public.quote_files
    WHERE tenant_id = p_tenant_id
  ) files;

  RETURN pg_catalog.jsonb_build_object(
    'file_count', v_file_count,
    'reserved_bytes', v_reserved,
    'ready_bytes', v_ready,
    'pending_bytes', v_pending
  );
END;
$function$;

COMMENT ON FUNCTION public.tenant_storage_usage(uuid) IS
  'Tenant storage total. reserved_bytes sums order_files and quote_files where deleted_at is null (ready + pending).';

-- Same lock namespace as order INIT. Reserved bytes include both tables.
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
  v_order public.orders%rowtype;
  v_storage_key text;
  v_row public.order_files%rowtype;
  v_platform_max constant bigint := 104857600;
  v_max_file bigint;
  v_storage_limit bigint;
  v_reserved bigint;
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

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_tenant_role(
    v_order.tenant_id,
    ARRAY['owner', 'admin', 'manager', 'staff']::text[]
  ) THEN
    RAISE EXCEPTION 'tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF v_order.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'order is archived' USING ERRCODE = '42501';
  END IF;

  IF NOT files_private.verify_files_capability(
    'create', v_user_id, v_order.tenant_id, p_order_id, p_file_id,
    p_issued_at, p_signature
  ) THEN
    RAISE EXCEPTION 'invalid capability' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('file-quota:' || v_order.tenant_id::text, 0)
  );

  v_max_file := public.resolve_tenant_max_file_bytes(v_order.tenant_id);
  IF p_size_bytes <= 0
     OR p_size_bytes > v_max_file
     OR p_size_bytes > v_platform_max
  THEN
    RAISE EXCEPTION 'file_too_large' USING ERRCODE = '22023';
  END IF;

  v_storage_limit := public.resolve_tenant_storage_limit_bytes(v_order.tenant_id);
  IF v_storage_limit IS NOT NULL THEN
    SELECT coalesce(sum(size_bytes), 0)
    INTO v_reserved
    FROM (
      SELECT size_bytes FROM public.order_files
      WHERE tenant_id = v_order.tenant_id AND deleted_at IS NULL
      UNION ALL
      SELECT size_bytes FROM public.quote_files
      WHERE tenant_id = v_order.tenant_id AND deleted_at IS NULL
    ) reserved;

    IF v_reserved + p_size_bytes > v_storage_limit THEN
      RAISE EXCEPTION 'storage_quota_exceeded' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_storage_key :=
    'orders/' || v_order.tenant_id::text || '/' || v_order.id::text || '/' || p_file_id::text;

  PERFORM pg_catalog.set_config('app.order_file_action', 'create', true);

  INSERT INTO public.order_files (
    id, tenant_id, order_id, original_name, content_type, size_bytes,
    storage_provider, storage_key, status, uploaded_by, upload_expires_at
  ) VALUES (
    p_file_id, v_order.tenant_id, v_order.id, p_original_name,
    nullif(btrim(p_content_type), ''), p_size_bytes, 'r2', v_storage_key,
    'pending', v_user_id, p_upload_expires_at
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
  'Controlled pending create. Same file-quota advisory lock. Reserved bytes = order_files + quote_files.';

CREATE OR REPLACE FUNCTION public.create_quote_file_upload(
  p_quote_id uuid,
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
  v_quote public.quotes%rowtype;
  v_storage_key text;
  v_row public.quote_files%rowtype;
  v_platform_max constant bigint := 104857600;
  v_max_file bigint;
  v_storage_limit bigint;
  v_reserved bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_quote_id IS NULL
     OR p_file_id IS NULL
     OR p_original_name IS NULL
     OR p_size_bytes IS NULL
     OR p_upload_expires_at IS NULL
     OR p_issued_at IS NULL
     OR p_signature IS NULL
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
    'create', v_user_id, v_quote.tenant_id, p_quote_id, p_file_id,
    p_issued_at, p_signature
  ) THEN
    RAISE EXCEPTION 'invalid capability' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('file-quota:' || v_quote.tenant_id::text, 0)
  );

  v_max_file := public.resolve_tenant_max_file_bytes(v_quote.tenant_id);
  IF p_size_bytes <= 0
     OR p_size_bytes > v_max_file
     OR p_size_bytes > v_platform_max
  THEN
    RAISE EXCEPTION 'file_too_large' USING ERRCODE = '22023';
  END IF;

  v_storage_limit := public.resolve_tenant_storage_limit_bytes(v_quote.tenant_id);
  IF v_storage_limit IS NOT NULL THEN
    SELECT coalesce(sum(size_bytes), 0)
    INTO v_reserved
    FROM (
      SELECT size_bytes FROM public.order_files
      WHERE tenant_id = v_quote.tenant_id AND deleted_at IS NULL
      UNION ALL
      SELECT size_bytes FROM public.quote_files
      WHERE tenant_id = v_quote.tenant_id AND deleted_at IS NULL
    ) reserved;

    IF v_reserved + p_size_bytes > v_storage_limit THEN
      RAISE EXCEPTION 'storage_quota_exceeded' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_storage_key :=
    'quotes/' || v_quote.tenant_id::text || '/' || v_quote.id::text || '/' || p_file_id::text;

  PERFORM pg_catalog.set_config('app.quote_file_action', 'create', true);

  INSERT INTO public.quote_files (
    id, tenant_id, quote_id, original_name, content_type, size_bytes,
    storage_provider, storage_key, status, uploaded_by, upload_expires_at
  ) VALUES (
    p_file_id, v_quote.tenant_id, v_quote.id, p_original_name,
    nullif(btrim(p_content_type), ''), p_size_bytes, 'r2', v_storage_key,
    'pending', v_user_id, p_upload_expires_at
  )
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    'file', public.quote_file_public_json(v_row),
    'storage_key', v_row.storage_key,
    'upload_expires_at', v_row.upload_expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_quote_file_upload(
  uuid, uuid, text, text, bigint, timestamptz, bigint, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quote_file_upload(
  uuid, uuid, text, text, bigint, timestamptz, bigint, text
) TO authenticated, postgres;

CREATE OR REPLACE FUNCTION public.complete_quote_file_upload(
  p_quote_id uuid,
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
  v_quote public.quotes%rowtype;
  v_file public.quote_files%rowtype;
  v_updated public.quote_files%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_quote_id IS NULL OR p_file_id IS NULL OR p_etag IS NULL
     OR btrim(p_etag) = '' OR p_issued_at IS NULL OR p_signature IS NULL
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
    'complete', v_user_id, v_quote.tenant_id, p_quote_id, p_file_id,
    p_issued_at, p_signature
  ) THEN
    RAISE EXCEPTION 'invalid capability' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_file
  FROM public.quote_files
  WHERE id = p_file_id AND quote_id = p_quote_id AND tenant_id = v_quote.tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_file.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'file not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_file.status = 'ready' THEN
    RETURN pg_catalog.jsonb_build_object(
      'file', public.quote_file_public_json(v_file),
      'replay', true
    );
  END IF;

  IF v_file.upload_expires_at < pg_catalog.now() THEN
    RAISE EXCEPTION 'upload expired' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.quote_file_action', 'complete', true);

  UPDATE public.quote_files
  SET status = 'ready', etag = p_etag, completed_at = pg_catalog.now()
  WHERE id = v_file.id AND tenant_id = v_file.tenant_id
    AND status = 'pending' AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not complete upload' USING ERRCODE = 'P0001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'file', public.quote_file_public_json(v_updated),
    'replay', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_quote_file_upload(uuid, uuid, text, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_quote_file_upload(uuid, uuid, text, bigint, text)
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

CREATE OR REPLACE FUNCTION public.purge_expired_quote_file(p_file_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_deleted_id uuid;
BEGIN
  IF p_file_id IS NULL THEN
    RAISE EXCEPTION 'file id required' USING ERRCODE = '22023';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND CURRENT_USER IS DISTINCT FROM 'postgres'
  THEN
    RAISE EXCEPTION 'maintenance access denied' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.quote_files
  WHERE id = p_file_id
    AND status = 'pending'
    AND deleted_at IS NULL
    AND upload_expires_at < pg_catalog.now()
  RETURNING id INTO v_deleted_id;

  RETURN v_deleted_id IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_quote_file(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_quote_file(uuid)
  TO service_role, postgres;

commit;
