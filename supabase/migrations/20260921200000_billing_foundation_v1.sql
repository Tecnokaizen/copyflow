-- Billing Foundation V1 · provider prices, webhook event log, subscription
-- identity hardening, and atomic subscription sync RPC.
--
-- Does NOT seed Stripe Product/Price IDs.
-- Does NOT touch existing tenant subscriptions (demo/sur4 stay as-is).
-- Does NOT create HTTP webhook/checkout endpoints.

begin;

-- ---------------------------------------------------------------------------
-- billing_prices · global commercial catalog (not tenant-scoped)
-- ---------------------------------------------------------------------------
create table public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete restrict,
  provider text not null,
  provider_product_id text not null,
  provider_price_id text not null,
  billing_interval text not null,
  currency text not null,
  unit_amount bigint not null,
  livemode boolean not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_prices_provider_check
    check (provider = 'stripe'),
  constraint billing_prices_interval_check
    check (billing_interval = any (array['month'::text, 'year'::text])),
  constraint billing_prices_currency_check
    check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint billing_prices_unit_amount_check
    check (unit_amount >= 0),
  constraint billing_prices_provider_price_unique
    unique (provider, provider_price_id)
);

comment on table public.billing_prices is
  'Mapeo global plan ↔ Price del provider (Stripe). Distingue test/live e histórico inactive.';

create index billing_prices_resolve_idx
  on public.billing_prices (plan_id, provider, billing_interval, livemode, active);

create unique index billing_prices_one_active_per_plan_interval_mode_idx
  on public.billing_prices (plan_id, provider, billing_interval, livemode)
  where (active = true);

create trigger billing_prices_set_updated_at
  before update on public.billing_prices
  for each row
  execute function public.set_updated_at();

alter table public.billing_prices enable row level security;

create policy billing_prices_select_authenticated
  on public.billing_prices
  for select
  to authenticated
  using (true);

revoke all on table public.billing_prices from public;
revoke all on table public.billing_prices from anon;
grant select on table public.billing_prices to authenticated;
grant select, insert, update, delete, references, trigger, truncate, maintain
  on table public.billing_prices to postgres, service_role;

-- ---------------------------------------------------------------------------
-- billing_webhook_events · durable idempotency (server-only)
-- ---------------------------------------------------------------------------
create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  livemode boolean not null,
  provider_created_at timestamptz,
  object_id text,
  status text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  constraint billing_webhook_events_provider_check
    check (provider = 'stripe'),
  constraint billing_webhook_events_status_check
    check (
      status = any (
        array[
          'received'::text,
          'processed'::text,
          'ignored'::text,
          'failed'::text
        ]
      )
    ),
  constraint billing_webhook_events_provider_event_unique
    unique (provider, provider_event_id)
);

comment on table public.billing_webhook_events is
  'Registro mínimo de eventos Stripe para idempotencia y auditoría técnica. Sin payload secreto.';

create index billing_webhook_events_status_idx
  on public.billing_webhook_events (status);

create index billing_webhook_events_type_idx
  on public.billing_webhook_events (event_type);

alter table public.billing_webhook_events enable row level security;

-- No policies for authenticated/anon: service_role bypasses RLS.
revoke all on table public.billing_webhook_events from public;
revoke all on table public.billing_webhook_events from anon;
revoke all on table public.billing_webhook_events from authenticated;
grant select, insert, update, delete, references, trigger, truncate, maintain
  on table public.billing_webhook_events to postgres, service_role;

-- ---------------------------------------------------------------------------
-- subscriptions · provider identity hardening
-- ---------------------------------------------------------------------------
create unique index if not exists subscriptions_provider_subscription_unique
  on public.subscriptions (provider, provider_subscription_id)
  where (provider_subscription_id is not null);

create index if not exists subscriptions_provider_customer_idx
  on public.subscriptions (provider, provider_customer_id)
  where (provider_customer_id is not null);

-- ---------------------------------------------------------------------------
-- sync_billing_subscription_v1 · atomic current-subscription sync
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
  p_metadata jsonb default '{}'::jsonb
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
      metadata
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
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'subscription_id', v_id,
    'tenant_id', p_tenant_id,
    'plan_id', p_plan_id,
    'provider', v_provider,
    'status', p_status
  );
end;
$function$;

comment on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) is
  'DEFINER service-only: sincroniza subscription provider de forma atómica por tenant. Idempotente por (provider, provider_subscription_id). Respeta one-current.';

revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) from public;
revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) from anon;
revoke all on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) from authenticated;

grant execute on function public.sync_billing_subscription_v1(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) to postgres, service_role;

commit;
