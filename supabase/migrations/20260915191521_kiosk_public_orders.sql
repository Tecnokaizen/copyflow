-- Kiosk V1 is opt-in: a tenant is enabled only when it already has exactly
-- one active entry_channels row with code='kiosk'. This migration creates no
-- channel rows and changes no tenant configuration.
--
-- The browser cannot invoke the privileged functions directly: PostgREST only
-- exposes public, while SECURITY DEFINER functions live in kiosk_private. Public
-- SECURITY INVOKER wrappers require a short-lived HMAC capability minted by
-- the trusted Next.js/Vercel boundary.
--
-- Operational prerequisite (not stored in Git):
--   1. Store a >=32-char value in Vault as `kiosk_signing_secret`.
--   2. Configure the same value as `KIOSK_SIGNING_SECRET` in Vercel.

CREATE SCHEMA IF NOT EXISTS kiosk_private;
REVOKE ALL ON SCHEMA kiosk_private FROM PUBLIC;
REVOKE ALL ON SCHEMA kiosk_private FROM anon;
REVOKE ALL ON SCHEMA kiosk_private FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA kiosk_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE IF NOT EXISTS kiosk_private.kiosk_rate_limits (
  tenant_id uuid NOT NULL
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_key text NOT NULL
    CHECK (client_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL
    CHECK (request_count > 0),
  PRIMARY KEY (tenant_id, client_key)
);

CREATE INDEX IF NOT EXISTS kiosk_rate_limits_window_idx
  ON kiosk_private.kiosk_rate_limits (window_started_at);

REVOKE ALL ON TABLE kiosk_private.kiosk_rate_limits
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION kiosk_private.constant_time_equal(
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

CREATE OR REPLACE FUNCTION kiosk_private.verify_kiosk_capability(
  p_tenant_slug text,
  p_client_key text,
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
  IF p_tenant_slug IS NULL
     OR p_tenant_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     OR p_client_key IS NULL
     OR p_client_key !~ '^[a-f0-9]{64}$'
     OR p_signature IS NULL
     OR p_signature !~ '^[a-f0-9]{64}$'
     OR p_issued_at IS NULL
     OR abs(
       extract(epoch FROM pg_catalog.now())::numeric - p_issued_at::numeric
     ) > 300 THEN
    RETURN false;
  END IF;

  SELECT ds.decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'kiosk_signing_secret'
  ORDER BY ds.updated_at DESC
  LIMIT 1;

  IF v_secret IS NULL OR octet_length(v_secret) < 32 THEN
    RETURN false;
  END IF;

  v_message :=
    'kiosk-v1|' || p_tenant_slug || '|' || p_client_key || '|' || p_issued_at;
  v_expected := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_message, 'UTF8'),
      pg_catalog.convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  RETURN kiosk_private.constant_time_equal(v_expected, p_signature);
END;
$function$;

CREATE OR REPLACE FUNCTION kiosk_private.kiosk_bootstrap(
  p_tenant_slug text,
  p_client_key text,
  p_issued_at bigint,
  p_signature text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_tenant public.tenants%rowtype;
  v_status_count integer;
  v_channel_count integer;
  v_services jsonb;
BEGIN
  IF NOT kiosk_private.verify_kiosk_capability(
    p_tenant_slug, p_client_key, p_issued_at, p_signature
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  SELECT t.*
  INTO v_tenant
  FROM public.tenants t
  WHERE t.slug = p_tenant_slug
    AND t.active = true;

  IF v_tenant.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  SELECT count(*)
  INTO v_status_count
  FROM public.order_statuses os
  WHERE os.tenant_id = v_tenant.id
    AND os.active = true
    AND os.is_initial = true;

  SELECT count(*)
  INTO v_channel_count
  FROM public.entry_channels ec
  WHERE ec.tenant_id = v_tenant.id
    AND ec.active = true
    AND ec.code = 'kiosk';

  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', s.id, 'name', s.name)
      ORDER BY s.sort_order, s.name
    ),
    '[]'::jsonb
  )
  INTO v_services
  FROM public.services s
  WHERE s.tenant_id = v_tenant.id
    AND s.active = true;

  IF v_status_count <> 1
     OR v_channel_count <> 1
     OR pg_catalog.jsonb_array_length(v_services) = 0 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'ready',
    'tenant', pg_catalog.jsonb_build_object('name', v_tenant.name),
    'services', v_services
  );
END;
$function$;

CREATE OR REPLACE FUNCTION kiosk_private.submit_kiosk_order(
  p_tenant_slug text,
  p_client_key text,
  p_issued_at bigint,
  p_signature text,
  p_submission_id uuid,
  p_request_fingerprint text,
  p_title text,
  p_service_id uuid,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_description text,
  p_due_at timestamptz,
  p_observations text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_tenant public.tenants%rowtype;
  v_service public.services%rowtype;
  v_status_ids uuid[];
  v_channel_ids uuid[];
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_count integer;
  v_locked_id uuid;
  v_notes text;
BEGIN
  IF NOT kiosk_private.verify_kiosk_capability(
    p_tenant_slug, p_client_key, p_issued_at, p_signature
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  IF p_submission_id IS NULL
     OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
     OR nullif(pg_catalog.btrim(p_title), '') IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_title)) > 80
     OR p_service_id IS NULL
     OR nullif(pg_catalog.btrim(p_contact_name), '') IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_contact_name)) > 120
     OR (
       nullif(pg_catalog.btrim(p_contact_email), '') IS NULL
       AND nullif(pg_catalog.btrim(p_contact_phone), '') IS NULL
     )
     OR pg_catalog.char_length(coalesce(pg_catalog.btrim(p_contact_email), '')) > 254
     OR pg_catalog.char_length(coalesce(pg_catalog.btrim(p_contact_phone), '')) > 40
     OR nullif(pg_catalog.btrim(p_description), '') IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_description)) > 4000
     OR pg_catalog.char_length(coalesce(pg_catalog.btrim(p_observations), '')) > 2000 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_request');
  END IF;

  SELECT t.*
  INTO v_tenant
  FROM public.tenants t
  WHERE t.slug = p_tenant_slug
    AND t.active = true
  FOR SHARE;

  IF v_tenant.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  -- A submission lock makes replays deterministic even if the client IP
  -- changes. The client lock serializes the distributed rate counter.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kiosk-submission:' || p_submission_id, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'kiosk-client:' || v_tenant.id::text || ':' || p_client_key,
      0
    )
  );

  SELECT o.*
  INTO v_existing
  FROM public.orders o
  WHERE o.id = p_submission_id
    AND o.tenant_id = v_tenant.id;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.metadata ->> 'source' = 'kiosk'
       AND v_existing.metadata #>> '{kiosk,request_fingerprint}'
         = p_request_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'replay',
        'reference', v_existing.reference
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;

  DELETE FROM kiosk_private.kiosk_rate_limits rl
  WHERE rl.window_started_at < pg_catalog.now() - interval '1 day';

  INSERT INTO kiosk_private.kiosk_rate_limits AS rl (
    tenant_id,
    client_key,
    window_started_at,
    request_count
  )
  VALUES (
    v_tenant.id,
    p_client_key,
    pg_catalog.now(),
    1
  )
  ON CONFLICT (tenant_id, client_key)
  DO UPDATE SET
    window_started_at = CASE
      WHEN rl.window_started_at <= pg_catalog.now() - interval '1 minute'
        THEN pg_catalog.now()
      ELSE rl.window_started_at
    END,
    request_count = CASE
      WHEN rl.window_started_at <= pg_catalog.now() - interval '1 minute'
        THEN 1
      ELSE rl.request_count + 1
    END
  RETURNING request_count INTO v_count;

  IF v_count > 5 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'rate_limited');
  END IF;

  SELECT s.*
  INTO v_service
  FROM public.services s
  WHERE s.id = p_service_id
    AND s.tenant_id = v_tenant.id
    AND s.active = true
  FOR SHARE;

  IF v_service.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_service');
  END IF;

  v_status_ids := ARRAY[]::uuid[];
  FOR v_locked_id IN
    SELECT os.id
    FROM public.order_statuses os
    WHERE os.tenant_id = v_tenant.id
      AND os.active = true
      AND os.is_initial = true
    FOR SHARE
  LOOP
    v_status_ids := pg_catalog.array_append(v_status_ids, v_locked_id);
  END LOOP;

  v_channel_ids := ARRAY[]::uuid[];
  FOR v_locked_id IN
    SELECT ec.id
    FROM public.entry_channels ec
    WHERE ec.tenant_id = v_tenant.id
      AND ec.active = true
      AND ec.code = 'kiosk'
    FOR SHARE
  LOOP
    v_channel_ids := pg_catalog.array_append(v_channel_ids, v_locked_id);
  END LOOP;

  IF coalesce(pg_catalog.cardinality(v_status_ids), 0) <> 1
     OR coalesce(pg_catalog.cardinality(v_channel_ids), 0) <> 1 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;

  v_notes := pg_catalog.concat_ws(
    E'\n',
    'Solicitud Kiosk',
    'Contacto: ' || pg_catalog.btrim(p_contact_name),
    CASE
      WHEN nullif(pg_catalog.btrim(p_contact_email), '') IS NOT NULL
        THEN 'Email: ' || pg_catalog.lower(pg_catalog.btrim(p_contact_email))
    END,
    CASE
      WHEN nullif(pg_catalog.btrim(p_contact_phone), '') IS NOT NULL
        THEN 'Teléfono: ' || pg_catalog.btrim(p_contact_phone)
    END,
    CASE
      WHEN nullif(pg_catalog.btrim(p_observations), '') IS NOT NULL
        THEN 'Observaciones: ' || pg_catalog.btrim(p_observations)
    END
  );

  -- The audit trigger accepts actor-less Kiosk inserts only after this
  -- transaction-local marker has been set by the signed private function.
  PERFORM pg_catalog.set_config('app.kiosk_submission', 'validated', true);

  INSERT INTO public.orders (
    id,
    tenant_id,
    title,
    description,
    service_id,
    status_id,
    entry_channel_id,
    priority,
    due_at,
    notes,
    metadata,
    created_by
  )
  VALUES (
    p_submission_id,
    v_tenant.id,
    pg_catalog.btrim(p_title),
    pg_catalog.btrim(p_description),
    v_service.id,
    v_status_ids[1],
    v_channel_ids[1],
    'normal',
    p_due_at,
    v_notes,
    pg_catalog.jsonb_build_object(
      'source', 'kiosk',
      'kiosk', pg_catalog.jsonb_build_object(
        'submission_id', p_submission_id,
        'request_fingerprint', p_request_fingerprint,
        'client_key', p_client_key,
        'contact', pg_catalog.jsonb_build_object(
          'name', pg_catalog.btrim(p_contact_name),
          'email', nullif(pg_catalog.lower(pg_catalog.btrim(p_contact_email)), ''),
          'phone', nullif(pg_catalog.btrim(p_contact_phone), '')
        )
      )
    ),
    NULL
  )
  RETURNING * INTO v_order;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'created',
    'reference', v_order.reference
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
END;
$function$;

