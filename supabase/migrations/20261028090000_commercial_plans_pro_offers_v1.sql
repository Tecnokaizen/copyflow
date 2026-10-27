-- Commercial plans V1 · Gestcopy Pro and tenant billing offers
-- Owner decisions of 27/10/2026 (follow-up of the Basic/Pro ADR, PR #134):
--   Basic 39 EUR/month: orders, clients, team, activity, 5 GiB, standard
--     quotes and client import.
--   Pro 79 EUR/month: everything in Basic plus 50 GiB, and the advanced
--     quotes V2.1 features once they exist (their own migration adds them).
--   AI is in no plan until it is implemented and validated.
--   Pro is not sold self-serve while committed features are missing: a Pro
--     Checkout needs a tenant billing offer granted by an operator. The app
--     enforces it (lib/billing/access.ts, lib/billing/offers.ts).
--
-- This migration:
--   1. adds plan pro with a fixed id, equal in local, Staging and Production;
--   2. plan_features: Basic gains quotes and clients_import; Pro gets the
--      Basic set with storage_bytes = 50 GiB (commercial rights);
--   2b. billing_private.feature_rollouts + set_feature_rollout_v1: operational
--      activation separate from plan rights. clients_import starts held, so no
--      tenant gets it from this migration (owner decision D2, 28/10/2026);
--      tenant_has_feature keeps its rules and adds the hold check;
--   3. adds billing_private.tenant_billing_offers and service-only RPCs to
--      grant, revoke, list, accept and redeem an offer.
-- It does NOT: create billing_prices (the catalog script does, per Stripe
-- mode), touch subscriptions or tenant overrides, or name any tenant.
--
-- Effect when applied: every tenant whose current subscription is on Basic
-- (trialing/active) resolves quotes through its plan. clients_import stays
-- off until set_feature_rollout_v1('clients_import', 'released', ...) or an
-- audited tenant override. The preflight lists them (docs/BILLING-PRO-OFFERS-V1.md).

begin;

-- ---------------------------------------------------------------------------
-- 1. Plan pro (fixed id). Refuse an existing pro row with another id.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.plans p
    where p.code = 'pro'
      and p.id <> '30000000-0000-4000-8000-000000000003'::uuid
  ) then
    raise exception 'plan pro already exists with another id';
  end if;
end;
$$;

insert into public.plans (
  id,
  code,
  name,
  description,
  price_monthly,
  price_yearly,
  currency,
  active,
  sort_order,
  metadata
)
values (
  '30000000-0000-4000-8000-000000000003',
  'pro',
  'Gestcopy Pro',
  'Suscripción SaaS Gestcopy Pro (mensual).',
  79.00,
  null,
  'EUR',
  true,
  20,
  '{}'::jsonb
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  price_monthly = excluded.price_monthly,
  price_yearly = excluded.price_yearly,
  currency = excluded.currency,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = pg_catalog.now();

-- ---------------------------------------------------------------------------
-- 2. Plan rights. Boolean features carry no limit; storage_bytes is bytes.
-- ---------------------------------------------------------------------------
do $$
begin
  if (
    select count(*) from public.features f
    where f.code in (
      'activity_log', 'core_clients', 'core_orders', 'core_team',
      'quotes', 'clients_import', 'storage_bytes'
    )
  ) <> 7 then
    raise exception 'feature catalog incomplete for commercial plans';
  end if;
end;
$$;

-- Basic: standard quotes and client import.
insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
select p.id, f.id, true, null
from public.plans p
cross join public.features f
where p.code = 'basic'
  and f.code in ('quotes', 'clients_import')
on conflict (plan_id, feature_id) do update
set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  updated_at = pg_catalog.now();

-- Pro: the Basic set.
insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
select p.id, f.id, true, null
from public.plans p
cross join public.features f
where p.code = 'pro'
  and f.code in (
    'activity_log', 'core_clients', 'core_orders', 'core_team',
    'quotes', 'clients_import'
  )
on conflict (plan_id, feature_id) do update
set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  updated_at = pg_catalog.now();

-- Pro: 50 GiB (binary).
insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
select p.id, f.id, true, 53687091200
from public.plans p
cross join public.features f
where p.code = 'pro'
  and f.code = 'storage_bytes'
on conflict (plan_id, feature_id) do update
set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  updated_at = pg_catalog.now();

-- ---------------------------------------------------------------------------
-- 2b. Operational activation, separate from plan rights (owner decision D2,
--     28/10/2026).
--
-- plan_features says what a plan includes (commercial right). A row in
-- billing_private.feature_rollouts with state 'held' keeps that feature OFF
-- through plans until an operator releases it (operational activation).
-- Tenant overrides (A1, set_tenant_feature_v2) still decide first, so a
-- controlled activation for one tenant is an audited override, and a release
-- turns the plan right on for every entitled tenant at once.
-- No row means released: every other feature keeps its current behaviour.
-- clients_import starts held: Basic and Pro include it, nobody gets it from
-- this migration.
-- ---------------------------------------------------------------------------
create table if not exists billing_private.feature_rollouts (
  feature_id uuid primary key references public.features (id) on delete cascade,
  state text not null check (state = any (array['held', 'released']::text[])),
  reason text not null check (pg_catalog.length(reason) >= 10),
  authorized_by text not null check (pg_catalog.length(authorized_by) >= 1),
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

alter table billing_private.feature_rollouts enable row level security;
revoke all on table billing_private.feature_rollouts
  from public, anon, authenticated, service_role;

comment on table billing_private.feature_rollouts is
  'Operational activation of plan features. held: plan rights do not enable the feature (tenant overrides still do). released or no row: plan rights apply. Written only through set_feature_rollout_v1.';

-- Re-running the migration never re-holds a feature an operator released.
insert into billing_private.feature_rollouts (feature_id, state, reason, authorized_by, history)
select
  f.id,
  'held',
  'Importación de clientes incluida en Basic y Pro; activación operativa pendiente (decisión D2 del 28/10/2026).',
  'owner decision D2 2026-10-28',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'state', 'held', 'at', pg_catalog.now(), 'by', 'migration 20261028090000'
  ))
