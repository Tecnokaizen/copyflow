-- Billing B2 · Stripe event ordering protection on subscriptions.
-- Adds provider_event_created_at and extends sync_billing_subscription_v1
-- so an older Stripe event cannot overwrite a newer one.

begin;

alter table public.subscriptions
  add column if not exists provider_event_created_at timestamptz;

comment on column public.subscriptions.provider_event_created_at is
  'Stripe event.created (as timestamptz) of the last applied provider event for this row. Used to reject stale out-of-order webhooks.';

drop function if exists public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
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
  p_provider_event_created_at timestamptz default null
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
  end if;

  -- Stale event guard: never let an older provider event overwrite a newer one.
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
      'stale', true
    );
  end if;

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
    'stale', false
  );
end;
$function$;

comment on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz
) is
  'DEFINER service-only: sync provider subscription atomically. Idempotent by (provider, provider_subscription_id). Rejects stale provider_event_created_at. Respects one-current.';

revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz
) from public;
revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz
) from anon;
revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz
) from authenticated;

grant execute on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz
) to postgres, service_role;

commit;
