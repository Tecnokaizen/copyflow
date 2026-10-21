-- Billing internal subscription webhook guard V1 · D1 options B + C (approved 18/10/2026)
-- Does NOT modify DEMO/SUR4 rows. Changes no existing row at migration time.
--
-- Problem: sync_billing_subscription_v1 ("one current") canceled ANY current
-- row of the tenant when a current Stripe subscription arrived, including
-- internal trials and pilots (SUR4: internal trialing). The checkout guard of
-- #132 only stops new sessions; sessions opened before it, or subscriptions
-- created in Stripe outside the app with metadata tenant_id, still reach the
-- webhook.
--
-- Option B, hold with alert:
--   * sync never cancels a protected current non-Stripe row: it writes no
--     subscription and records a hold in billing_private.subscription_holds
--     (Stripe ids, mode, events); the webhook marks the event as failed
--     without retry (internal_subscription_current) and alerts;
--   * while a hold is pending, prepare refuses any new Checkout
--     (subscription_pending_reconciliation) and no internal grant is allowed;
--   * recovery is idempotent and traced: requeue_billing_subscription_hold_v1
--     (after closing the internal row or marking it ready) makes its events
--     retryable for a Stripe resend; the next sync that records the
--     subscription reconciles the hold; resolve_billing_subscription_hold_v1
--     dismisses it after verifying Stripe (refund/cancel);
--   * list_billing_reconciliation_v1 lists pending holds, paid checkouts with
--     no recorded subscription and direct internal grants.
-- Option C, convert only when ready: a current internal row whose
-- metadata.billing_activation is 'ready_for_checkout' (set with
-- set_internal_billing_activation_v1) lets Checkout through and the sync
-- closes it as 'converted_to_stripe', audited.
-- Shared tenant billing lock (key 31): prepare, sync (was 4242), the internal
-- grant, the activation RPC and the hold RPCs.
--
-- Effect in Stripe: a held subscription was paid; nothing here refunds or
-- cancels it. Stripe does not retry the held event.

begin;

-- ---------------------------------------------------------------------------
-- billing_private.subscription_holds · Stripe subscriptions pending reconciliation
-- ---------------------------------------------------------------------------
create table if not exists billing_private.subscription_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_subscription_id text not null,
  provider_customer_id text,
  livemode boolean not null,
  plan_id uuid,
  internal_subscription_id uuid,
  last_status text not null,
  status text not null default 'held'
    check (status = any (array['held', 'reconciled', 'dismissed']::text[])),
  event_ids text[] not null default '{}'::text[],
  hold_count integer not null default 1,
  first_held_at timestamptz not null default pg_catalog.now(),
  last_held_at timestamptz not null default pg_catalog.now(),
  resolved_at timestamptz,
  resolution text,
  resolution_reason text,
  resolved_by text,
  history jsonb not null default '[]'::jsonb
);

create unique index if not exists subscription_holds_provider_subscription_idx
  on billing_private.subscription_holds (provider, provider_subscription_id);
create index if not exists subscription_holds_pending_idx
  on billing_private.subscription_holds (tenant_id)
  where status = 'held';

alter table billing_private.subscription_holds enable row level security;
revoke all on table billing_private.subscription_holds
  from public, anon, authenticated, service_role;

