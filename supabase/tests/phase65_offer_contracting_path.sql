-- Offer contracting path regression · phase65
-- Reproduces, with synthetic ids, the exact state of a tenant that pays a Pro
-- offer at the end of an internal trial (SUR4 in Production, 02/11/2026):
--   * internal subscription still 'trialing' with
--     metadata.billing_activation = ready_for_checkout, but its
--     current_period_end is already in the past;
--   * one active UNANCHORED Pro offer (billing_cycle_anchor null), 4000 EUR
--     off for 2 months, redeem_by = deadline + 45 min,
--     promo_ends_before = deadline + 2 months + 45 min.
-- The contracting path must keep working until the deadline:
--   list → accept → prepare_billing_checkout_attempt_v2 reserves (Live) →
--   sync_billing_subscription_v1 converts the internal row
--   (converted_to_stripe) when the Stripe Pro subscription arrives →
--   redeem_tenant_billing_offer_v1 redeems the offer → no second Checkout.
-- Controls: the same tenant without ready_for_checkout stays blocked, and a
-- past current_period_end never changes the outcome (status only, no dates).
-- Generic fixtures: no real tenant ids, no tenant-specific exception.
-- Rollback-only.

begin;

do $phase65$
declare
  v_pro_id constant uuid := '30000000-0000-4000-8000-000000000003';
  v_tenant constant uuid := 'e6500000-0000-4000-8000-000000000001';
  v_t_blocked constant uuid := 'e6500000-0000-4000-8000-000000000002';
  v_owner constant uuid := 'e6500000-0000-4000-8000-0000000000a1';
  v_owner_blocked constant uuid := 'e6500000-0000-4000-8000-0000000000a2';
  v_internal constant uuid := 'e6500000-0000-4000-8000-0000000000b1';
  v_internal_blocked constant uuid := 'e6500000-0000-4000-8000-0000000000b2';
  v_hash constant text := repeat('cd', 32);
  -- Contract deadline in the future (16/11 20:00 Madrid in Production).
  v_deadline timestamptz := date_trunc('second', now()) + interval '14 days';
  v_redeem_by timestamptz;
  v_promo_end timestamptz;
  v_trial_end timestamptz := date_trunc('second', now()) - interval '1 hour';
  v_basic_id uuid;
  v_offer uuid;
  v_res jsonb;
  v_prep jsonb;
  v_sync jsonb;
  v_row record;
  v_count int;
  v_live boolean;
