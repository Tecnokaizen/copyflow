-- Checkout creating recovery · expire only after reserved provider lifetime
-- Does NOT modify DEMO/SUR4 rows.

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
  -- Small grace after provider expiry for clock skew; NOT a creating-only soft lease.
  v_expiry_grace interval := interval '2 minutes';
  -- Stripe Checkout expires_at must be between 30m and 24h from Session creation.
  v_provider_lifetime interval := interval '23 hours 30 minutes';
  v_has_current boolean := false;
  v_expires_at timestamptz;
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

  -- Expire only after deterministic provider lifetime (+ grace).
  -- creating must NOT expire based on created_at alone.
  update public.billing_checkout_attempts a
  set
    status = 'expired',
    updated_at = pg_catalog.now()
  where a.tenant_id = p_tenant_id
    and a.status = any (array['creating'::text, 'open'::text])
    and a.expires_at + v_expiry_grace <= pg_catalog.now();

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
        'expires_at', v_active.expires_at,
        'plan_code', v_active.plan_code,
        'billing_interval', v_active.billing_interval,
        'flow', p_flow
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'reuse',
      'attempt_id', v_active.id,
      'provider_session_id', v_active.provider_session_id,
      'expires_at', v_active.expires_at,
      'idempotency_key', 'gestcopy-checkout:' || v_active.id::text
    );
  end if;

  v_expires_at := pg_catalog.now() + v_provider_lifetime;

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
    v_expires_at
  )
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'reserved',
    'attempt_id', v_row.id,
    'idempotency_key', 'gestcopy-checkout:' || v_row.id::text,
    'expires_at', v_row.expires_at,
    'plan_code', v_row.plan_code,
    'billing_interval', v_row.billing_interval,
    'flow', p_flow
  );
end;
$function$;

COMMENT ON FUNCTION public.prepare_billing_checkout_attempt_v2(uuid, text, text, text) IS
  'Service-only: reserve checkout attempt with deterministic provider expires_at before Stripe create. creating stays resumable until that expiry (+ grace).';

-- Keep reserved expires_at on attach (do not overwrite with a different value).
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
      'expires_at', v_row.expires_at,
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

  -- Preserve the reserved provider expires_at (authoritative for recovery).
  update public.billing_checkout_attempts a
  set
    provider_session_id = v_session,
    status = 'open',
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