comment on table billing_private.subscription_holds is
  'Stripe subscriptions held because a protected internal subscription was current. held → reconciled (recorded by a later sync) | dismissed (operator, after verifying Stripe). A held row blocks new Checkout for the tenant.';

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
  -- The webhook passes the Stripe event id in p_metadata for traceability; it
  -- is not stored in subscriptions.metadata.
  v_event_id text := case
    when pg_catalog.jsonb_typeof(p_metadata) = 'object'
      then nullif(pg_catalog.btrim(coalesce(p_metadata ->> 'stripe_event_id', '')), '')
  end;
  v_meta jsonb := case
    when pg_catalog.jsonb_typeof(p_metadata) = 'object' then p_metadata - 'stripe_event_id'
    else coalesce(p_metadata, '{}'::jsonb)
  end;
  v_hold billing_private.subscription_holds%rowtype;
  v_hold_created boolean := false;
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
    -- pilot, mvp, NULL provider) unless it is marked ready_for_checkout.
    -- Hold: nothing is written, the caller records the event as failed without
    -- retry and alerts an operator.
    select * into v_internal
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.status = any (v_current_statuses)
      and s.provider is distinct from 'stripe'
    limit 1
    for update;

    if found
       and coalesce(v_internal.metadata ->> 'billing_activation', '') = 'ready_for_checkout'
    then
      -- Option C: an operator marked this internal row for conversion. The
      -- Stripe subscription replaces it; the row keeps an audit trail.
      perform pg_catalog.set_config('app.billing_internal_via', 'stripe_conversion', true);
      perform pg_catalog.set_config(
        'app.billing_internal_reason',
        'Converted to Stripe subscription ' || coalesce(p_provider_subscription_id, '?')
          || case when v_livemode then ' (live)' else ' (test)' end,
        true
      );
      perform pg_catalog.set_config(
        'app.billing_internal_authorized_by',
        coalesce(v_internal.metadata ->> 'billing_activation_authorized_by', 'ready_for_checkout'),
        true
      );
      update public.subscriptions s
      set
        status = 'canceled',
        metadata = s.metadata || pg_catalog.jsonb_build_object(
          'billing_activation', 'converted_to_stripe',
          'internal_closed_at', pg_catalog.now(),
          'converted_to_provider_subscription_id', p_provider_subscription_id,
          'converted_livemode', v_livemode
        ),
        updated_at = pg_catalog.now()
      where s.id = v_internal.id;
      perform pg_catalog.set_config('app.billing_internal_via', '', true);
      perform pg_catalog.set_config('app.billing_internal_reason', '', true);
      perform pg_catalog.set_config('app.billing_internal_authorized_by', '', true);
    elsif found then
      -- Record (or reopen) the hold: the subscription stays pending
      -- reconciliation and blocks new Checkout until it is resolved.
      if nullif(pg_catalog.btrim(coalesce(p_provider_subscription_id, '')), '') is not null then
        select * into v_hold
        from billing_private.subscription_holds h
        where h.provider = 'stripe'
          and h.provider_subscription_id = p_provider_subscription_id
        for update;

        if not found then
          insert into billing_private.subscription_holds (
            tenant_id, provider_subscription_id, provider_customer_id, livemode,
            plan_id, internal_subscription_id, last_status, event_ids, history
          ) values (
            p_tenant_id, p_provider_subscription_id, p_provider_customer_id, v_livemode,
            p_plan_id, v_internal.id, p_status,
            case when v_event_id is null then '{}'::text[] else array[v_event_id] end,
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'at', pg_catalog.now(), 'action', 'held', 'status', p_status, 'event_id', v_event_id))
          )
          returning * into v_hold;
          v_hold_created := true;
        else
          v_hold_created := v_hold.status <> 'held';
          update billing_private.subscription_holds h
          set
            status = 'held',
            last_status = p_status,
            provider_customer_id = coalesce(p_provider_customer_id, h.provider_customer_id),
            plan_id = p_plan_id,
            internal_subscription_id = v_internal.id,
            last_held_at = pg_catalog.now(),
            hold_count = h.hold_count + 1,
            event_ids = case
              when v_event_id is null or v_event_id = any (h.event_ids) then h.event_ids
              else h.event_ids || v_event_id
            end,
            resolved_at = case when v_hold_created then null else h.resolved_at end,
            resolution = case when v_hold_created then null else h.resolution end,
            history = h.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'at', pg_catalog.now(),
              'action', case when v_hold_created then 'reopened' else 'held_again' end,
              'previous_status', v_hold.status, 'status', p_status, 'event_id', v_event_id))
          where h.id = v_hold.id
          returning * into v_hold;
        end if;
      end if;

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
        'livemode', v_livemode,
        'hold_id', v_hold.id,
        'hold_created', v_hold_created
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
      metadata = v_meta,
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
      v_meta,
      p_provider_event_created_at
    )
    returning id into v_id;
  end if;

  -- The subscription is recorded: a pending hold for it is reconciled.
  update billing_private.subscription_holds h
  set
    status = 'reconciled',
    last_status = p_status,
    resolved_at = pg_catalog.now(),
    resolution = 'synced',
    resolution_reason = 'subscription recorded with status ' || p_status,
    resolved_by = 'sync_billing_subscription_v1',
    history = h.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at', pg_catalog.now(), 'action', 'reconciled', 'status', p_status,
      'subscription_id', v_id, 'event_id', v_event_id))
  where h.provider = 'stripe'
    and h.provider_subscription_id = p_provider_subscription_id
    and h.status = 'held'
  returning h.id into v_hold.id;

  return pg_catalog.jsonb_build_object(
    'reconciled_hold_id', v_hold.id,
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
  'DEFINER service-only: sync provider subscription atomically under the shared tenant billing lock (key 31). Persists livemode; rejects moving a provider_subscription_id between Test and Live. Persists cancel_at. Rejects stale provider_event_created_at. Never cancels a current non-Stripe subscription unless its metadata.billing_activation is ready_for_checkout (then canceled as converted_to_stripe); otherwise returns outcome held (code internal_subscription_current) without writing.';

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
  -- provider) blocks Checkout in every mode unless it is marked
  -- ready_for_checkout. Same rule as the app guard
  -- (lib/billing/internal-subscription.ts), here under the shared tenant lock.
  if exists (
    select 1
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.provider is distinct from 'stripe'
      and s.status in ('trialing', 'active', 'past_due')
      and coalesce(s.metadata ->> 'billing_activation', '') <> 'ready_for_checkout'
  ) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'internal_subscription_current',
      'code', 'internal_subscription_current'
    );
  end if;

  -- A Stripe subscription pending reconciliation (held, already paid) blocks
  -- every new Checkout for the tenant: a second one would charge twice.
  if exists (
    select 1
    from billing_private.subscription_holds h
    where h.tenant_id = p_tenant_id
      and h.status = 'held'
  ) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'subscription_pending_reconciliation',
      'code', 'subscription_pending_reconciliation'
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
  'Service-only: reserve checkout attempt scoped by livemode. creating stays resumable until provider expiry (+ grace). completed blocks (checkout_processing) until its subscription is recorded and ended, then becomes settled. Test current/attempt does not block Live Checkout. A current non-Stripe subscription blocks every mode (internal_subscription_current) unless marked ready_for_checkout; a held Stripe subscription blocks every new Checkout (subscription_pending_reconciliation). Shares the tenant billing lock (key 31) with sync_billing_subscription_v1.';

revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from public;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from anon;
revoke all on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean) from authenticated;

grant execute on function public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- requeue_billing_subscription_hold_v1 · idempotent recovery of held events
-- ---------------------------------------------------------------------------
create or replace function public.requeue_billing_subscription_hold_v1 (
  p_hold_id uuid,
  p_reason text,
  p_requested_by text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_by text := nullif(pg_catalog.btrim(coalesce(p_requested_by, '')), '');
  v_hold billing_private.subscription_holds%rowtype;
  v_marked integer;
begin
  if p_hold_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;
  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;
  if v_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  select * into v_hold from billing_private.subscription_holds h where h.id = p_hold_id;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_hold.tenant_id::text, 31)
  );
  select * into v_hold from billing_private.subscription_holds h where h.id = p_hold_id for update;

  if v_hold.status <> 'held' then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'not_held', 'status', v_hold.status);
  end if;

  -- A resend would be held again: close the internal row or mark it ready first.
  if exists (
    select 1 from public.subscriptions s
    where s.tenant_id = v_hold.tenant_id
      and s.provider is distinct from 'stripe'
      and s.status = any (array['trialing', 'active', 'past_due']::text[])
      and coalesce(s.metadata ->> 'billing_activation', '') <> 'ready_for_checkout'
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'internal_subscription_current');
  end if;

  -- Same key as claim_billing_webhook_event_v1, per event, in a stable order.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stripe:' || e, 23))
  from pg_catalog.unnest(v_hold.event_ids) as e
  order by e;

  update public.billing_webhook_events ev
  set
    retryable = true,
    metadata = ev.metadata || pg_catalog.jsonb_build_object(
      'requeued_at', pg_catalog.now(),
      'requeue_hold_id', v_hold.id,
      'requeue_count', coalesce((ev.metadata ->> 'requeue_count')::integer, 0) + 1
    )
  where ev.provider = 'stripe'
    and ev.provider_event_id = any (v_hold.event_ids)
    and ev.status = 'failed'
    and ev.error_code = 'internal_subscription_current'
    and ev.retryable is not true;
  get diagnostics v_marked = row_count;

  update billing_private.subscription_holds h
  set history = h.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'at', pg_catalog.now(), 'action', 'requeue', 'reason', v_reason,
    'requested_by', v_by, 'events_marked', v_marked))
  where h.id = v_hold.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'requeued',
    'hold_id', v_hold.id,
    'events_marked', v_marked,
    'event_ids', pg_catalog.to_jsonb(v_hold.event_ids),
    'idempotent', v_marked = 0
  );
end;
$function$;

comment on function public.requeue_billing_subscription_hold_v1(uuid, text, text) is
  'Service-only operator recovery: once the internal row is closed or marked ready_for_checkout, marks the held events of a subscription retryable so a Stripe resend reprocesses them. Idempotent; reason and requester recorded in the hold history.';

