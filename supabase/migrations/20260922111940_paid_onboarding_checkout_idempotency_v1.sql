-- Checkout idempotency V1 · reserve DB attempt before Stripe create
-- Does NOT modify DEMO/SUR4 rows.

-- ---------------------------------------------------------------------------
-- Schema: allow creating state + nullable session until Stripe returns
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_checkout_attempts
  DROP CONSTRAINT IF EXISTS billing_checkout_attempts_status_check;

ALTER TABLE public.billing_checkout_attempts
  DROP CONSTRAINT IF EXISTS billing_checkout_attempts_provider_session_unique;

ALTER TABLE public.billing_checkout_attempts
  ALTER COLUMN provider_session_id DROP NOT NULL;

ALTER TABLE public.billing_checkout_attempts
  ADD CONSTRAINT billing_checkout_attempts_status_check
  CHECK (
    status = any (
      array[
        'creating'::text,
        'open'::text,
        'completed'::text,
        'expired'::text,
        'canceled'::text
      ]
    )
  );

ALTER TABLE public.billing_checkout_attempts
  ADD CONSTRAINT billing_checkout_attempts_session_required_when_open
  CHECK (
    status = any (array['creating'::text, 'expired'::text, 'canceled'::text])
    OR provider_session_id is not null
  );

DROP INDEX IF EXISTS public.billing_checkout_attempts_one_open_per_tenant;

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_attempts_one_active_per_tenant
  ON public.billing_checkout_attempts (tenant_id)
  WHERE (
    status = any (array['creating'::text, 'open'::text, 'completed'::text])
  );

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_attempts_provider_session_unique
  ON public.billing_checkout_attempts (provider, provider_session_id)
  WHERE (provider_session_id is not null);

COMMENT ON TABLE public.billing_checkout_attempts IS
  'Checkout attempt reservation. creating→open→completed|expired|canceled. At most one active (creating/open/completed) per tenant.';

-- ---------------------------------------------------------------------------
-- prepare_billing_checkout_attempt_v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_billing_checkout_attempt_v2 (
  p_tenant_id uuid,
  p_plan_code text DEFAULT NULL,
  p_billing_interval text DEFAULT NULL,
  p_flow text DEFAULT 'billing'
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_active public.billing_checkout_attempts%rowtype;
  v_row public.billing_checkout_attempts%rowtype;
  v_creating_lease interval := interval '5 minutes';
  v_has_current boolean := false;
begin
  if p_tenant_id is null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'missing_tenant_id'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  -- Atomic current-subscription gate.
  select exists (
    select 1
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.provider = 'stripe'
      and s.status in ('trialing', 'active', 'past_due')
  ) into v_has_current;

  if v_has_current then
    return pg_catalog.jsonb_build_object(
      'outcome', 'current_subscription_exists',
      'code', 'current_subscription_exists'
    );
  end if;

  -- Expire timed-out creating / open attempts.
  update public.billing_checkout_attempts a
  set
    status = 'expired',
    updated_at = pg_catalog.now()
  where a.tenant_id = p_tenant_id
    and (
      (a.status = 'creating' and a.created_at <= pg_catalog.now() - v_creating_lease)
      or (a.status = 'open' and a.expires_at <= pg_catalog.now())
    );

  select * into v_active
  from public.billing_checkout_attempts a
  where a.tenant_id = p_tenant_id
    and a.status = any (array['creating'::text, 'open'::text, 'completed'::text])
  order by a.created_at desc
  limit 1
  for update;

  if found then
    if v_active.status = 'completed' then
      return pg_catalog.jsonb_build_object(
        'outcome', 'checkout_processing',
        'code', 'checkout_processing',
        'attempt_id', v_active.id,
        'provider_session_id', v_active.provider_session_id
      );
    end if;

    if v_active.status = 'creating' then
      return pg_catalog.jsonb_build_object(
        'outcome', 'reserved',
        'attempt_id', v_active.id,
        'idempotency_key', 'gestcopy-checkout:' || v_active.id::text,
        'plan_code', v_active.plan_code,
        'billing_interval', v_active.billing_interval,
        'flow', p_flow
      );
    end if;

    -- open
    return pg_catalog.jsonb_build_object(
      'outcome', 'reuse',
      'attempt_id', v_active.id,
      'provider_session_id', v_active.provider_session_id,
      'expires_at', v_active.expires_at,
      'idempotency_key', 'gestcopy-checkout:' || v_active.id::text
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
    null,
    'creating',
    nullif(pg_catalog.btrim(coalesce(p_plan_code, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_billing_interval, '')), ''),
    pg_catalog.now() + interval '24 hours'
  )
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'reserved',
    'attempt_id', v_row.id,
    'idempotency_key', 'gestcopy-checkout:' || v_row.id::text,
    'plan_code', v_row.plan_code,
    'billing_interval', v_row.billing_interval,
    'flow', p_flow
  );
