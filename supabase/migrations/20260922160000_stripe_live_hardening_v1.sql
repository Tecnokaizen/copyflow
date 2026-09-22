-- Stripe Live Hardening V1 · persistent Test/Live separation
-- Does NOT modify DEMO/SUR4 rows.
-- Safe now: Gestcopy has not activated Stripe Live; existing Stripe rows are Test.

begin;

-- ---------------------------------------------------------------------------
-- subscriptions.livemode
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists livemode boolean not null default false;

comment on column public.subscriptions.livemode is
  'Stripe commercial mode: false = Stripe Test, true = Stripe Live. For non-Stripe providers this field is not commercially relevant.';

-- ---------------------------------------------------------------------------
-- billing_checkout_attempts.livemode + one-active scope (tenant_id, livemode)
-- ---------------------------------------------------------------------------
alter table public.billing_checkout_attempts
  add column if not exists livemode boolean not null default false;

comment on column public.billing_checkout_attempts.livemode is
  'Stripe commercial mode for this Checkout attempt: false = Test, true = Live. Active uniqueness is scoped per (tenant_id, livemode).';

drop index if exists public.billing_checkout_attempts_one_active_per_tenant;

create unique index billing_checkout_attempts_one_active_per_tenant
  on public.billing_checkout_attempts (tenant_id, livemode)
  where (
    status = any (array['creating'::text, 'open'::text, 'completed'::text])
  );

comment on table public.billing_checkout_attempts is
  'Checkout attempt reservation. creating→open→completed|expired|canceled. At most one active (creating/open/completed) per (tenant_id, livemode).';

-- ---------------------------------------------------------------------------
-- sync_billing_subscription_v1 · add p_livemode (fail closed on mode move)
-- ---------------------------------------------------------------------------
drop function if exists public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz
);

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 4242)
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

  -- One-current: a new current may cancel prior current (including Test when Live arrives).
  if v_is_current then
    update public.subscriptions s
    set
      status = 'canceled',
      updated_at = pg_catalog.now()
    where s.tenant_id = p_tenant_id
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
  'DEFINER service-only: sync provider subscription atomically. Persists livemode; rejects moving a provider_subscription_id between Test and Live. Persists cancel_at. Rejects stale provider_event_created_at.';

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
-- prepare_billing_checkout_attempt_v2 · add p_livemode (mode-scoped)
-- ---------------------------------------------------------------------------
drop function if exists public.prepare_billing_checkout_attempt_v2(
  uuid, text, text, text
);

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
  'Service-only: reserve checkout attempt scoped by livemode. creating stays resumable until provider expiry (+ grace). Test current/attempt does not block Live Checkout.';

revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from public;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from anon;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from authenticated;

grant execute on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)
  to postgres, service_role;

commit;