revoke all on function public.requeue_billing_subscription_hold_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.requeue_billing_subscription_hold_v1(uuid, text, text) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- resolve_billing_subscription_hold_v1 · dismiss after verifying Stripe
-- ---------------------------------------------------------------------------
create or replace function public.resolve_billing_subscription_hold_v1 (
  p_hold_id uuid,
  p_reason text,
  p_resolved_by text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_by text := nullif(pg_catalog.btrim(coalesce(p_resolved_by, '')), '');
  v_hold billing_private.subscription_holds%rowtype;
begin
  if p_hold_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;
  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;
  if v_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  select * into v_hold from billing_private.subscription_holds h where h.id = p_hold_id;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_hold.tenant_id::text, 31)
  );
  select * into v_hold from billing_private.subscription_holds h where h.id = p_hold_id for update;

  if v_hold.status = 'dismissed' then
    return pg_catalog.jsonb_build_object('outcome', 'dismissed', 'hold_id', v_hold.id, 'idempotent', true);
  end if;
  if v_hold.status = 'reconciled' then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'already_reconciled');
  end if;

  update billing_private.subscription_holds h
  set
    status = 'dismissed',
    resolved_at = pg_catalog.now(),
    resolution = 'dismissed',
    resolution_reason = v_reason,
    resolved_by = v_by,
    history = h.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at', pg_catalog.now(), 'action', 'dismissed', 'reason', v_reason, 'resolved_by', v_by))
  where h.id = v_hold.id;

  return pg_catalog.jsonb_build_object('outcome', 'dismissed', 'hold_id', v_hold.id, 'idempotent', false);
end;
$function$;

comment on function public.resolve_billing_subscription_hold_v1(uuid, text, text) is
  'Service-only: dismisses a held Stripe subscription after an operator verified it in Stripe (canceled/refunded). Idempotent; a new current event for the same subscription reopens the hold.';

revoke all on function public.resolve_billing_subscription_hold_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_billing_subscription_hold_v1(uuid, text, text) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- set_internal_billing_activation_v1 · ready_for_checkout and back, audited
-- ---------------------------------------------------------------------------
create or replace function public.set_internal_billing_activation_v1 (
  p_tenant_id uuid,
  p_billing_activation text,
  p_reason text,
  p_authorized_by text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_value text := nullif(pg_catalog.btrim(coalesce(p_billing_activation, '')), '');
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_by text := nullif(pg_catalog.btrim(coalesce(p_authorized_by, '')), '');
  v_row public.subscriptions%rowtype;
  v_previous text;
  v_open integer;
begin
  if p_tenant_id is null
     or v_value is null
     or v_value <> all (array['ready_for_checkout', 'deferred_until_go_live', 'internal_pilot']::text[])
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;
  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;
  if v_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  select * into v_row
  from public.subscriptions s
  where s.tenant_id = p_tenant_id
    and s.provider is distinct from 'stripe'
    and s.status = any (array['trialing', 'active', 'past_due']::text[])
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'no_internal_subscription');
  end if;

  v_previous := v_row.metadata ->> 'billing_activation';
  if v_previous is not distinct from v_value then
    return pg_catalog.jsonb_build_object(
      'outcome', 'unchanged', 'subscription_id', v_row.id, 'billing_activation', v_value
    );
  end if;

  -- Allowed with a pending hold: marking ready is how an operator adopts the
  -- held (already paid) subscription through requeue + resend. New Checkout
  -- stays blocked by the hold in prepare.
  perform pg_catalog.set_config('app.billing_internal_via', 'activation_rpc', true);
  perform pg_catalog.set_config('app.billing_internal_reason', v_reason, true);
  perform pg_catalog.set_config('app.billing_internal_authorized_by', v_by, true);

  update public.subscriptions s
  set
    metadata = s.metadata || pg_catalog.jsonb_build_object(
      'billing_activation', v_value,
      'billing_activation_authorized_by', v_by,
      'billing_activation_history',
        coalesce(s.metadata -> 'billing_activation_history', '[]'::jsonb)
        || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
             'from', v_previous, 'to', v_value, 'at', pg_catalog.now(),
             'reason', v_reason, 'authorized_by', v_by))
    ),
    updated_at = pg_catalog.now()
  where s.id = v_row.id;

  perform pg_catalog.set_config('app.billing_internal_via', '', true);
  perform pg_catalog.set_config('app.billing_internal_reason', '', true);
  perform pg_catalog.set_config('app.billing_internal_authorized_by', '', true);

  -- Leaving ready_for_checkout while a Checkout can still be paid: that payment
  -- would be held. Reported, not refused, so the protection applies at once.
  select count(*) into v_open
  from public.billing_checkout_attempts a
  where a.tenant_id = p_tenant_id
    and a.status = any (array['creating'::text, 'open'::text])
    and a.expires_at + interval '2 minutes' > pg_catalog.now();

  return pg_catalog.jsonb_build_object(
    'outcome', 'updated',
    'subscription_id', v_row.id,
    'previous', v_previous,
    'billing_activation', v_value,
    'open_checkout_attempts', v_open
  );