-- Existing internal audit behavior is preserved. The only new branch requires
-- a transaction-local marker set after a valid signed capability.
CREATE OR REPLACE FUNCTION public.tg_activity_log_order_created()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_kiosk boolean :=
    v_actor IS NULL
    AND coalesce(
      pg_catalog.current_setting('app.kiosk_submission', true),
      ''
    ) = 'validated'
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

CREATE OR REPLACE FUNCTION public.kiosk_bootstrap(
  p_tenant_slug text,
  p_client_key text,
  p_issued_at bigint,
  p_signature text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
    SELECT kiosk_private.kiosk_bootstrap($1, $2, $3, $4);
$function$;

CREATE OR REPLACE FUNCTION public.submit_kiosk_order(
  p_tenant_slug text,
  p_client_key text,
  p_issued_at bigint,
  p_signature text,
  p_submission_id uuid,
  p_request_fingerprint text,
  p_title text,
  p_service_id uuid,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_description text,
  p_due_at timestamptz,
  p_observations text
)
  RETURNS jsonb
  LANGUAGE sql
  VOLATILE
  SECURITY INVOKER
  SET search_path TO ''
  AS $function$
    SELECT kiosk_private.submit_kiosk_order(
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
    );
$function$;

REVOKE ALL ON FUNCTION kiosk_private.constant_time_equal(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION kiosk_private.verify_kiosk_capability(text, text, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION kiosk_private.kiosk_bootstrap(text, text, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION kiosk_private.submit_kiosk_order(
  text, text, bigint, text, uuid, text, text, uuid, text, text, text, text,
  timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA kiosk_private TO anon;
GRANT EXECUTE ON FUNCTION kiosk_private.kiosk_bootstrap(text, text, bigint, text)
  TO anon;
GRANT EXECUTE ON FUNCTION kiosk_private.submit_kiosk_order(
  text, text, bigint, text, uuid, text, text, uuid, text, text, text, text,
  timestamptz, text
) TO anon;

REVOKE ALL ON FUNCTION public.kiosk_bootstrap(text, text, bigint, text)
  FROM PUBLIC, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_kiosk_order(
  text, text, bigint, text, uuid, text, text, uuid, text, text, text, text,
  timestamptz, text
) FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_bootstrap(text, text, bigint, text)
  TO anon;
GRANT EXECUTE ON FUNCTION public.submit_kiosk_order(
  text, text, bigint, text, uuid, text, text, uuid, text, text, text, text,
  timestamptz, text
) TO anon;

REVOKE ALL ON FUNCTION public.tg_activity_log_order_created() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_activity_log_order_created()
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_activity_log_order_created() TO postgres;