begin
  v_redeem_by := v_deadline + interval '45 minutes';
  v_promo_end := ((v_deadline at time zone 'UTC') + interval '2 months') at time zone 'UTC'
                 + interval '45 minutes';
  select id into v_basic_id from public.plans where code = 'basic' and active;
  if v_basic_id is null or not exists (select 1 from public.plans where id = v_pro_id and code = 'pro' and active) then
    raise exception 'phase65 setup: Basic or Pro plan missing';
  end if;

  -- -------------------------------------------------------------------------
  -- Fixtures
  -- -------------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_owner, 'owner@phase65.test', '{}'::jsonb),
    (v_owner_blocked, 'owner-blocked@phase65.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values
    (v_owner, 'Owner 65'), (v_owner_blocked, 'Owner blocked 65');
  insert into public.tenants (id, name, slug, active) values
    (v_tenant, 'Phase65 offer tenant', 'phase65-offer', true),
    (v_t_blocked, 'Phase65 blocked tenant', 'phase65-blocked', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant, v_owner, 'owner', true),
    (v_t_blocked, v_owner_blocked, 'owner', true);
  -- Internal trial ended an hour ago but nobody changed its status.
  insert into public.subscriptions (
    id, tenant_id, plan_id, provider, status,
    current_period_start, current_period_end, livemode, metadata
  ) values (
    v_internal, v_tenant, v_basic_id, 'internal', 'trialing',
    v_trial_end - interval '30 days', v_trial_end, false,
    '{"source":"phase65","billing_activation":"ready_for_checkout","billing_activation_authorized_by":"owner:phase65"}'::jsonb
  ), (
    v_internal_blocked, v_t_blocked, v_basic_id, 'internal', 'trialing',
    v_trial_end - interval '30 days', v_trial_end, false,
    '{"source":"phase65","billing_activation":"deferred_until_go_live"}'::jsonb
  );

  -- -------------------------------------------------------------------------
  -- A: the unanchored offer is granted and listed as usable (Live)
  -- -------------------------------------------------------------------------
  v_res := public.grant_tenant_billing_offer_v1(v_tenant, 'pro', true, 'P65PRO', 4000, 'eur', 2,
    null, v_promo_end, v_redeem_by, 'phase65-pro-39-v1', 'Pro offer at Basic price, unanchored', 'owner:phase65');
  if v_res ->> 'outcome' <> 'granted' then raise exception 'phase65 A grant: %', v_res; end if;
  v_offer := (v_res ->> 'offer_id')::uuid;

  v_res := public.list_tenant_billing_offers_v1(v_tenant, true);
  if jsonb_array_length(v_res) <> 1
     or (v_res -> 0 ->> 'offer_id')::uuid <> v_offer
     or (v_res -> 0 -> 'billing_cycle_anchor') is distinct from 'null'::jsonb
     or (v_res -> 0 ->> 'discount_amount')::bigint <> 4000
     or (v_res -> 0 ->> 'discount_months')::int <> 2
     or (v_res -> 0 ->> 'redeem_by')::timestamptz <> v_redeem_by
     or (v_res -> 0 ->> 'promo_ends_before')::timestamptz <> v_promo_end
     or (v_res -> 0 ->> 'plan_price_monthly')::numeric <> 79.00
  then
    raise exception 'phase65 A list: %', v_res;
  end if;
  -- Contract deadline is redeem_by − 45 min, and also the last payment time
  -- that still fits 2 discounted months before promo_ends_before.
  if (v_res -> 0 ->> 'redeem_by')::timestamptz - interval '45 minutes' <> v_deadline
     or ((((v_res -> 0 ->> 'promo_ends_before')::timestamptz at time zone 'UTC') - interval '2 months')
         at time zone 'UTC') - interval '45 minutes' <> v_deadline
  then
    raise exception 'phase65 A: deadline must be redeem_by - 45 min';
  end if;

  v_res := public.accept_tenant_billing_offer_v1(v_offer, v_tenant, v_owner, v_hash);
  if v_res ->> 'outcome' <> 'accepted' then raise exception 'phase65 A accept: %', v_res; end if;

  -- -------------------------------------------------------------------------
  -- B: Checkout allowed for the ready tenant, refused for the control tenant
  -- -------------------------------------------------------------------------
  -- Control first: same past trial without ready_for_checkout blocks every mode.
  foreach v_live in array array[true, false] loop
    v_prep := public.prepare_billing_checkout_attempt_v2(v_t_blocked, 'pro', 'month', 'billing', v_live);
    if v_prep ->> 'outcome' is distinct from 'internal_subscription_current' then
      raise exception 'phase65 B control (livemode %): %', v_live, v_prep;
    end if;
  end loop;

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'pro', 'month', 'billing', true);
  if v_prep ->> 'outcome' <> 'reserved'
     or v_prep ->> 'plan_code' <> 'pro'
     or (v_prep ->> 'livemode')::boolean is not true
  then
    raise exception 'phase65 B prepare: %', v_prep;
  end if;
  -- The webhook later marks the attempt completed with its session id.
  update public.billing_checkout_attempts
  set provider_session_id = 'cs_phase65', status = 'completed', updated_at = now()
  where id = (v_prep ->> 'attempt_id')::uuid;

  -- The internal row is untouched by the reservation.
  select * into v_row from public.subscriptions where id = v_internal;
  if v_row.status <> 'trialing' or v_row.metadata ->> 'billing_activation' <> 'ready_for_checkout' then
    raise exception 'phase65 B: prepare changed the internal row: %', to_jsonb(v_row);
  end if;

  -- -------------------------------------------------------------------------
  -- C: the Stripe Pro subscription converts the internal row
  -- -------------------------------------------------------------------------
  v_sync := public.sync_billing_subscription_v1(
    v_tenant, v_pro_id, 'stripe', 'cus_phase65', 'sub_phase65', 'active',
    now(), ((now() at time zone 'UTC') + interval '1 month') at time zone 'UTC', false,
    jsonb_build_object('plan_code', 'pro', 'stripe_event_id', 'evt_phase65_1', 'offer_id', v_offer),
    now(), null, true
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'active' then
    raise exception 'phase65 C sync: %', v_sync;
  end if;
  select * into v_row from public.subscriptions where id = v_internal;
  if v_row.status <> 'canceled'
     or v_row.metadata ->> 'billing_activation' <> 'converted_to_stripe'
     or v_row.metadata ->> 'converted_to_provider_subscription_id' <> 'sub_phase65'
  then
    raise exception 'phase65 C: internal row not converted: % %', v_row.status, v_row.metadata;
  end if;
  select count(*) into v_count from public.subscriptions
  where tenant_id = v_tenant and status in ('trialing', 'active', 'past_due');
  if v_count <> 1 or not exists (
    select 1 from public.subscriptions
    where tenant_id = v_tenant and provider_subscription_id = 'sub_phase65'
      and plan_id = v_pro_id and livemode and status = 'active'
  ) then
    raise exception 'phase65 C: expected only the Stripe Pro row current, got %', v_count;
  end if;
  if exists (select 1 from billing_private.subscription_holds where tenant_id = v_tenant) then
    raise exception 'phase65 C: the conversion must not leave a hold';
  end if;

  -- -------------------------------------------------------------------------
  -- D: the offer is redeemed once, bound to the subscription
  -- -------------------------------------------------------------------------
  v_res := public.redeem_tenant_billing_offer_v1(v_offer, v_tenant, true, 'cs_phase65', 'sub_phase65');
  if v_res ->> 'outcome' <> 'redeemed' or v_res ->> 'previous_status' <> 'active' then
    raise exception 'phase65 D redeem: %', v_res;
  end if;
  v_res := public.redeem_tenant_billing_offer_v1(v_offer, v_tenant, true, 'cs_phase65', 'sub_phase65');
  if v_res ->> 'outcome' <> 'unchanged' then raise exception 'phase65 D replay: %', v_res; end if;
  if jsonb_array_length(public.list_tenant_billing_offers_v1(v_tenant, true)) <> 0 then
    raise exception 'phase65 D: a redeemed offer is still usable';
  end if;

  -- -------------------------------------------------------------------------
  -- E: no second Checkout after the conversion
  -- -------------------------------------------------------------------------
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'pro', 'month', 'billing', true);
  if v_prep ->> 'outcome' <> 'current_subscription_exists' then
    raise exception 'phase65 E: second Checkout must be refused, got %', v_prep;
  end if;
  -- The control tenant is still blocked and untouched.
  select * into v_row from public.subscriptions where id = v_internal_blocked;
  if v_row.status <> 'trialing' or v_row.metadata ->> 'billing_activation' <> 'deferred_until_go_live' then
    raise exception 'phase65 E: control tenant changed: %', to_jsonb(v_row);
  end if;

  raise notice 'phase65 offer contracting path (internal trial past end + unanchored Pro offer) PASS';
end;
$phase65$;

rollback;
