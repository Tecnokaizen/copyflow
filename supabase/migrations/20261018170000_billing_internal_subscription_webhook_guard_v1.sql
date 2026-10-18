-- Billing internal subscription webhook guard V1 · D1 (DRAFT, owner decision pending)
-- Does NOT modify DEMO/SUR4 rows. Changes no existing row at migration time.
--
-- Problem: sync_billing_subscription_v1 ("one current") cancels ANY current row
-- of the tenant when a current Stripe subscription arrives, including internal
-- trials and pilots (SUR4: internal trialing). The checkout guard of #132 only
-- stops new sessions; sessions opened before it, or subscriptions created in
-- Stripe outside the app with metadata tenant_id, still reach the webhook.
--
-- Option B (hold with alert), implemented here:
--   * sync never cancels a current non-Stripe row: it writes nothing and
--     returns outcome 'held'; the webhook records the event as failed without
--     retry (internal_subscription_current) and logs an alert;
--   * sync and prepare share the tenant billing lock (key 31, was 4242 in
--     sync); prepare also refuses Checkout while a current non-Stripe row
--     exists, so the app guard of #132 now has an authoritative twin in-lock;
--   * requeue_billing_webhook_event_v1 lets an operator make a held event
--     retryable again once the internal row is closed, so a Stripe "Resend"
--     reprocesses it.
--
-- Effect in Stripe (unchanged by this migration, see the D1 decision doc): the
-- customer was charged and the Stripe subscription stays active until an
-- operator either closes the internal row and requeues, or cancels/refunds in
-- Stripe. Stripe does not retry the held event.

begin;

-- ---------------------------------------------------------------------------
-- sync_billing_subscription_v1 · hold instead of canceling internal rows
-- ---------------------------------------------------------------------------
create or replace function public.sync_billing_subscription_v1 (
  p_tenant_id uuid,
  p_plan_id uuid,
  p_provider text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_status text,
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_metadata jsonb default '{}'::jsonb,
  p_provider_event_created_at timestamptz default null,
  p_cancel_at timestamptz default null,
  p_livemode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_current_statuses text[] := array['trialing', 'active', 'past_due'];
  v_allowed_statuses text[] := array[
    'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'paused'
  ];
  v_existing public.subscriptions%rowtype;
  v_id uuid;
  v_is_current boolean;
  v_provider text;
  v_livemode boolean := coalesce(p_livemode, false);
  v_internal public.subscriptions%rowtype;
begin
  if p_tenant_id is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if p_plan_id is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  v_provider := nullif(pg_catalog.btrim(coalesce(p_provider, '')), '');
  if v_provider is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if p_status is null or p_status <> all (v_allowed_statuses) then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.plans p where p.id = p_plan_id
  ) then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  -- Shared billing lock per tenant (same key as prepare_billing_checkout_attempt_v2):
  -- the internal-subscription check here and in prepare cannot interleave.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  v_is_current := p_status = any (v_current_statuses);

  if nullif(pg_catalog.btrim(coalesce(p_provider_subscription_id, '')), '') is not null then
    select *
    into v_existing
    from public.subscriptions s
    where s.provider = v_provider
      and s.provider_subscription_id = p_provider_subscription_id
    for update;

    if found and v_existing.tenant_id <> p_tenant_id then
      raise exception 'provider subscription belongs to another tenant'
        using errcode = '23514';
    end if;

    -- Fail closed: never move a subscription row between Test and Live.
    if found and v_existing.livemode is distinct from v_livemode then
      raise exception 'subscription livemode mismatch'
        using errcode = '23514';
    end if;
  end if;

  if v_existing.id is not null
     and p_provider_event_created_at is not null
     and v_existing.provider_event_created_at is not null
     and p_provider_event_created_at < v_existing.provider_event_created_at
  then
    return pg_catalog.jsonb_build_object(
      'subscription_id', v_existing.id,
      'tenant_id', p_tenant_id,
      'plan_id', v_existing.plan_id,
      'provider', v_provider,
      'status', v_existing.status,
      'livemode', v_existing.livemode,
      'stale', true
    );
  end if;

  if v_is_current then
    -- A provider sync never cancels a current non-Stripe row (internal trial or
    -- pilot, mvp, NULL provider). Hold: nothing is written, the caller records
    -- the event as failed without retry and alerts an operator.
    select * into v_internal
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.status = any (v_current_statuses)
      and s.provider is distinct from 'stripe'
    limit 1
    for update;

    if found then
      return pg_catalog.jsonb_build_object(
        'outcome', 'held',
        'code', 'internal_subscription_current',
        'held', true,
        'stale', false,
        'tenant_id', p_tenant_id,
        'internal_subscription_id', v_internal.id,
        'provider', v_provider,
        'provider_subscription_id', p_provider_subscription_id,
        'status', p_status,
        'livemode', v_livemode
      );
    end if;

    -- One-current among Stripe rows: a new current cancels the prior one
    -- (including Test when Live arrives).
    update public.subscriptions s
    set
      status = 'canceled',
      updated_at = pg_catalog.now()
    where s.tenant_id = p_tenant_id
      and s.provider = 'stripe'
      and s.status = any (v_current_statuses)
      and (
        v_existing.id is null
        or s.id <> v_existing.id
      );
  end if;

  if v_existing.id is not null then
    update public.subscriptions s
    set
      plan_id = p_plan_id,
      provider = v_provider,
      provider_customer_id = p_provider_customer_id,
      provider_subscription_id = p_provider_subscription_id,
      status = p_status,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      cancel_at = p_cancel_at,
      livemode = v_livemode,
      metadata = coalesce(p_metadata, '{}'::jsonb),
      provider_event_created_at = coalesce(
        p_provider_event_created_at,
        s.provider_event_created_at
      ),
      updated_at = pg_catalog.now()
    where s.id = v_existing.id
    returning s.id into v_id;
  else
    insert into public.subscriptions (
      tenant_id,
      plan_id,
      provider,
      provider_customer_id,
      provider_subscription_id,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      cancel_at,
      livemode,
      metadata,
      provider_event_created_at
    )
    values (
      p_tenant_id,
      p_plan_id,
      v_provider,
      p_provider_customer_id,
      p_provider_subscription_id,
      p_status,
      p_current_period_start,
      p_current_period_end,
      coalesce(p_cancel_at_period_end, false),
      p_cancel_at,
      v_livemode,
      coalesce(p_metadata, '{}'::jsonb),
      p_provider_event_created_at
    )
    returning id into v_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'subscription_id', v_id,
    'tenant_id', p_tenant_id,
    'plan_id', p_plan_id,
    'provider', v_provider,
    'status', p_status,
    'livemode', v_livemode,
    'stale', false
  );