from public.features f
where f.code = 'clients_import'
on conflict (feature_id) do nothing;

-- Same body as 20260923190000_quotes_v1, plus the hold check on the plan
-- fallback. Overrides keep priority.
create or replace function public.tenant_has_feature (
  p_tenant_id uuid,
  p_code text
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_enabled boolean;
begin
  -- authenticated may only resolve tenants where they have an active membership.
  -- service_role and a direct postgres/supabase_admin session keep operational access.
  -- A JWT role of authenticated is never treated as operational, even if session_user is postgres.
  if v_role = 'service_role'
     or (
       v_role = ''
       and session_user in ('postgres', 'supabase_admin')
     )
  then
    null;
  elsif v_role = 'authenticated'
     and exists (
       select 1
       from public.memberships m
       where m.tenant_id = p_tenant_id
         and m.user_id = auth.uid()
         and m.active is true
     )
  then
    null;
  else
    return false;
  end if;

  select o.enabled into v_enabled
  from public.tenant_feature_overrides o
  join public.features f on f.id = o.feature_id
  where o.tenant_id = p_tenant_id
    and f.code = p_code;

  if found then
    return coalesce(v_enabled, false);
  end if;

  -- Plan fallback does not filter subscriptions.livemode.
  -- Do not use this resolver for Stripe-sensitive features until that mode is part of the rule.
  select pf.enabled into v_enabled
  from public.subscriptions s
  join public.plan_features pf on pf.plan_id = s.plan_id
  join public.features f on f.id = pf.feature_id
  where s.tenant_id = p_tenant_id
    and f.code = p_code
    and s.status in ('active', 'trialing')
  order by s.created_at desc
  limit 1;

  -- A plan right is not an activation: a held feature stays off (D2).
  if coalesce(v_enabled, false) and exists (
    select 1
    from billing_private.feature_rollouts r
    join public.features f on f.id = r.feature_id
    where f.code = p_code
      and r.state = 'held'
  ) then
    return false;
  end if;

  return coalesce(v_enabled, false);
end;
$function$;

-- set_feature_rollout_v1 · operator, service-only. Idempotent.
create or replace function public.set_feature_rollout_v1 (
  p_code text,
  p_state text,
  p_reason text,
  p_authorized_by text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_code text := nullif(pg_catalog.btrim(coalesce(p_code, '')), '');
  v_state text := nullif(pg_catalog.btrim(coalesce(p_state, '')), '');
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_by text := nullif(pg_catalog.btrim(coalesce(p_authorized_by, '')), '');
  v_feature uuid;
  v_row billing_private.feature_rollouts%rowtype;
  v_entry jsonb;
begin
  if v_code is null or v_state is null or v_state not in ('held', 'released') then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;
  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;
  if v_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  select f.id into v_feature from public.features f where f.code = v_code;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'feature_not_found');
  end if;

  v_entry := pg_catalog.jsonb_build_object(
    'state', v_state, 'at', pg_catalog.now(), 'by', v_by, 'reason', v_reason
  );

  insert into billing_private.feature_rollouts (feature_id, state, reason, authorized_by, history)
  values (v_feature, v_state, v_reason, v_by, pg_catalog.jsonb_build_array(v_entry))
  on conflict (feature_id) do nothing;
  if found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'set', 'code', v_code, 'state', v_state, 'previous_state', null
    );
  end if;

  select * into v_row
  from billing_private.feature_rollouts r
  where r.feature_id = v_feature
  for update;

  if v_row.state = v_state then
    return pg_catalog.jsonb_build_object('outcome', 'unchanged', 'code', v_code, 'state', v_state);
  end if;

  update billing_private.feature_rollouts r
  set state = v_state,
      reason = v_reason,
      authorized_by = v_by,
      updated_at = pg_catalog.now(),
      history = r.history || pg_catalog.jsonb_build_array(
        v_entry || pg_catalog.jsonb_build_object('previous_state', v_row.state)
      )
  where r.feature_id = v_feature;

  return pg_catalog.jsonb_build_object(
    'outcome', 'set', 'code', v_code, 'state', v_state, 'previous_state', v_row.state
  );
