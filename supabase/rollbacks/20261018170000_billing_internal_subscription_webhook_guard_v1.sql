-- Rollback for 20261018170000_billing_internal_subscription_webhook_guard_v1.sql.
--
-- Restores sync_billing_subscription_v1 as in 20260922160000 (key 4242 lock,
-- "one current" cancels ANY current row, internal included),
-- prepare_billing_checkout_attempt_v2 as in 20261018160000 and
-- grant_internal_subscription_v1 as in 20261018161000, and drops the hold,
-- activation and reconciliation RPCs.
--
-- WARNING: after this a Stripe webhook cancels internal subscriptions again
-- (SUR4, demo). Only for an incident, with authorization.
--
-- Data: billing_private.subscription_holds and its rows are kept (never
-- deleted). Held events stay failed in billing_webhook_events; review them
-- before rolling back: a Stripe resend of a requeued one would cancel the
-- internal row.

begin;

drop function if exists public.requeue_billing_subscription_hold_v1(uuid, text, text);
drop function if exists public.resolve_billing_subscription_hold_v1(uuid, text, text);
drop function if exists public.set_internal_billing_activation_v1(uuid, text, text, text);
drop function if exists public.list_billing_reconciliation_v1();

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
  'Service-only: reserve checkout attempt scoped by livemode. creating stays resumable until provider expiry (+ grace). completed blocks (checkout_processing) until its subscription is recorded and ended, then becomes settled. Test current/attempt does not block Live Checkout.';

revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from public;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from anon;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from authenticated;

grant execute on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)
  to postgres, service_role;

create or replace function public.grant_internal_subscription_v1(
  p_tenant_id uuid,
  p_plan_code text,
  p_status text,
  p_current_period_end timestamptz,
  p_reason text,
  p_authorized_by text,
  p_metadata jsonb default '{}'::jsonb
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_authorized_by text := nullif(pg_catalog.btrim(coalesce(p_authorized_by, '')), '');
  v_plan_id uuid;
  v_id uuid;
  v_open integer;
begin
  if p_tenant_id is null
     or p_status is null
     or p_status <> all (array['trialing', 'active']::text[])
     or (p_metadata is not null and pg_catalog.jsonb_typeof(p_metadata) <> 'object')
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;

  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;

  if v_authorized_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  if p_current_period_end is not null and p_current_period_end <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'period_end_in_past');
  end if;

  select p.id into v_plan_id
  from public.plans p
  where p.code = pg_catalog.btrim(coalesce(p_plan_code, ''))
    and p.active is true;
  if v_plan_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'plan_not_found');
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'tenant_not_found');
  end if;

  -- Shared tenant billing lock (prepare_billing_checkout_attempt_v2, sync).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  if exists (
    select 1 from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.status = any (array['trialing', 'active', 'past_due']::text[])
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'current_subscription_exists');
  end if;

  -- A Checkout Session that can still be paid, or a paid one whose
  -- subscription is not recorded yet, would compete with the grant.
  select count(*) into v_open
  from public.billing_checkout_attempts a
  where a.tenant_id = p_tenant_id
    and (
      (
        a.status = any (array['creating'::text, 'open'::text])
        and a.expires_at + interval '2 minutes' > pg_catalog.now()
      )
      or (
        a.status = 'completed'
        and not exists (
          select 1 from public.subscriptions s
          where s.tenant_id = a.tenant_id
            and s.provider = 'stripe'
            and s.livemode = a.livemode
            and s.created_at >= a.created_at
        )
      )
    );
  if v_open > 0 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected', 'reason', 'checkout_in_progress', 'attempts', v_open
    );
  end if;

  perform pg_catalog.set_config('app.billing_internal_via', 'grant_rpc', true);
  perform pg_catalog.set_config('app.billing_internal_reason', v_reason, true);
  perform pg_catalog.set_config('app.billing_internal_authorized_by', v_authorized_by, true);

  insert into public.subscriptions (
    tenant_id, plan_id, provider, status,
    current_period_start, current_period_end, cancel_at_period_end, livemode, metadata
  ) values (
    p_tenant_id, v_plan_id, 'internal', p_status,
    pg_catalog.now(), p_current_period_end, false, false,
    coalesce(p_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'source', 'grant_internal_subscription_v1',
      'granted_at', pg_catalog.now(),
      'grant_reason', v_reason,
      'granted_by', v_authorized_by
    )
  )
  returning id into v_id;

  perform pg_catalog.set_config('app.billing_internal_via', '', true);
  perform pg_catalog.set_config('app.billing_internal_reason', '', true);
  perform pg_catalog.set_config('app.billing_internal_authorized_by', '', true);

  return pg_catalog.jsonb_build_object(
    'outcome', 'granted',
    'subscription_id', v_id,
    'tenant_id', p_tenant_id,
    'plan_code', pg_catalog.btrim(p_plan_code),
    'status', p_status,
    'capacity', public.resolve_tenant_storage_capacity_v1(p_tenant_id)
  );
end;
$function$;

comment on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb) is
  'Service-only: grants an internal subscription (trialing/active) with a reason (>= 10 chars) and an authorizer, under the shared tenant billing lock. Refuses when a subscription is current or a Checkout can still be paid. Audited as grant_rpc.';

revoke all on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb)
  to postgres, service_role;

commit;
