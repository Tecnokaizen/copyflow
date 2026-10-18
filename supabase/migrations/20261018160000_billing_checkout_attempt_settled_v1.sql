-- Billing Checkout attempt settled V1 · re-subscribe after cancellation
-- Does NOT modify DEMO/SUR4 rows. Changes no existing row at migration time.
--
-- Defect: a 'completed' attempt stays in the one-active index forever, so once
-- its Stripe subscription is canceled prepare_billing_checkout_attempt_v2
-- answers checkout_processing (HTTP 409) indefinitely and the tenant can never
-- subscribe again.
--
-- Fix (additive):
--   * new terminal status 'settled' = the checkout completed AND every Stripe
--     subscription recorded for the tenant and mode since the attempt was
--     reserved has ended (canceled; incomplete_expired is synced as canceled);
--   * prepare_billing_checkout_attempt_v2 (same signature) settles such an
--     attempt under the tenant lock before looking for the active one.
--
-- Unchanged on purpose: a completed attempt whose subscription was never
-- recorded (webhook sync failed without retry) keeps blocking Checkout. Stripe
-- may already hold a paid subscription; a second Checkout would charge twice.

begin;

-- ---------------------------------------------------------------------------
-- status: allow 'settled' (outside the one-active index, session required)
-- ---------------------------------------------------------------------------
alter table public.billing_checkout_attempts
  drop constraint if exists billing_checkout_attempts_status_check;

alter table public.billing_checkout_attempts
  add constraint billing_checkout_attempts_status_check
  check (
    status = any (
      array[
        'creating'::text,
        'open'::text,
        'completed'::text,
        'expired'::text,
        'canceled'::text,
        'settled'::text
      ]
    )
  );

comment on table public.billing_checkout_attempts is
  'Checkout attempt reservation. creating→open→completed→settled | expired | canceled. At most one active (creating/open/completed) per (tenant_id, livemode). settled: the subscription produced by the checkout was recorded and has ended.';

-- ---------------------------------------------------------------------------
-- prepare_billing_checkout_attempt_v2 · settle ended completed attempts
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

commit;