end;
$function$;

comment on function public.set_feature_rollout_v1(text, text, text, text) is
  'Service-only: hold or release the operational activation of a plan feature, with reason and authorizer. Idempotent (unchanged). Tenant overrides are not touched.';

revoke all on function public.set_feature_rollout_v1(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_feature_rollout_v1(text, text, text, text)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. billing_private.tenant_billing_offers
--
-- An offer lets one tenant buy one plan with one Stripe coupon, in one Stripe
-- mode. The coupon itself (single use, redeem_by, applies_to the plan product)
-- lives in Stripe; this row is the app's authority to apply it, the data shown
-- to the customer before paying, and the evidence of acceptance.
--   active   → can be accepted and used in Checkout until redeem_by
--   redeemed → its Checkout completed (webhook, idempotent)
--   revoked  → operator withdrew it
-- ---------------------------------------------------------------------------
create table if not exists billing_private.tenant_billing_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  provider text not null default 'stripe' check (provider = 'stripe'),
  livemode boolean not null,
  provider_coupon_id text not null
    check (provider_coupon_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  discount_amount bigint not null check (discount_amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  discount_months integer not null check (discount_months between 1 and 12),
  billing_cycle_anchor timestamptz,
  promo_ends_before timestamptz not null,
  redeem_by timestamptz not null,
  terms_version text not null
    check (terms_version ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  status text not null default 'active'
    check (status = any (array['active', 'redeemed', 'revoked']::text[])),
  reason text not null check (pg_catalog.length(reason) >= 10),
  authorized_by text not null check (pg_catalog.length(authorized_by) >= 1),
  accepted_at timestamptz,
  accepted_by uuid,
  accepted_terms_hash text,
  checkout_session_id text,
  provider_subscription_id text,
  redeemed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  history jsonb not null default '[]'::jsonb,
  constraint tenant_billing_offers_anchor_before_end
    check (billing_cycle_anchor is null or billing_cycle_anchor < promo_ends_before)
);

create unique index if not exists tenant_billing_offers_one_active_idx
  on billing_private.tenant_billing_offers (tenant_id, plan_id, livemode)
  where status = 'active';
create index if not exists tenant_billing_offers_tenant_idx
  on billing_private.tenant_billing_offers (tenant_id, created_at desc);

alter table billing_private.tenant_billing_offers enable row level security;
revoke all on table billing_private.tenant_billing_offers
  from public, anon, authenticated, service_role;

comment on table billing_private.tenant_billing_offers is
  'Operator-granted billing offers: one tenant, one plan, one Stripe coupon, one mode. active → redeemed (webhook) | revoked (operator). Read and written only through the *_tenant_billing_offer_v1 RPCs.';

-- ---------------------------------------------------------------------------
-- grant_tenant_billing_offer_v1 · operator, service-only
-- ---------------------------------------------------------------------------
create or replace function public.grant_tenant_billing_offer_v1 (
  p_tenant_id uuid,
  p_plan_code text,
  p_livemode boolean,
  p_provider_coupon_id text,
  p_discount_amount bigint,
  p_currency text,
  p_discount_months integer,
  p_billing_cycle_anchor timestamptz,
  p_promo_ends_before timestamptz,
  p_redeem_by timestamptz,
  p_terms_version text,
  p_reason text,
  p_authorized_by text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_by text := nullif(pg_catalog.btrim(coalesce(p_authorized_by, '')), '');
  v_coupon text := nullif(pg_catalog.btrim(coalesce(p_provider_coupon_id, '')), '');
  v_terms text := nullif(pg_catalog.btrim(coalesce(p_terms_version, '')), '');
  v_currency text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_currency, '')));
  v_plan public.plans%rowtype;
  v_price_minor bigint;
  v_id uuid;
begin
  if p_tenant_id is null
     or p_livemode is null
     or v_coupon is null
     or v_coupon !~ '^[A-Za-z0-9_-]{1,64}$'
     or p_discount_amount is null
     or p_discount_months is null
     or p_discount_months not between 1 and 12
     or p_promo_ends_before is null
     or p_redeem_by is null
     or v_terms is null
     or v_terms !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;
  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;
  if v_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  select * into v_plan
  from public.plans p
  where p.code = pg_catalog.btrim(coalesce(p_plan_code, ''))
    and p.active is true;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'plan_not_found');
  end if;

  v_price_minor := pg_catalog.round(coalesce(v_plan.price_monthly, 0) * 100)::bigint;
  if v_currency <> pg_catalog.lower(v_plan.currency)
     or p_discount_amount <= 0
     or p_discount_amount >= v_price_minor
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_discount');
  end if;

  if p_redeem_by <= pg_catalog.now()
     or p_promo_ends_before <= pg_catalog.now()
     or (p_billing_cycle_anchor is not null
         and (p_billing_cycle_anchor <= pg_catalog.now()
              or p_billing_cycle_anchor >= p_promo_ends_before))
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_dates');
  end if;

  -- Fixed calendar (D1, 28/10/2026): no promotional period goes past
  -- promo_ends_before. Anchored: anchor + months is exactly that date (the
  -- first regular charge). Not anchored: some payment time must still end
  -- the discounted months by that date. Month arithmetic in UTC, as Stripe.
  if (p_billing_cycle_anchor is not null
      and ((p_billing_cycle_anchor at time zone 'UTC')
           + pg_catalog.make_interval(months => p_discount_months)) at time zone 'UTC'
          <> p_promo_ends_before)
     or (p_billing_cycle_anchor is null
         and ((p_promo_ends_before at time zone 'UTC')
              - pg_catalog.make_interval(months => p_discount_months)) at time zone 'UTC'
             <= pg_catalog.now())
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'calendar_mismatch');
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'tenant_not_found');
  end if;

  -- Shared tenant billing lock (prepare, sync, activation, holds).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  if exists (
    select 1 from billing_private.tenant_billing_offers o
    where o.tenant_id = p_tenant_id
      and o.plan_id = v_plan.id
      and o.livemode = p_livemode
      and o.status = 'active'
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'offer_exists');
  end if;

  insert into billing_private.tenant_billing_offers (
    tenant_id, plan_id, livemode, provider_coupon_id, discount_amount, currency,
    discount_months, billing_cycle_anchor, promo_ends_before, redeem_by,
    terms_version, reason, authorized_by, history
  ) values (
    p_tenant_id, v_plan.id, p_livemode, v_coupon, p_discount_amount, v_currency,
    p_discount_months, p_billing_cycle_anchor, p_promo_ends_before, p_redeem_by,
    v_terms, v_reason, v_by,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at', pg_catalog.now(), 'action', 'granted', 'reason', v_reason, 'authorized_by', v_by))
  )
  returning id into v_id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'granted',
    'offer_id', v_id,
    'tenant_id', p_tenant_id,
    'plan_code', v_plan.code,
    'livemode', p_livemode
  );
