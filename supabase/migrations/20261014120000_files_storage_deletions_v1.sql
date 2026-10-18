-- Files V1.1 · Recoverable physical deletion (transactional outbox)
--
-- Problem: R2 and PostgreSQL share no transaction. The previous flows deleted
-- the R2 object first and changed metadata afterwards, so a metadata failure
-- left active rows without blobs, and cleanup could delete the blob of an
-- upload completed concurrently.
--
-- Protocol (expand phase, additive):
--   1. Reserve in PostgreSQL: the controlled RPC hides the file (soft delete,
--      or hard delete of an expired pending upload) and enqueues a row in
--      files_private.storage_deletions in the SAME transaction.
--   2. Only after commit, a server process claims the task with a lease,
--      deletes the R2 object (idempotent) and finishes the task.
--   3. Failed or interrupted tasks are retried with backoff up to
--      max_attempts, then kept as 'failed' for administrative recovery.
--
-- Readers already treat deleted_at IS NOT NULL / missing rows as gone, so no
-- signed URL is issued once the reservation commits.
--
-- Not changed: RLS, table grants, triggers, capability verification,
-- create/complete RPCs, purge_expired_*_file (kept for old code; contract
-- phase removes them later).

begin;

-- ---------------------------------------------------------------------------
-- Private task table
-- ---------------------------------------------------------------------------
CREATE TABLE files_private.storage_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_kind text NOT NULL,
  tenant_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  file_id uuid NOT NULL,
  storage_key text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 10,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  manual_requeues integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT storage_deletions_file_kind_check
    CHECK (file_kind IN ('order', 'quote')),
  CONSTRAINT storage_deletions_reason_check
    CHECK (reason IN ('user_delete', 'expired_upload')),
  CONSTRAINT storage_deletions_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT storage_deletions_attempts_check
    CHECK (attempts >= 0 AND max_attempts > 0 AND manual_requeues >= 0),
  -- Only keys derived from the ids may ever be deleted.
  CONSTRAINT storage_deletions_key_shape_check CHECK (
    storage_key = (
      CASE file_kind WHEN 'order' THEN 'orders/' ELSE 'quotes/' END
      || tenant_id::text || '/' || parent_id::text || '/' || file_id::text
    )
  ),
  CONSTRAINT storage_deletions_lease_shape_check CHECK (
    (status = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CONSTRAINT storage_deletions_completed_shape_check CHECK (
    (status = 'completed') = (completed_at IS NOT NULL)
  ),
  CONSTRAINT storage_deletions_failed_shape_check CHECK (
    (status = 'failed') = (failed_at IS NOT NULL)
  ),
  CONSTRAINT storage_deletions_last_error_length_check
    CHECK (last_error IS NULL OR pg_catalog.char_length(last_error) <= 500)
);

-- One active task per object.
CREATE UNIQUE INDEX storage_deletions_active_key_idx
  ON files_private.storage_deletions (storage_key)
  WHERE status IN ('pending', 'processing');

-- A soft-deleted row is permanent, so one user deletion task per file.
CREATE UNIQUE INDEX storage_deletions_user_delete_file_idx
  ON files_private.storage_deletions (file_kind, file_id)
  WHERE reason = 'user_delete';

CREATE INDEX storage_deletions_due_idx
  ON files_private.storage_deletions (next_attempt_at, id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX storage_deletions_failed_idx
  ON files_private.storage_deletions (failed_at)
  WHERE status = 'failed';

COMMENT ON TABLE files_private.storage_deletions IS
  'Outbox of R2 object deletions. Written in the same transaction that hides file metadata. Processed only through service_role RPCs.';

CREATE TABLE files_private.storage_deletion_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deletion_id uuid NOT NULL
    REFERENCES files_private.storage_deletions(id) ON DELETE RESTRICT,
  event text NOT NULL,
  attempt integer NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT storage_deletion_events_event_check CHECK (
    event IN (
      'enqueued', 'claimed', 'completed', 'retry_scheduled', 'failed',
      'stale_finish_ignored', 'requeued'
    )
  ),
  CONSTRAINT storage_deletion_events_detail_length_check
    CHECK (detail IS NULL OR pg_catalog.char_length(detail) <= 500)
);

CREATE INDEX storage_deletion_events_deletion_idx
  ON files_private.storage_deletion_events (deletion_id, id);

COMMENT ON TABLE files_private.storage_deletion_events IS
  'Append-only trace of storage deletion task transitions.';

ALTER TABLE files_private.storage_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE files_private.storage_deletion_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE files_private.storage_deletions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE files_private.storage_deletion_events
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private helpers (called only from DEFINER RPCs below)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION files_private.storage_deletion_error_text(p_error text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
  SELECT NULLIF(
    pg_catalog.left(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(coalesce(p_error, ''), '[[:cntrl:]]+', ' ', 'g')
      ),
      500
    ),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION files_private.log_storage_deletion_event(
  p_deletion_id uuid,
  p_event text,
  p_attempt integer,
  p_detail text
)
  RETURNS void
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
  INSERT INTO files_private.storage_deletion_events (deletion_id, event, attempt, detail)
  VALUES (
    p_deletion_id,
    p_event,
    p_attempt,
    files_private.storage_deletion_error_text(p_detail)
  );
$function$;

CREATE OR REPLACE FUNCTION files_private.enqueue_storage_deletion(
  p_file_kind text,
  p_tenant_id uuid,
  p_parent_id uuid,
  p_file_id uuid,
  p_storage_key text,
  p_reason text,
  p_requested_by uuid,
  p_not_before timestamptz
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_reason = 'user_delete' THEN
    SELECT d.id
    INTO v_id
    FROM files_private.storage_deletions d
    WHERE d.file_kind = p_file_kind
      AND d.file_id = p_file_id
      AND d.reason = 'user_delete';

    IF FOUND THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO files_private.storage_deletions (
    file_kind, tenant_id, parent_id, file_id, storage_key, reason,
    requested_by, next_attempt_at
  ) VALUES (
    p_file_kind, p_tenant_id, p_parent_id, p_file_id, p_storage_key, p_reason,
    p_requested_by, greatest(pg_catalog.now(), coalesce(p_not_before, pg_catalog.now()))
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    PERFORM files_private.log_storage_deletion_event(v_id, 'enqueued', 0, p_reason);
    RETURN v_id;
  END IF;

  -- An active task already covers this object.
  SELECT d.id
  INTO v_id
  FROM files_private.storage_deletions d
  WHERE d.storage_key = p_storage_key
    AND d.status IN ('pending', 'processing');

  IF v_id IS NULL AND p_reason = 'user_delete' THEN
    SELECT d.id
    INTO v_id
    FROM files_private.storage_deletions d
    WHERE d.file_kind = p_file_kind
      AND d.file_id = p_file_id
      AND d.reason = 'user_delete';
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'storage deletion could not be enqueued'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION files_private.storage_key_has_live_reference(
  p_tenant_id uuid,
  p_storage_key text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.order_files f
    WHERE f.tenant_id = p_tenant_id
      AND f.storage_key = p_storage_key
      AND f.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.quote_files f
    WHERE f.tenant_id = p_tenant_id
      AND f.storage_key = p_storage_key
      AND f.deleted_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION files_private.claim_storage_deletions(
  p_id uuid,
  p_limit integer,
  p_lease_seconds integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
DECLARE
  v_row files_private.storage_deletions%ROWTYPE;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid claim limit' USING ERRCODE = '22023';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid lease seconds' USING ERRCODE = '22023';
  END IF;

  -- Abandoned leases that already used every attempt become terminal.
  FOR v_row IN
    UPDATE files_private.storage_deletions d
    SET
      status = 'failed',
      failed_at = pg_catalog.now(),
      lease_token = NULL,
      lease_until = NULL,
      last_error = 'lease expired at max attempts',
      updated_at = pg_catalog.now()
    WHERE d.id IN (
      SELECT s.id
      FROM files_private.storage_deletions s
      WHERE s.status = 'processing'
        AND s.lease_until < pg_catalog.now()
        AND s.attempts >= s.max_attempts
        AND (p_id IS NULL OR s.id = p_id)
      FOR UPDATE SKIP LOCKED
    )
    RETURNING d.*
  LOOP
    PERFORM files_private.log_storage_deletion_event(
      v_row.id, 'failed', v_row.attempts, v_row.last_error
    );
  END LOOP;

  FOR v_row IN
    SELECT *
    FROM files_private.storage_deletions d
    WHERE (p_id IS NULL OR d.id = p_id)
      AND (
        (d.status = 'pending' AND d.next_attempt_at <= pg_catalog.now())
        OR (d.status = 'processing' AND d.lease_until < pg_catalog.now())
      )
    ORDER BY d.next_attempt_at, d.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Never delete an object that a visible row still points to.
    IF files_private.storage_key_has_live_reference(v_row.tenant_id, v_row.storage_key) THEN
      UPDATE files_private.storage_deletions
      SET
        status = 'failed',
        failed_at = pg_catalog.now(),
        lease_token = NULL,
        lease_until = NULL,
        last_error = 'live metadata references storage key',
        updated_at = pg_catalog.now()
      WHERE id = v_row.id;

      PERFORM files_private.log_storage_deletion_event(
        v_row.id, 'failed', v_row.attempts, 'live metadata references storage key'
      );
      CONTINUE;
    END IF;

    UPDATE files_private.storage_deletions
    SET
      status = 'processing',
      attempts = attempts + 1,
      lease_token = gen_random_uuid(),
      lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    PERFORM files_private.log_storage_deletion_event(
      v_row.id, 'claimed', v_row.attempts, NULL
    );

    v_out := v_out || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_row.id,
        'file_kind', v_row.file_kind,
        'tenant_id', v_row.tenant_id,
        'parent_id', v_row.parent_id,
        'file_id', v_row.file_id,
        'storage_key', v_row.storage_key,
        'attempts', v_row.attempts,
        'lease_token', v_row.lease_token,
        'lease_until', v_row.lease_until
      )
    );
  END LOOP;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION files_private.assert_files_maintenance_caller()
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
BEGIN
  -- EXECUTE grants are the primary control. CURRENT_USER is the DEFINER owner
  -- here, so check the request role / session user instead.
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role'
     AND SESSION_USER NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'maintenance access denied'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION files_private.storage_deletion_error_text(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION files_private.log_storage_deletion_event(uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION files_private.enqueue_storage_deletion(text, uuid, uuid, uuid, text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION files_private.storage_key_has_live_reference(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION files_private.claim_storage_deletions(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION files_private.assert_files_maintenance_caller()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC: soft delete order file (same signature and guarantees) + enqueue
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
  v_not_before timestamptz;
  v_deletion_id uuid;
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

  -- A pending upload may still receive a PUT until its presign expires.
  v_not_before := CASE
    WHEN v_file.status = 'pending'
      THEN v_file.upload_expires_at + interval '5 minutes'
    ELSE pg_catalog.now()
  END;

  IF v_file.deleted_at IS NOT NULL THEN
    v_deletion_id := files_private.enqueue_storage_deletion(
      'order', v_file.tenant_id, v_file.order_id, v_file.id,
      v_file.storage_key, 'user_delete', v_file.deleted_by, v_not_before
    );

    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id,
      'storage_key', v_file.storage_key,
      'replay', true,
      'storage_deletion_id', v_deletion_id
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
    RAISE EXCEPTION 'could not delete file'
      USING ERRCODE = 'P0001';
  END IF;

  v_deletion_id := files_private.enqueue_storage_deletion(
    'order', v_updated.tenant_id, v_updated.order_id, v_updated.id,
    v_updated.storage_key, 'user_delete', v_user_id, v_not_before
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id,
    'storage_key', v_updated.storage_key,
    'replay', false,
    'storage_deletion_id', v_deletion_id
  );
END;
$function$;

COMMENT ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text) IS
  'Controlled soft-delete. HMAC capability + marker. Idempotent. Enqueues the R2 deletion in the same transaction; never touches R2.';

REVOKE ALL ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- RPC: soft delete quote file (same signature and guarantees) + enqueue.
-- Official PDFs stay protected by quote_pdf_file_guard, which raises before
-- anything is enqueued.
-- ---------------------------------------------------------------------------
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
  v_not_before timestamptz;
  v_deletion_id uuid;
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

  v_not_before := CASE
    WHEN v_file.status = 'pending'
      THEN v_file.upload_expires_at + interval '5 minutes'
    ELSE pg_catalog.now()
  END;

  IF v_file.deleted_at IS NOT NULL THEN
    v_deletion_id := files_private.enqueue_storage_deletion(
      'quote', v_file.tenant_id, v_file.quote_id, v_file.id,
      v_file.storage_key, 'user_delete', v_file.deleted_by, v_not_before
    );

    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id, 'storage_key', v_file.storage_key, 'replay', true,
      'storage_deletion_id', v_deletion_id
    );
  END IF;

  PERFORM pg_catalog.set_config('app.quote_file_action', 'delete', true);

  UPDATE public.quote_files
  SET deleted_at = pg_catalog.now(), deleted_by = v_user_id
  WHERE id = v_file.id AND tenant_id = v_file.tenant_id AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not delete file' USING ERRCODE = 'P0001';
  END IF;

  v_deletion_id := files_private.enqueue_storage_deletion(
    'quote', v_updated.tenant_id, v_updated.quote_id, v_updated.id,
    v_updated.storage_key, 'user_delete', v_user_id, v_not_before
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id, 'storage_key', v_updated.storage_key, 'replay', false,
    'storage_deletion_id', v_deletion_id
  );
END;
$function$;

COMMENT ON FUNCTION public.soft_delete_quote_file(uuid, uuid, bigint, text) IS
  'Controlled quote soft-delete. HMAC capability + marker. Idempotent. Enqueues the R2 deletion in the same transaction; official PDFs are rejected by quote_pdf_file_guard.';

REVOKE ALL ON FUNCTION public.soft_delete_quote_file(uuid, uuid, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_quote_file(uuid, uuid, bigint, text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- RPC (service_role): reserve expired pending uploads for purge.
-- Row lock + DB clock decide; COMPLETE holding the row is skipped, and a
-- COMPLETE arriving later finds no row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_expired_file_uploads(p_limit integer)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_order record;
  v_quote record;
  v_orders integer := 0;
  v_quotes integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
BEGIN
  PERFORM files_private.assert_files_maintenance_caller();

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid claim limit' USING ERRCODE = '22023';
  END IF;

  FOR v_order IN
    SELECT f.id, f.tenant_id, f.order_id, f.storage_key, f.upload_expires_at
    FROM public.order_files f
    WHERE f.status = 'pending'
      AND f.deleted_at IS NULL
      AND f.upload_expires_at < pg_catalog.now()
    ORDER BY f.upload_expires_at, f.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_order.storage_key IS DISTINCT FROM (
      'orders/' || v_order.tenant_id::text || '/' || v_order.order_id::text
      || '/' || v_order.id::text
    ) THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'claim_expired_file_uploads: storage key mismatch for order file %', v_order.id;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM files_private.enqueue_storage_deletion(
        'order', v_order.tenant_id, v_order.order_id, v_order.id,
        v_order.storage_key, 'expired_upload', NULL,
        v_order.upload_expires_at + interval '5 minutes'
      );

      DELETE FROM public.order_files
      WHERE id = v_order.id
        AND tenant_id = v_order.tenant_id
        AND status = 'pending'
        AND deleted_at IS NULL;

      v_orders := v_orders + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'claim_expired_file_uploads: order file % failed (%)', v_order.id, SQLSTATE;
    END;
  END LOOP;

  FOR v_quote IN
    SELECT f.id, f.tenant_id, f.quote_id, f.storage_key, f.upload_expires_at
    FROM public.quote_files f
    WHERE f.status = 'pending'
      AND f.deleted_at IS NULL
      AND f.upload_expires_at < pg_catalog.now()
    ORDER BY f.upload_expires_at, f.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_quote.storage_key IS DISTINCT FROM (
      'quotes/' || v_quote.tenant_id::text || '/' || v_quote.quote_id::text
      || '/' || v_quote.id::text
    ) THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'claim_expired_file_uploads: storage key mismatch for quote file %', v_quote.id;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM files_private.enqueue_storage_deletion(
        'quote', v_quote.tenant_id, v_quote.quote_id, v_quote.id,
        v_quote.storage_key, 'expired_upload', NULL,
        v_quote.upload_expires_at + interval '5 minutes'
      );

      DELETE FROM public.quote_files
      WHERE id = v_quote.id
        AND tenant_id = v_quote.tenant_id
        AND status = 'pending'
        AND deleted_at IS NULL;

      v_quotes := v_quotes + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'claim_expired_file_uploads: quote file % failed (%)', v_quote.id, SQLSTATE;
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'orders', v_orders,
    'quotes', v_quotes,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$function$;

COMMENT ON FUNCTION public.claim_expired_file_uploads(integer) IS
  'Server-only maintenance: atomically enqueues R2 deletion and removes metadata for expired pending uploads (FOR UPDATE SKIP LOCKED).';

-- ---------------------------------------------------------------------------
-- RPC (service_role): claim due deletion tasks with a lease.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_storage_deletions(
  p_limit integer,
  p_lease_seconds integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  PERFORM files_private.assert_files_maintenance_caller();
  RETURN files_private.claim_storage_deletions(NULL, p_limit, p_lease_seconds);
END;
$function$;

COMMENT ON FUNCTION public.claim_storage_deletions(integer, integer) IS
  'Server-only: leases due R2 deletion tasks (SKIP LOCKED). Refuses keys still referenced by visible metadata.';

-- Inline optimisation used right after a user deletion. Same lease protocol:
-- if a worker holds the task, nothing is returned.
CREATE OR REPLACE FUNCTION public.claim_storage_deletion(
  p_id uuid,
  p_lease_seconds integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  PERFORM files_private.assert_files_maintenance_caller();

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'deletion id required' USING ERRCODE = '22023';
  END IF;

  RETURN files_private.claim_storage_deletions(p_id, 1, p_lease_seconds);
END;
$function$;

COMMENT ON FUNCTION public.claim_storage_deletion(uuid, integer) IS
  'Server-only: leases one due R2 deletion task by id. Empty when another lease holds it or it is not due.';

-- ---------------------------------------------------------------------------
-- RPC (service_role): finish a leased task. Stale lease tokens are ignored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_storage_deletion(
  p_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_row files_private.storage_deletions%ROWTYPE;
  v_error text := files_private.storage_deletion_error_text(p_error);
BEGIN
  PERFORM files_private.assert_files_maintenance_caller();

  IF p_id IS NULL OR p_lease_token IS NULL
     OR p_outcome IS NULL OR p_outcome NOT IN ('deleted', 'retry', 'abort')
  THEN
    RAISE EXCEPTION 'invalid finish arguments' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_row
  FROM files_private.storage_deletions
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'storage deletion not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN 'already_completed';
  END IF;

  IF v_row.status IS DISTINCT FROM 'processing'
     OR v_row.lease_token IS DISTINCT FROM p_lease_token
  THEN
    PERFORM files_private.log_storage_deletion_event(
      v_row.id, 'stale_finish_ignored', v_row.attempts, p_outcome
    );
    RETURN 'stale';
  END IF;

  IF p_outcome = 'deleted' THEN
    UPDATE files_private.storage_deletions
    SET
      status = 'completed',
      completed_at = pg_catalog.now(),
      lease_token = NULL,
      lease_until = NULL,
      updated_at = pg_catalog.now()
    WHERE id = v_row.id;

    PERFORM files_private.log_storage_deletion_event(
      v_row.id, 'completed', v_row.attempts, NULL
    );
    RETURN 'completed';
  END IF;

  IF p_outcome = 'abort' OR v_row.attempts >= v_row.max_attempts THEN
    UPDATE files_private.storage_deletions
    SET
      status = 'failed',
      failed_at = pg_catalog.now(),
      lease_token = NULL,
      lease_until = NULL,
      last_error = coalesce(v_error, p_outcome),
      updated_at = pg_catalog.now()
    WHERE id = v_row.id;

    PERFORM files_private.log_storage_deletion_event(
      v_row.id, 'failed', v_row.attempts, coalesce(v_error, p_outcome)
    );
    RETURN 'failed';
  END IF;

  UPDATE files_private.storage_deletions
  SET
    status = 'pending',
    lease_token = NULL,
    lease_until = NULL,
    last_error = coalesce(v_error, 'retry'),
    next_attempt_at = pg_catalog.now() + least(
      interval '1 minute' * pg_catalog.power(2, least(v_row.attempts, 12)),
      interval '6 hours'
    ),
    updated_at = pg_catalog.now()
  WHERE id = v_row.id;

  PERFORM files_private.log_storage_deletion_event(
    v_row.id, 'retry_scheduled', v_row.attempts, coalesce(v_error, 'retry')
  );
  RETURN 'retry_scheduled';
END;
$function$;

COMMENT ON FUNCTION public.finish_storage_deletion(uuid, uuid, text, text) IS
  'Server-only: completes, reschedules or fails a leased R2 deletion task. Requires the current lease token.';

-- ---------------------------------------------------------------------------
-- RPC (service_role): backlog health for the cron response / monitoring.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_deletion_backlog()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM files_private.assert_files_maintenance_caller();

  SELECT pg_catalog.jsonb_build_object(
    'pending', count(*) FILTER (WHERE d.status = 'pending'),
    'processing', count(*) FILTER (WHERE d.status = 'processing'),
    'stale_leases', count(*) FILTER (
      WHERE d.status = 'processing' AND d.lease_until < pg_catalog.now()
    ),
    'failed', count(*) FILTER (WHERE d.status = 'failed'),
    'oldest_pending_at', min(d.requested_at) FILTER (
      WHERE d.status IN ('pending', 'processing')
    )
  )
  INTO v_result
  FROM files_private.storage_deletions d
  WHERE d.status IN ('pending', 'processing', 'failed');

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- RPC (postgres only): administrative recovery of a failed task.
-- Never touches file metadata; the claim re-checks live references.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.requeue_storage_deletion(
  p_id uuid,
  p_note text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_row files_private.storage_deletions%ROWTYPE;
  v_note text := files_private.storage_deletion_error_text(p_note);
BEGIN
  IF SESSION_USER NOT IN ('postgres', 'supabase_admin') OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'administrative access denied' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL OR v_note IS NULL THEN
    RAISE EXCEPTION 'deletion id and note required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM files_private.storage_deletions
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'storage deletion not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'only failed storage deletions can be requeued'
      USING ERRCODE = '55000';
  END IF;

  UPDATE files_private.storage_deletions
  SET
    status = 'pending',
    attempts = 0,
    failed_at = NULL,
    manual_requeues = manual_requeues + 1,
    next_attempt_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM files_private.log_storage_deletion_event(
    v_row.id, 'requeued', 0, v_note
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'manual_requeues', v_row.manual_requeues
  );
END;
$function$;

COMMENT ON FUNCTION public.requeue_storage_deletion(uuid, text) IS
  'Administrative (postgres session only): moves a failed R2 deletion task back to pending with a mandatory note.';

-- ---------------------------------------------------------------------------
-- EXECUTE grants: maintenance RPCs are never reachable by anon/authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.claim_expired_file_uploads(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_storage_deletions(integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_storage_deletion(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_storage_deletion(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_deletion_backlog()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_storage_deletion(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_expired_file_uploads(integer)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.claim_storage_deletions(integer, integer)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.claim_storage_deletion(uuid, integer)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.finish_storage_deletion(uuid, uuid, text, text)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.storage_deletion_backlog()
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.requeue_storage_deletion(uuid, text)
  TO postgres;

commit;