end;
$function$;

comment on function public.set_internal_billing_activation_v1(uuid, text, text, text) is
  'Service-only: sets metadata.billing_activation of the current internal subscription (ready_for_checkout | deferred_until_go_live | internal_pilot) under the shared tenant billing lock, with reason and authorizer, audited as activation_rpc.';

revoke all on function public.set_internal_billing_activation_v1(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_internal_billing_activation_v1(uuid, text, text, text) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- list_billing_reconciliation_v1 · what needs an operator
-- ---------------------------------------------------------------------------
create or replace function public.list_billing_reconciliation_v1()
  returns jsonb
  language sql
  stable
  security definer
  set search_path to ''
  as $function$
  select coalesce(pg_catalog.jsonb_agg(x.item order by x.since), '[]'::jsonb)
  from (
    select h.first_held_at as since, pg_catalog.jsonb_build_object(
      'kind', 'subscription_held',
      'tenant_id', h.tenant_id,
      'tenant_slug', t.slug,
      'hold_id', h.id,
      'provider_subscription_id', h.provider_subscription_id,
      'livemode', h.livemode,
      'last_status', h.last_status,
      'hold_count', h.hold_count,
      'event_ids', pg_catalog.to_jsonb(h.event_ids),
      'since', h.first_held_at
    ) as item
    from billing_private.subscription_holds h
    left join public.tenants t on t.id = h.tenant_id
    where h.status = 'held'
    union all
    select a.updated_at, pg_catalog.jsonb_build_object(
      'kind', 'checkout_completed_unrecorded',
      'tenant_id', a.tenant_id,
      'tenant_slug', t.slug,
      'attempt_id', a.id,
      'provider_session_id', a.provider_session_id,
      'livemode', a.livemode,
      'since', a.updated_at
    )
    from public.billing_checkout_attempts a
    left join public.tenants t on t.id = a.tenant_id
    where a.status = 'completed'
      and a.updated_at < pg_catalog.now() - interval '15 minutes'
      and not exists (
        select 1 from public.subscriptions s
        where s.tenant_id = a.tenant_id
          and s.provider = 'stripe'
          and s.livemode = a.livemode
          and s.created_at >= a.created_at
      )
    union all
    select au.created_at, pg_catalog.jsonb_build_object(
      'kind', 'internal_grant_direct',
      'tenant_id', au.tenant_id,
      'tenant_slug', t.slug,
      'subscription_id', au.subscription_id,
      'action', au.action,
      'actor_role', au.actor_role,
      'since', au.created_at
    )
    from billing_private.internal_subscription_audit au
    left join public.tenants t on t.id = au.tenant_id
    where au.via = 'direct'
      and au.action = any (array['grant', 'reactivate']::text[])
      and au.created_at > pg_catalog.now() - interval '30 days'
  ) x;
$function$;

comment on function public.list_billing_reconciliation_v1() is
  'Service-only operator read model: held Stripe subscriptions, paid checkouts with no recorded subscription after 15 minutes, and internal grants made outside the RPC in the last 30 days.';

revoke all on function public.list_billing_reconciliation_v1() from public, anon, authenticated;
grant execute on function public.list_billing_reconciliation_v1() to postgres, service_role;

-- ---------------------------------------------------------------------------
-- grant_internal_subscription_v1 · also refuses while a hold is pending
-- ---------------------------------------------------------------------------
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

  -- A Stripe subscription pending reconciliation must be resolved first.
  if exists (
    select 1 from billing_private.subscription_holds h
    where h.tenant_id = p_tenant_id and h.status = 'held'
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'subscription_pending_reconciliation');
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
  'Service-only: grants an internal subscription (trialing/active) with a reason (>= 10 chars) and an authorizer, under the shared tenant billing lock. Refuses when a subscription is current, a Checkout can still be paid or a Stripe subscription is pending reconciliation. Audited as grant_rpc.';

revoke all on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb)
  to postgres, service_role;

commit;