end;
$function$;

comment on function public.grant_tenant_billing_offer_v1(
  uuid, text, boolean, text, bigint, text, integer, timestamptz, timestamptz, timestamptz, text, text, text
) is
  'Service-only: grant one active billing offer (tenant, plan, Stripe mode, coupon) with reason and authorizer, under the shared tenant billing lock (key 31). The discount must be below the plan monthly price in the plan currency.';

revoke all on function public.grant_tenant_billing_offer_v1(
  uuid, text, boolean, text, bigint, text, integer, timestamptz, timestamptz, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.grant_tenant_billing_offer_v1(
  uuid, text, boolean, text, bigint, text, integer, timestamptz, timestamptz, timestamptz, text, text, text
) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- revoke_tenant_billing_offer_v1 · operator, service-only
-- ---------------------------------------------------------------------------
create or replace function public.revoke_tenant_billing_offer_v1 (
  p_offer_id uuid,
  p_reason text,
  p_authorized_by text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_by text := nullif(pg_catalog.btrim(coalesce(p_authorized_by, '')), '');
  v_offer billing_private.tenant_billing_offers%rowtype;
  v_open integer;
begin
  if p_offer_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;
  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;
  if v_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  select * into v_offer
  from billing_private.tenant_billing_offers o
  where o.id = p_offer_id;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'offer_not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_offer.tenant_id::text, 31)
  );

  select * into v_offer
  from billing_private.tenant_billing_offers o
  where o.id = p_offer_id
  for update;

  if v_offer.status = 'revoked' then
    return pg_catalog.jsonb_build_object('outcome', 'unchanged', 'offer_id', v_offer.id, 'status', 'revoked');
  end if;
  if v_offer.status = 'redeemed' then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'already_redeemed');
  end if;

  update billing_private.tenant_billing_offers o
  set
    status = 'revoked',
    updated_at = pg_catalog.now(),
    history = o.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at', pg_catalog.now(), 'action', 'revoked', 'reason', v_reason, 'authorized_by', v_by))
  where o.id = v_offer.id;

  -- A Checkout Session opened with this offer can still be paid in Stripe:
  -- reported so the operator expires it.
  select count(*) into v_open
  from public.billing_checkout_attempts a
  where a.tenant_id = v_offer.tenant_id
    and a.livemode = v_offer.livemode
    and a.status = any (array['creating'::text, 'open'::text])
    and a.expires_at + interval '2 minutes' > pg_catalog.now();

  return pg_catalog.jsonb_build_object(
    'outcome', 'revoked',
    'offer_id', v_offer.id,
    'open_checkout_attempts', v_open
  );
