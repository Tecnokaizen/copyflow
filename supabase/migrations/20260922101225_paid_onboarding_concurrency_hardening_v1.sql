-- Paid onboarding concurrency hardening V1
-- 1) Webhook processing lease (processing_started_at + attempt)
-- 2) Stale-finalizer protection
-- 3) Checkout pending-attempt guard
-- Does NOT modify DEMO/SUR4 rows.

-- ---------------------------------------------------------------------------
-- 1. Webhook lease columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS processing_attempt integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.billing_webhook_events.processing_started_at IS
  'Lease start for the current processing attempt. Used for freshness; received_at stays original.';
COMMENT ON COLUMN public.billing_webhook_events.processing_attempt IS
  'Monotonic claim counter. Finalize must match this attempt.';

-- Backfill: treat existing processing rows as leased now if missing.
UPDATE public.billing_webhook_events
SET processing_started_at = coalesce(processing_started_at, received_at, now())
WHERE status = 'processing'
  AND processing_started_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. claim / finalize with lease + attempt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_billing_webhook_event_v1 (
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_provider_created_at timestamptz DEFAULT NULL,
  p_object_id text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_provider text := nullif(pg_catalog.btrim(coalesce(p_provider, '')), '');
  v_event_id text := nullif(pg_catalog.btrim(coalesce(p_provider_event_id, '')), '');
  v_row public.billing_webhook_events%rowtype;
  v_inserted boolean := false;
  v_lease interval := interval '2 minutes';
begin
  if v_provider is null or v_event_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_provider || ':' || v_event_id, 23)
  );

  begin
    insert into public.billing_webhook_events (
      provider,
      provider_event_id,
      event_type,
      livemode,
      provider_created_at,
      object_id,
      status,
      retryable,
      processing_started_at,
      processing_attempt
    ) values (
      v_provider,
      v_event_id,
      coalesce(nullif(pg_catalog.btrim(p_event_type), ''), 'unknown'),
      coalesce(p_livemode, false),
      p_provider_created_at,
      nullif(pg_catalog.btrim(coalesce(p_object_id, '')), ''),
      'processing',
      false,
      pg_catalog.now(),
      1
    )
    returning * into v_row;
    v_inserted := true;
  exception
    when unique_violation then
      v_inserted := false;
  end;

  if v_inserted then
    return pg_catalog.jsonb_build_object(
      'outcome', 'claimed',
      'status', v_row.status,
      'attempt', v_row.processing_attempt,
      'processing_started_at', v_row.processing_started_at,
      'provider_event_id', v_event_id
    );
  end if;

  select * into v_row
  from public.billing_webhook_events e
  where e.provider = v_provider
    and e.provider_event_id = v_event_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_row');
  end if;

  if v_row.status in ('processed', 'ignored') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_final',
      'status', v_row.status,
      'attempt', v_row.processing_attempt,
      'provider_event_id', v_event_id
    );
  end if;

  -- Fresh processing lease uses processing_started_at (not received_at).
  if v_row.status = 'processing'
     and v_row.processing_started_at is not null
     and v_row.processing_started_at > (pg_catalog.now() - v_lease) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'in_progress',
      'status', v_row.status,
      'attempt', v_row.processing_attempt,
      'processing_started_at', v_row.processing_started_at,
      'provider_event_id', v_event_id
    );
  end if;

  if v_row.status = 'failed' and v_row.retryable is not true then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_final',
      'status', v_row.status,
      'retryable', false,
      'error_code', v_row.error_code,
      'attempt', v_row.processing_attempt,
      'provider_event_id', v_event_id
    );
  end if;

  -- Reclaim: retryable failed OR stale processing.
  update public.billing_webhook_events e
  set
    status = 'processing',
    retryable = false,
    error_code = null,
    processed_at = null,
    processing_started_at = pg_catalog.now(),
    processing_attempt = e.processing_attempt + 1,
    event_type = coalesce(nullif(pg_catalog.btrim(p_event_type), ''), e.event_type),
    object_id = coalesce(
      nullif(pg_catalog.btrim(coalesce(p_object_id, '')), ''),
      e.object_id
    )
  where e.id = v_row.id
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'claimed',
    'status', v_row.status,
    'attempt', v_row.processing_attempt,
    'processing_started_at', v_row.processing_started_at,
    'reclaimed', true,
    'provider_event_id', v_event_id
  );