end;
$function$;

comment on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean
) is
  'DEFINER service-only: sync provider subscription atomically under the shared tenant billing lock (key 31). Persists livemode; rejects moving a provider_subscription_id between Test and Live. Persists cancel_at. Rejects stale provider_event_created_at. Never cancels a current non-Stripe subscription: returns outcome held (code internal_subscription_current) without writing.';

revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean
) from public;
revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean
) from anon;
revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean
) from authenticated;

grant execute on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean
) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- prepare_billing_checkout_attempt_v2 · internal check under the shared lock
-- ---------------------------------------------------------------------------
create or replace function public.prepare_billing_checkout_attempt_v2 (
  p_tenant_id uuid,
  p_plan_code text default null,
  p_billing_interval text default null,
  p_flow text default 'billing',
  p_livemode boolean default false
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_active public.billing_checkout_attempts%rowtype;
  v_row public.billing_checkout_attempts%rowtype;
  v_expiry_grace interval := interval '2 minutes';
  v_provider_lifetime interval := interval '23 hours 30 minutes';
  v_has_current boolean := false;
  v_expires_at timestamptz;
  v_livemode boolean := coalesce(p_livemode, false);
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

  -- A current non-Stripe subscription (internal trial or pilot, mvp, NULL
  -- provider) blocks Checkout in every mode. Same check as the app guard
  -- (lib/billing/current-subscription.ts), here under the shared tenant lock.
  if exists (
    select 1
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.provider is distinct from 'stripe'
      and s.status in ('trialing', 'active', 'past_due')
  ) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'internal_subscription_current',
      'code', 'internal_subscription_current'
    );
  end if;

  -- Current Stripe subscription blocks Checkout only for the requested mode.
  select exists (
    select 1
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.provider = 'stripe'
      and s.livemode = v_livemode
      and s.status in ('trialing', 'active', 'past_due')
  ) into v_has_current;

  if v_has_current then
    return pg_catalog.jsonb_build_object(
      'outcome', 'current_subscription_exists',
      'code', 'current_subscription_exists'
    );
  end if;

  -- Expire only attempts in the requested mode after provider lifetime (+ grace).
  update public.billing_checkout_attempts a
  set
    status = 'expired',
    updated_at = pg_catalog.now()
  where a.tenant_id = p_tenant_id
    and a.livemode = v_livemode
    and a.status = any (array['creating'::text, 'open'::text])
    and a.expires_at + v_expiry_grace <= pg_catalog.now();

  -- Settle a completed attempt once its subscription was recorded and ended:
  -- at least one Stripe row in this mode created since the attempt was
  -- reserved, and all of them canceled. Older subscriptions never count, so a
  -- late event on a previous subscription cannot release a pending checkout.
  update public.billing_checkout_attempts a
  set
    status = 'settled',
    updated_at = pg_catalog.now()
  where a.tenant_id = p_tenant_id
    and a.livemode = v_livemode
    and a.status = 'completed'
    and exists (
      select 1
      from public.subscriptions s
      where s.tenant_id = a.tenant_id
        and s.provider = 'stripe'
        and s.livemode = a.livemode
        and s.created_at >= a.created_at
    )
    and not exists (
      select 1
      from public.subscriptions s
      where s.tenant_id = a.tenant_id
        and s.provider = 'stripe'
        and s.livemode = a.livemode
        and s.created_at >= a.created_at
        and s.status <> 'canceled'
    );

  select * into v_active
  from public.billing_checkout_attempts a
  where a.tenant_id = p_tenant_id
    and a.livemode = v_livemode
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
        'flow', p_flow,
        'livemode', v_active.livemode
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'reuse',
      'attempt_id', v_active.id,
      'provider_session_id', v_active.provider_session_id,
      'expires_at', v_active.expires_at,
      'idempotency_key', 'gestcopy-checkout:' || v_active.id::text,
      'livemode', v_active.livemode
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
    expires_at,
    livemode
  ) values (
    p_tenant_id,
    'stripe',
    null,
    'creating',
    nullif(pg_catalog.btrim(coalesce(p_plan_code, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_billing_interval, '')), ''),
    v_expires_at,
    v_livemode
  )
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'reserved',
    'attempt_id', v_row.id,
    'idempotency_key', 'gestcopy-checkout:' || v_row.id::text,
    'expires_at', v_row.expires_at,
    'plan_code', v_row.plan_code,
    'billing_interval', v_row.billing_interval,
    'flow', p_flow,
    'livemode', v_row.livemode
  );