end;
$function$;

comment on function public.revoke_tenant_billing_offer_v1(uuid, text, text) is
  'Service-only: revoke an active billing offer with reason and authorizer. Reports open Checkout attempts of the tenant in the offer mode, which the operator must expire in Stripe.';

revoke all on function public.revoke_tenant_billing_offer_v1(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_tenant_billing_offer_v1(uuid, text, text)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- list_tenant_billing_offers_v1 · app (server) and operators, service-only
-- Usable offers by default: active and redeem_by in the future.
-- ---------------------------------------------------------------------------
create or replace function public.list_tenant_billing_offers_v1 (
  p_tenant_id uuid,
  p_livemode boolean,
  p_include_inactive boolean default false
)
  returns jsonb
  language sql
  stable
  security definer
  set search_path to ''
  as $function$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'offer_id', o.id,
      'tenant_id', o.tenant_id,
      'plan_code', p.code,
      'plan_name', p.name,
      'plan_price_monthly', p.price_monthly,
      'plan_currency', p.currency,
      'livemode', o.livemode,
      'provider_coupon_id', o.provider_coupon_id,
      'discount_amount', o.discount_amount,
      'currency', o.currency,
      'discount_months', o.discount_months,
      'billing_cycle_anchor', o.billing_cycle_anchor,
      'promo_ends_before', o.promo_ends_before,
      'redeem_by', o.redeem_by,
      'terms_version', o.terms_version,
      'status', o.status,
      'accepted_at', o.accepted_at,
      'redeemed_at', o.redeemed_at,
      'provider_subscription_id', o.provider_subscription_id,
      'created_at', o.created_at
    ) order by o.created_at desc), '[]'::jsonb)
  from billing_private.tenant_billing_offers o
  join public.plans p on p.id = o.plan_id
  where o.tenant_id = p_tenant_id
    and o.livemode = p_livemode
    and (
      coalesce(p_include_inactive, false)
      or (o.status = 'active' and o.redeem_by > pg_catalog.now())
    );
$function$;

comment on function public.list_tenant_billing_offers_v1(uuid, boolean, boolean) is
  'Service-only read of a tenant billing offers in one Stripe mode. Default: usable offers only (active, redeem_by in the future).';