end;
$function$;

-- Drop previous finalize signature (no attempt) and recreate with attempt match.
DROP FUNCTION IF EXISTS public.finalize_billing_webhook_event_v1(text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.finalize_billing_webhook_event_v1 (
  p_provider text,
  p_provider_event_id text,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_retryable boolean DEFAULT false,
  p_processing_attempt integer DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_provider text := nullif(pg_catalog.btrim(coalesce(p_provider, '')), '');
  v_event_id text := nullif(pg_catalog.btrim(coalesce(p_provider_event_id, '')), '');
  v_status text := nullif(pg_catalog.btrim(coalesce(p_status, '')), '');
  v_row public.billing_webhook_events%rowtype;
  v_attempt integer := p_processing_attempt;
begin
  if v_provider is null or v_event_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;

  if v_status not in ('processed', 'ignored', 'failed') then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_status');
  end if;

  if v_attempt is null or v_attempt < 1 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_attempt');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_provider || ':' || v_event_id, 23)
  );

  update public.billing_webhook_events e
  set
    status = v_status,
    error_code = nullif(pg_catalog.btrim(coalesce(p_error_code, '')), ''),
    retryable = case when v_status = 'failed' then coalesce(p_retryable, false) else false end,
    processed_at = pg_catalog.now()
  where e.provider = v_provider
    and e.provider_event_id = v_event_id
    and e.status = 'processing'
    and e.processing_attempt = v_attempt
  returning * into v_row;

  if not found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'stale_claim',
      'reason', 'attempt_mismatch_or_not_processing',
      'attempt', v_attempt,
      'provider_event_id', v_event_id
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'finalized',
    'status', v_row.status,
    'retryable', v_row.retryable,
    'attempt', v_row.processing_attempt,
    'provider_event_id', v_event_id
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean, integer) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean, integer)
  TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Checkout pending attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_session_id text NOT NULL,
  status text NOT NULL,
  plan_code text,
  billing_interval text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_checkout_attempts_provider_check
    CHECK (provider = 'stripe'),
  CONSTRAINT billing_checkout_attempts_status_check
    CHECK (
      status = any (
        array[
          'open'::text,
          'completed'::text,
          'expired'::text,
          'canceled'::text
        ]
      )
    ),
  CONSTRAINT billing_checkout_attempts_provider_session_unique
    UNIQUE (provider, provider_session_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_attempts_one_open_per_tenant
  ON public.billing_checkout_attempts (tenant_id)
  WHERE (status = 'open');

CREATE INDEX IF NOT EXISTS billing_checkout_attempts_tenant_created_idx
  ON public.billing_checkout_attempts (tenant_id, created_at desc);

COMMENT ON TABLE public.billing_checkout_attempts IS
  'Outstanding Stripe Checkout Sessions per tenant. Prevents concurrent usable sessions. No secrets.';

ALTER TABLE public.billing_checkout_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_checkout_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.billing_checkout_attempts FROM anon;
REVOKE ALL ON TABLE public.billing_checkout_attempts FROM authenticated;
GRANT ALL ON TABLE public.billing_checkout_attempts TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.prepare_billing_checkout_attempt_v1 (
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_open public.billing_checkout_attempts%rowtype;
begin
  if p_tenant_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_tenant_id');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  -- Expire locally timed-out open attempts.
  update public.billing_checkout_attempts a
  set
    status = 'expired',
    updated_at = pg_catalog.now()
  where a.tenant_id = p_tenant_id
    and a.status = 'open'
    and a.expires_at <= pg_catalog.now();

  select * into v_open
  from public.billing_checkout_attempts a
  where a.tenant_id = p_tenant_id
    and a.status = 'open'
  order by a.created_at desc
  limit 1
  for update;

  if found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'reuse',
      'provider_session_id', v_open.provider_session_id,
      'expires_at', v_open.expires_at,
      'attempt_id', v_open.id
    );
  end if;

  return pg_catalog.jsonb_build_object('outcome', 'create');
end;
$function$;

CREATE OR REPLACE FUNCTION public.register_billing_checkout_attempt_v1 (
  p_tenant_id uuid,
  p_provider_session_id text,
  p_expires_at timestamptz,
  p_plan_code text DEFAULT NULL,
  p_billing_interval text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_session text := nullif(pg_catalog.btrim(coalesce(p_provider_session_id, '')), '');
  v_open public.billing_checkout_attempts%rowtype;
  v_row public.billing_checkout_attempts%rowtype;
begin
  if p_tenant_id is null or v_session is null or p_expires_at is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  update public.billing_checkout_attempts a
  set
    status = 'expired',
    updated_at = pg_catalog.now()
  where a.tenant_id = p_tenant_id
    and a.status = 'open'
    and a.expires_at <= pg_catalog.now();

  select * into v_open
  from public.billing_checkout_attempts a
  where a.tenant_id = p_tenant_id
    and a.status = 'open'
  for update;

  if found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'reuse',
      'provider_session_id', v_open.provider_session_id,
      'expires_at', v_open.expires_at,
      'attempt_id', v_open.id
    );
  end if;

  insert into public.billing_checkout_attempts (
    tenant_id,
    provider,
    provider_session_id,
    status,
    plan_code,
    billing_interval,
    expires_at
  ) values (
    p_tenant_id,
    'stripe',
    v_session,
    'open',
    nullif(pg_catalog.btrim(coalesce(p_plan_code, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_billing_interval, '')), ''),
    p_expires_at
  )
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'registered',
    'provider_session_id', v_row.provider_session_id,
    'attempt_id', v_row.id,
    'expires_at', v_row.expires_at
  );