end;
$function$;

COMMENT ON FUNCTION public.prepare_billing_checkout_attempt_v2(uuid, text, text, text) IS
  'Service-only: atomically reserve one checkout attempt per tenant before Stripe create.';

-- ---------------------------------------------------------------------------
-- attach session to reserved attempt (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_billing_checkout_session_v2 (
  p_attempt_id uuid,
  p_provider_session_id text,
  p_expires_at timestamptz
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_session text := nullif(pg_catalog.btrim(coalesce(p_provider_session_id, '')), '');
  v_row public.billing_checkout_attempts%rowtype;
begin
  if p_attempt_id is null or v_session is null or p_expires_at is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;

  select * into v_row
  from public.billing_checkout_attempts a
  where a.id = p_attempt_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'attempt_not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_row.tenant_id::text, 31)
  );

  -- Re-read under tenant lock.
  select * into v_row
  from public.billing_checkout_attempts a
  where a.id = p_attempt_id
  for update;

  if v_row.status = 'open'
     and v_row.provider_session_id = v_session then
    return pg_catalog.jsonb_build_object(
      'outcome', 'attached',
      'attempt_id', v_row.id,
      'provider_session_id', v_row.provider_session_id,
      'status', v_row.status,
      'idempotent', true
    );
  end if;

  if v_row.status = 'open'
     and v_row.provider_session_id is distinct from v_session then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'session_mismatch',
      'provider_session_id', v_row.provider_session_id
    );
  end if;

  if v_row.status <> 'creating' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'not_creating',
      'status', v_row.status
    );
  end if;

  update public.billing_checkout_attempts a
  set
    provider_session_id = v_session,
    status = 'open',
    expires_at = p_expires_at,
    updated_at = pg_catalog.now()
  where a.id = p_attempt_id
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'attached',
    'attempt_id', v_row.id,
    'provider_session_id', v_row.provider_session_id,
    'status', v_row.status,
    'expires_at', v_row.expires_at,
    'idempotent', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_billing_checkout_attempt_v2 (
  p_attempt_id uuid DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_status text DEFAULT NULL
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
  if v_status not in ('completed', 'expired', 'canceled') then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_status');
  end if;

  if p_attempt_id is null and v_session is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;

  if p_attempt_id is not null then
    select * into v_row
    from public.billing_checkout_attempts a
    where a.id = p_attempt_id
    for update;
  else
    select * into v_row
    from public.billing_checkout_attempts a
    where a.provider = 'stripe'
      and a.provider_session_id = v_session
    for update;
  end if;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'noop', 'reason', 'not_found');
  end if;

  if v_row.status in ('expired', 'canceled') and v_status = v_row.status then
    return pg_catalog.jsonb_build_object(
      'outcome', 'finalized',
      'status', v_row.status,
      'attempt_id', v_row.id,
      'idempotent', true
    );
  end if;

  if v_row.status = 'completed' and v_status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'finalized',
      'status', v_row.status,
      'attempt_id', v_row.id,
      'idempotent', true
    );
  end if;

  if v_row.status not in ('creating', 'open', 'completed') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'noop',
      'reason', 'already_terminal',
      'status', v_row.status
    );
  end if;

  update public.billing_checkout_attempts a
  set
    status = v_status,
    updated_at = pg_catalog.now()
  where a.id = v_row.id
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'finalized',
    'status', v_row.status,
    'attempt_id', v_row.id,
    'provider_session_id', v_row.provider_session_id
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.prepare_billing_checkout_attempt_v2(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_billing_checkout_attempt_v2(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_billing_checkout_attempt_v2(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_billing_checkout_attempt_v2(uuid, text, text, text)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.attach_billing_checkout_session_v2(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_billing_checkout_session_v2(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.attach_billing_checkout_session_v2(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.attach_billing_checkout_session_v2(uuid, text, timestamptz)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.finalize_billing_checkout_attempt_v2(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_billing_checkout_attempt_v2(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_billing_checkout_attempt_v2(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_billing_checkout_attempt_v2(uuid, text, text)
  TO postgres, service_role;