revoke all on function public.list_tenant_billing_offers_v1(uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.list_tenant_billing_offers_v1(uuid, boolean, boolean)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- accept_tenant_billing_offer_v1 · app (server), service-only
-- Records the owner's explicit acceptance of the shown terms (hash).
-- ---------------------------------------------------------------------------
create or replace function public.accept_tenant_billing_offer_v1 (
  p_offer_id uuid,
  p_tenant_id uuid,
  p_user_id uuid,
  p_terms_hash text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_hash text := nullif(pg_catalog.btrim(coalesce(p_terms_hash, '')), '');
  v_offer billing_private.tenant_billing_offers%rowtype;
begin
  if p_offer_id is null or p_tenant_id is null or p_user_id is null
     or v_hash is null or v_hash !~ '^[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = p_user_id
      and m.active is true
      and m.role = 'owner'
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'owner_required');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  select * into v_offer
  from billing_private.tenant_billing_offers o
  where o.id = p_offer_id
    and o.tenant_id = p_tenant_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'offer_not_found');
  end if;
  if v_offer.status <> 'active' or v_offer.redeem_by <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'offer_not_active');
  end if;

  update billing_private.tenant_billing_offers o
  set
    accepted_at = pg_catalog.now(),
    accepted_by = p_user_id,
    accepted_terms_hash = v_hash,
    updated_at = pg_catalog.now(),
    history = o.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at', pg_catalog.now(), 'action', 'accepted', 'user_id', p_user_id, 'terms_hash', v_hash))
  where o.id = v_offer.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'accepted',
    'offer_id', v_offer.id,
    'terms_hash', v_hash
  );
end;
$function$;

comment on function public.accept_tenant_billing_offer_v1(uuid, uuid, uuid, text) is
  'Service-only: record that an active owner of the tenant accepted the offer terms shown (sha256 hex of the rendered terms). Only active offers before redeem_by.';

revoke all on function public.accept_tenant_billing_offer_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_tenant_billing_offer_v1(uuid, uuid, uuid, text)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- redeem_tenant_billing_offer_v1 · webhook, service-only, idempotent
-- ---------------------------------------------------------------------------
create or replace function public.redeem_tenant_billing_offer_v1 (
  p_offer_id uuid,
  p_tenant_id uuid,
  p_livemode boolean,
  p_checkout_session_id text,
  p_provider_subscription_id text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_session text := nullif(pg_catalog.btrim(coalesce(p_checkout_session_id, '')), '');
  v_sub text := nullif(pg_catalog.btrim(coalesce(p_provider_subscription_id, '')), '');
  v_offer billing_private.tenant_billing_offers%rowtype;
begin
  if p_offer_id is null or p_tenant_id is null or p_livemode is null
     or v_session is null or v_sub is null
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  select * into v_offer
  from billing_private.tenant_billing_offers o
  where o.id = p_offer_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'offer_not_found');
  end if;
  if v_offer.tenant_id <> p_tenant_id or v_offer.livemode <> p_livemode then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'offer_mismatch');
  end if;

  if v_offer.status = 'redeemed' then
    if v_offer.provider_subscription_id = v_sub then
      return pg_catalog.jsonb_build_object('outcome', 'unchanged', 'offer_id', v_offer.id);
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'redeemed_elsewhere');
  end if;

  -- active or revoked: the payment already happened in Stripe; record it.
  update billing_private.tenant_billing_offers o
  set
    status = 'redeemed',
    checkout_session_id = v_session,
    provider_subscription_id = v_sub,
    redeemed_at = pg_catalog.now(),
    updated_at = pg_catalog.now(),
    history = o.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at', pg_catalog.now(), 'action', 'redeemed', 'previous_status', v_offer.status,
      'checkout_session_id', v_session, 'provider_subscription_id', v_sub))
  where o.id = v_offer.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'redeemed',
    'offer_id', v_offer.id,
    'previous_status', v_offer.status
  );
end;
$function$;

comment on function public.redeem_tenant_billing_offer_v1(uuid, uuid, boolean, text, text) is
  'Service-only, idempotent: mark the offer redeemed when its Checkout Session completed (webhook). Same subscription again → unchanged; another subscription → rejected redeemed_elsewhere.';

revoke all on function public.redeem_tenant_billing_offer_v1(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.redeem_tenant_billing_offer_v1(uuid, uuid, boolean, text, text)
  to postgres, service_role;

commit;