end;
$function$;

comment on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) is
  'Service-only: reserve checkout attempt scoped by livemode. creating stays resumable until provider expiry (+ grace). completed blocks (checkout_processing) until its subscription is recorded and ended, then becomes settled. Test current/attempt does not block Live Checkout. A current non-Stripe subscription blocks every mode (internal_subscription_current). Shares the tenant billing lock (key 31) with sync_billing_subscription_v1.';

revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from public;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from anon;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from authenticated;

grant execute on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- requeue_billing_webhook_event_v1 · operator path for held events
-- ---------------------------------------------------------------------------
create or replace function public.requeue_billing_webhook_event_v1 (
  p_provider_event_id text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_event_id text := nullif(pg_catalog.btrim(coalesce(p_provider_event_id, '')), '');
  v_row public.billing_webhook_events%rowtype;
begin
  if v_event_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;

  -- Same key as claim_billing_webhook_event_v1.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stripe:' || v_event_id, 23)
  );

  select * into v_row
  from public.billing_webhook_events e
  where e.provider = 'stripe'
    and e.provider_event_id = v_event_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'not_found');
  end if;

  -- Only events held by the internal-subscription guard. Other deterministic
  -- failures keep their current handling.
  if v_row.status <> 'failed'
     or v_row.error_code is distinct from 'internal_subscription_current'
  then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'not_held',
      'status', v_row.status,
      'error_code', v_row.error_code
    );
  end if;

  if v_row.retryable then
    return pg_catalog.jsonb_build_object(
      'outcome', 'requeued',
      'provider_event_id', v_row.provider_event_id,
      'idempotent', true
    );
  end if;

  update public.billing_webhook_events e
  set
    retryable = true,
    metadata = e.metadata || pg_catalog.jsonb_build_object(
      'requeued_at', pg_catalog.now(),
      'requeue_count', coalesce((e.metadata ->> 'requeue_count')::integer, 0) + 1
    )
  where e.id = v_row.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'requeued',
    'provider_event_id', v_row.provider_event_id,
    'idempotent', false
  );
end;
$function$;

comment on function public.requeue_billing_webhook_event_v1(text) is
  'Service-only operator path: marks a webhook event held by the internal-subscription guard (failed, internal_subscription_current) as retryable so a provider resend reprocesses it. Run only after closing the internal row.';

revoke all on function public.requeue_billing_webhook_event_v1(text) from public;
revoke all on function public.requeue_billing_webhook_event_v1(text) from anon;
revoke all on function public.requeue_billing_webhook_event_v1(text) from authenticated;

grant execute on function public.requeue_billing_webhook_event_v1(text)
  to postgres, service_role;

commit;