exception
  when unique_violation then
    select * into v_open
    from public.billing_checkout_attempts a
    where a.tenant_id = p_tenant_id
      and a.status = 'open'
    limit 1;

    if found then
      return pg_catalog.jsonb_build_object(
        'outcome', 'reuse',
        'provider_session_id', v_open.provider_session_id,
        'expires_at', v_open.expires_at,
        'attempt_id', v_open.id
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'unique_violation'
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_billing_checkout_attempt_v1 (
  p_provider_session_id text,
  p_status text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_session text := nullif(pg_catalog.btrim(coalesce(p_provider_session_id, '')), '');
  v_status text := nullif(pg_catalog.btrim(coalesce(p_status, '')), '');
  v_row public.billing_checkout_attempts%rowtype;
begin
  if v_session is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_session');
  end if;

  if v_status not in ('completed', 'expired', 'canceled') then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_status');
  end if;

  update public.billing_checkout_attempts a
  set
    status = v_status,
    updated_at = pg_catalog.now()
  where a.provider = 'stripe'
    and a.provider_session_id = v_session
    and a.status = 'open'
  returning * into v_row;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'noop', 'reason', 'not_open');
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'finalized',
    'status', v_row.status,
    'provider_session_id', v_row.provider_session_id
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.prepare_billing_checkout_attempt_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_billing_checkout_attempt_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_billing_checkout_attempt_v1(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_billing_checkout_attempt_v1(uuid)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.register_billing_checkout_attempt_v1(uuid, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_billing_checkout_attempt_v1(uuid, text, timestamptz, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.register_billing_checkout_attempt_v1(uuid, text, timestamptz, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_billing_checkout_attempt_v1(uuid, text, timestamptz, text, text)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.finalize_billing_checkout_attempt_v1(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_billing_checkout_attempt_v1(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_billing_checkout_attempt_v1(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_billing_checkout_attempt_v1(text, text)
  TO postgres, service_role;
