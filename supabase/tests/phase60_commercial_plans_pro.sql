-- Commercial plans Basic/Pro and tenant billing offers · phase60
-- 20261028090000_commercial_plans_pro_offers_v1:
--   Basic 39 EUR: core + quotes + clients_import + 5 GiB.
--   Pro 79 EUR (fixed id): the Basic set + 50 GiB. No AI or early-access rows.
--   Offers: service-only RPCs, one active offer per tenant/plan/mode, owner
--   acceptance with a terms hash, idempotent redemption, audited revocation.
--   Internal → Stripe Pro conversion (D1) and Pro → Basic on the same
--   subscription keep the tenant data and resolve storage from the new plan.
--   D2: plan rights are commercial; clients_import starts held, so plans do
--   not activate it until set_feature_rollout_v1 releases it. A tenant
--   override (A1) still activates it for one tenant.
-- Rollback-only.

begin;

do $phase60$
declare
  v_pro_id constant uuid := '30000000-0000-4000-8000-000000000003';
  v_t_sur constant uuid := 'e6000000-0000-4000-8000-000000000001';
  v_t_other constant uuid := 'e6000000-0000-4000-8000-000000000002';
  v_owner constant uuid := 'e6000000-0000-4000-8000-0000000000a1';
  v_staff constant uuid := 'e6000000-0000-4000-8000-0000000000a2';
  v_owner_other constant uuid := 'e6000000-0000-4000-8000-0000000000a3';
  v_internal constant uuid := 'e6000000-0000-4000-8000-0000000000b1';
  v_hash constant text := repeat('ab', 32);
  v_anchor timestamptz := date_trunc('second', now()) + interval '5 days';
  -- Fixed calendar (D1): anchor + 2 months is the first regular charge.
  v_promo_end timestamptz := ((v_anchor at time zone 'UTC') + interval '2 months') at time zone 'UTC';
  v_redeem_by timestamptz := date_trunc('second', now()) + interval '60 days';
  v_basic_id uuid;
  v_expected text[] := array[
    'activity_log', 'clients_import', 'core_clients', 'core_orders',
    'core_team', 'quotes', 'storage_bytes'
  ];
  v_codes text[];
  v_res jsonb;
  v_offer uuid;
  v_offer_live uuid;
  v_offer_test uuid;
  v_sync jsonb;
  v_sub uuid;
  v_row record;
  v_cap jsonb;
  v_count int;
  v_fn text;
  v_role text;
begin
  -- -------------------------------------------------------------------------
  -- A: catalog
  -- -------------------------------------------------------------------------
  select id into v_basic_id from public.plans where code = 'basic' and active;
  if v_basic_id is null
     or (select price_monthly from public.plans where id = v_basic_id) <> 39.00
  then
    raise exception 'phase60 A: Basic 39 EUR missing';
  end if;
  select * into v_row from public.plans where code = 'pro';
  if v_row.id is distinct from v_pro_id or v_row.price_monthly <> 79.00
     or v_row.currency <> 'EUR' or v_row.active is not true or v_row.price_yearly is not null
  then
    raise exception 'phase60 A: Pro plan wrong: %', to_jsonb(v_row);
  end if;

  -- Rights: Basic and Pro share the feature set; only storage differs.
  foreach v_fn in array array['basic', 'pro'] loop
    select array_agg(f.code order by f.code) into v_codes
    from public.plan_features pf
    join public.plans p on p.id = pf.plan_id
    join public.features f on f.id = pf.feature_id
    where p.code = v_fn and pf.enabled;
    if v_codes is distinct from v_expected then
      raise exception 'phase60 A: % rights %', v_fn, v_codes;
    end if;
  end loop;
  if (select pf.limit_value from public.plan_features pf join public.features f on f.id = pf.feature_id
      where pf.plan_id = v_basic_id and f.code = 'storage_bytes') <> 5368709120
     or (select pf.limit_value from public.plan_features pf join public.features f on f.id = pf.feature_id
         where pf.plan_id = v_pro_id and f.code = 'storage_bytes') <> 53687091200
  then
    raise exception 'phase60 A: storage must be Basic 5 GiB, Pro 50 GiB';
  end if;
  -- Early access (…008) and AI voice (…009) stay out of every plan.
  if exists (
    select 1 from public.plan_features pf
    where pf.feature_id in ('31000000-0000-4000-8000-000000000008', '31000000-0000-4000-8000-000000000009')
  ) then
    raise exception 'phase60 A: early access or AI attached to a plan';
  end if;
  -- D2: clients_import is a plan right on hold; nothing else is held.
  select array_agg(f.code || ':' || r.state order by f.code) into v_codes
  from billing_private.feature_rollouts r
  join public.features f on f.id = r.feature_id;
  if v_codes is distinct from array['clients_import:held'] then
    raise exception 'phase60 A: rollouts %', v_codes;
  end if;

  -- -------------------------------------------------------------------------
  -- B: privileges (table and RPCs service-only, SECURITY DEFINER, empty path)
  -- -------------------------------------------------------------------------
  if not (select c.relrowsecurity from pg_class c
          where c.oid = 'billing_private.tenant_billing_offers'::regclass) then
    raise exception 'phase60 B: offers table without RLS';
  end if;
  if not (select c.relrowsecurity from pg_class c
          where c.oid = 'billing_private.feature_rollouts'::regclass) then
    raise exception 'phase60 B: rollouts table without RLS';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'billing_private.tenant_billing_offers', 'select')
       or has_table_privilege(v_role, 'billing_private.tenant_billing_offers', 'insert')
       or has_table_privilege(v_role, 'billing_private.tenant_billing_offers', 'update')
    then
      raise exception 'phase60 B: % can touch the offers table directly', v_role;
    end if;
    if has_table_privilege(v_role, 'billing_private.feature_rollouts', 'select')
       or has_table_privilege(v_role, 'billing_private.feature_rollouts', 'insert')
       or has_table_privilege(v_role, 'billing_private.feature_rollouts', 'update')
    then
      raise exception 'phase60 B: % can touch the rollouts table directly', v_role;
    end if;
  end loop;
  -- The resolver keeps its grants and definer settings after the redefinition.
  if not has_function_privilege('authenticated', 'public.tenant_has_feature(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.tenant_has_feature(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.tenant_has_feature(uuid, text)', 'execute')
     or not exists (
       select 1 from pg_proc p
       where p.oid = 'public.tenant_has_feature(uuid, text)'::regprocedure and p.prosecdef
         and p.proconfig @> array['search_path=""'] and p.provolatile = 's'
     )
  then
    raise exception 'phase60 B: tenant_has_feature grants or settings changed';
  end if;
  foreach v_fn in array array[
    'public.set_feature_rollout_v1(text, text, text, text)',
    'public.grant_tenant_billing_offer_v1(uuid, text, boolean, text, bigint, text, integer, timestamp with time zone, timestamp with time zone, timestamp with time zone, text, text, text)',
    'public.revoke_tenant_billing_offer_v1(uuid, text, text)',
    'public.list_tenant_billing_offers_v1(uuid, boolean, boolean)',
    'public.accept_tenant_billing_offer_v1(uuid, uuid, uuid, text)',
    'public.redeem_tenant_billing_offer_v1(uuid, uuid, boolean, text, text)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('public', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute')
    then
      raise exception 'phase60 B: wrong execute grants on %', v_fn;
    end if;
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_fn::regprocedure and p.prosecdef
        and p.proconfig @> array['search_path=""']
    ) then
      raise exception 'phase60 B: % must be SECURITY DEFINER with empty search_path', v_fn;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- Fixtures: a SUR4-shaped tenant on an internal Basic trial, another tenant.
  -- -------------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_owner, 'owner@phase60.test', '{}'::jsonb),
    (v_staff, 'staff@phase60.test', '{}'::jsonb),
    (v_owner_other, 'owner-other@phase60.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values
    (v_owner, 'Owner 60'), (v_staff, 'Staff 60'), (v_owner_other, 'Owner other 60');
  insert into public.tenants (id, name, slug, active) values
    (v_t_sur, 'Phase60 SUR4-like', 'phase60-sur', true),
    (v_t_other, 'Phase60 Other', 'phase60-other', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_t_sur, v_owner, 'owner', true),
    (v_t_sur, v_staff, 'staff', true),
    (v_t_other, v_owner_other, 'owner', true);
  insert into public.subscriptions (
    id, tenant_id, plan_id, provider, status,
    current_period_start, current_period_end, metadata
  ) values (
    v_internal, v_t_sur, v_basic_id, 'internal', 'trialing',
    now() - interval '30 days', now() + interval '5 days',
    '{"source":"phase60","billing_activation":"deferred_until_go_live"}'::jsonb
  );
  -- Tenant data, written as its owner (activity log needs a user).
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  set local role authenticated;
  insert into public.clients (tenant_id, name)
  select v_t_sur, 'Phase60 client ' || g from generate_series(1, 3) g;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  -- -------------------------------------------------------------------------
  -- C: grant validation
  -- -------------------------------------------------------------------------
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'bad coupon!', 4000, 'eur', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'invalid_input' then raise exception 'phase60 C coupon id: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'short', 'owner:phase60');
  if v_res ->> 'reason' <> 'reason_required' then raise exception 'phase60 C reason: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', '  ');
  if v_res ->> 'reason' <> 'authorization_required' then raise exception 'phase60 C authorizer: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'enterprise', true, 'P60PRO', 4000, 'eur', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'plan_not_found' then raise exception 'phase60 C plan: %', v_res; end if;
  -- The discount must leave a positive price, in the plan currency.
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 7900, 'eur', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'invalid_discount' then raise exception 'phase60 C full discount: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'usd', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'invalid_discount' then raise exception 'phase60 C currency: %', v_res; end if;
  -- Dates: redeem_by in the future, anchor in the future and before the promo end.
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 2,
    v_anchor, v_promo_end, now() - interval '1 minute', 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'invalid_dates' then raise exception 'phase60 C redeem_by: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 2,
    now() - interval '1 minute', v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'invalid_dates' then raise exception 'phase60 C past anchor: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 2,
    v_promo_end, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'invalid_dates' then raise exception 'phase60 C anchor at promo end: %', v_res; end if;
  -- D1: anchored offers end exactly at promo_ends_before; unanchored ones must
  -- still fit their months before it.
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 2,
    v_anchor, v_promo_end + interval '1 day', v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'calendar_mismatch' then raise exception 'phase60 C calendar anchored: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 1,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'calendar_mismatch' then raise exception 'phase60 C calendar months: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'eur', 2,
    null, now() + interval '30 days', v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'calendar_mismatch' then raise exception 'phase60 C calendar unanchored: %', v_res; end if;
  v_res := public.grant_tenant_billing_offer_v1('e6000000-0000-4000-8000-0000000000ff', 'pro', true, 'P60PRO', 4000, 'eur', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'tenant_not_found' then raise exception 'phase60 C tenant: %', v_res; end if;
  if exists (select 1 from billing_private.tenant_billing_offers where tenant_id = v_t_sur) then
    raise exception 'phase60 C: a rejected grant wrote a row';
  end if;

  -- Grant: one active offer per tenant, plan and mode.
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO', 4000, 'EUR', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', ' SUR4 Pro at Basic price ', ' owner:phase60 ');
  if v_res ->> 'outcome' <> 'granted' or v_res ->> 'plan_code' <> 'pro' then
    raise exception 'phase60 C grant: %', v_res;
  end if;
  v_offer_live := (v_res ->> 'offer_id')::uuid;
  select * into v_row from billing_private.tenant_billing_offers where id = v_offer_live;
  if v_row.currency <> 'eur' or v_row.reason <> 'SUR4 Pro at Basic price'
     or v_row.authorized_by <> 'owner:phase60' or v_row.status <> 'active'
     or jsonb_array_length(v_row.history) <> 1 or v_row.history -> 0 ->> 'action' <> 'granted'
  then
    raise exception 'phase60 C grant row: %', to_jsonb(v_row);
  end if;
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO2', 4000, 'eur', 2,
    v_anchor, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price', 'owner:phase60');
  if v_res ->> 'reason' <> 'offer_exists' then raise exception 'phase60 C duplicate: %', v_res; end if;
  -- Test mode is a separate offer (separate Stripe coupon).
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', false, 'P60PROTEST', 4000, 'eur', 2,
    null, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'SUR4 Pro at Basic price (test)', 'owner:phase60');
  if v_res ->> 'outcome' <> 'granted' then raise exception 'phase60 C test mode grant: %', v_res; end if;
  v_offer_test := (v_res ->> 'offer_id')::uuid;

  -- -------------------------------------------------------------------------
  -- D: list per tenant and mode; usable only (active, before redeem_by)
  -- -------------------------------------------------------------------------
  v_res := public.list_tenant_billing_offers_v1(v_t_sur, true);
  if jsonb_array_length(v_res) <> 1 or (v_res -> 0 ->> 'offer_id')::uuid <> v_offer_live
     or (v_res -> 0 ->> 'discount_amount')::bigint <> 4000
     or (v_res -> 0 ->> 'plan_price_monthly')::numeric <> 79.00
     or (v_res -> 0 ->> 'billing_cycle_anchor')::timestamptz <> v_anchor
     or v_res -> 0 ->> 'provider_coupon_id' <> 'P60PRO'
  then
    raise exception 'phase60 D live list: %', v_res;
  end if;
  v_res := public.list_tenant_billing_offers_v1(v_t_sur, false);
  if jsonb_array_length(v_res) <> 1 or (v_res -> 0 ->> 'offer_id')::uuid <> v_offer_test then
    raise exception 'phase60 D test list: %', v_res;
  end if;
  if jsonb_array_length(public.list_tenant_billing_offers_v1(v_t_other, true)) <> 0 then
    raise exception 'phase60 D: offers leaked to another tenant';
  end if;
  -- A past redeem_by hides the offer from the usable list.
  update billing_private.tenant_billing_offers set redeem_by = now() - interval '1 second' where id = v_offer_test;
  if jsonb_array_length(public.list_tenant_billing_offers_v1(v_t_sur, false)) <> 0
     or jsonb_array_length(public.list_tenant_billing_offers_v1(v_t_sur, false, true)) <> 1
  then
    raise exception 'phase60 D: expired offer still usable';
  end if;

  -- -------------------------------------------------------------------------
  -- E: acceptance by an active owner of the tenant only
  -- -------------------------------------------------------------------------
  v_res := public.accept_tenant_billing_offer_v1(v_offer_live, v_t_sur, v_owner, 'not-a-hash');
  if v_res ->> 'reason' <> 'invalid_input' then raise exception 'phase60 E hash: %', v_res; end if;
  v_res := public.accept_tenant_billing_offer_v1(v_offer_live, v_t_sur, v_staff, v_hash);
  if v_res ->> 'reason' <> 'owner_required' then raise exception 'phase60 E staff: %', v_res; end if;
  v_res := public.accept_tenant_billing_offer_v1(v_offer_live, v_t_sur, v_owner_other, v_hash);
  if v_res ->> 'reason' <> 'owner_required' then raise exception 'phase60 E other owner: %', v_res; end if;
  v_res := public.accept_tenant_billing_offer_v1(v_offer_live, v_t_other, v_owner_other, v_hash);
  if v_res ->> 'reason' <> 'offer_not_found' then raise exception 'phase60 E other tenant: %', v_res; end if;
  v_res := public.accept_tenant_billing_offer_v1(v_offer_test, v_t_sur, v_owner, v_hash);
  if v_res ->> 'reason' <> 'offer_not_active' then raise exception 'phase60 E expired: %', v_res; end if;
  v_res := public.accept_tenant_billing_offer_v1(v_offer_live, v_t_sur, v_owner, v_hash);
  if v_res ->> 'outcome' <> 'accepted' then raise exception 'phase60 E accept: %', v_res; end if;
  select * into v_row from billing_private.tenant_billing_offers where id = v_offer_live;
  if v_row.accepted_by <> v_owner or v_row.accepted_terms_hash <> v_hash or v_row.accepted_at is null
     or v_row.history -> -1 ->> 'action' <> 'accepted'
  then
    raise exception 'phase60 E acceptance not recorded: %', to_jsonb(v_row);
  end if;

  -- -------------------------------------------------------------------------
  -- F: internal trial → Stripe Pro (D1 ready_for_checkout), rights from Pro
  -- -------------------------------------------------------------------------
  v_res := public.set_internal_billing_activation_v1(
    v_t_sur, 'ready_for_checkout', 'Phase60 cutover to Stripe Pro', 'owner:phase60');
  if v_res ->> 'outcome' <> 'updated' then raise exception 'phase60 F ready: %', v_res; end if;

  v_sync := public.sync_billing_subscription_v1(
    v_t_sur, v_pro_id, 'stripe', 'cus_phase60', 'sub_phase60', 'active',
    now(), v_anchor, false,
    '{"plan_code":"pro","stripe_event_id":"evt_phase60_1"}'::jsonb,
    now(), null, true
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'active' then
    raise exception 'phase60 F sync Pro: %', v_sync;
  end if;
  select * into v_row from public.subscriptions where id = v_internal;
  if v_row.status <> 'canceled' or v_row.metadata ->> 'billing_activation' <> 'converted_to_stripe'
     or v_row.metadata ->> 'converted_to_provider_subscription_id' <> 'sub_phase60'
  then
    raise exception 'phase60 F: internal row not converted: %', v_row.metadata;
  end if;
  select count(*) into v_count from public.subscriptions
  where tenant_id = v_t_sur and status in ('trialing', 'active', 'past_due');
  select id into v_sub from public.subscriptions where provider_subscription_id = 'sub_phase60';
  if v_count <> 1 or v_sub is null then
    raise exception 'phase60 F: expected one current subscription, got %', v_count;
  end if;
  v_cap := public.resolve_tenant_storage_capacity_v1(v_t_sur);
  if (v_cap ->> 'limit_bytes')::bigint <> 53687091200 or v_cap ->> 'source' <> 'current_plan' then
    raise exception 'phase60 F: Pro capacity %', v_cap;
  end if;
  -- clients_import is a Pro right but held (D2): off until released.
  if not public.tenant_has_feature(v_t_sur, 'quotes')
     or public.tenant_has_feature(v_t_sur, 'clients_import')
     or public.tenant_has_feature(v_t_sur, 'ai_voice_orders')
  then
    raise exception 'phase60 F: Pro rights wrong';
  end if;

  -- -------------------------------------------------------------------------
  -- R: operational activation (D2) — validation, per-tenant override, release
  -- -------------------------------------------------------------------------
  v_res := public.set_feature_rollout_v1('clients_import', 'on', 'phase60 rollout test', 'phase60');
  if v_res ->> 'reason' <> 'invalid_input' then raise exception 'phase60 R input: %', v_res; end if;
  v_res := public.set_feature_rollout_v1('clients_import', 'released', 'short', 'phase60');
  if v_res ->> 'reason' <> 'reason_required' then raise exception 'phase60 R reason: %', v_res; end if;
  v_res := public.set_feature_rollout_v1('clients_import', 'released', 'phase60 rollout test', ' ');
  if v_res ->> 'reason' <> 'authorization_required' then raise exception 'phase60 R auth: %', v_res; end if;
  v_res := public.set_feature_rollout_v1('no_such_feature', 'released', 'phase60 rollout test', 'phase60');
  if v_res ->> 'reason' <> 'feature_not_found' then raise exception 'phase60 R feature: %', v_res; end if;
  v_res := public.set_feature_rollout_v1('clients_import', 'held', 'phase60 rollout test', 'phase60');
  if v_res ->> 'outcome' <> 'unchanged' then raise exception 'phase60 R held again: %', v_res; end if;

  -- Controlled activation for one tenant while held: an audited A1 override.
  perform public.set_tenant_feature_v2(
    'phase60-other', 'clients_import', true, null, 'phase60 controlled activation', null, 'phase60'
  );
  if not public.tenant_has_feature(v_t_other, 'clients_import')
     or public.tenant_has_feature(v_t_sur, 'clients_import')
  then
    raise exception 'phase60 R: override must activate only that tenant';
  end if;

  v_res := public.set_feature_rollout_v1('clients_import', 'released', 'phase60 rollout release', 'phase60');
  if v_res ->> 'outcome' <> 'set' or v_res ->> 'previous_state' <> 'held' then
    raise exception 'phase60 R release: %', v_res;
  end if;
  v_res := public.set_feature_rollout_v1('clients_import', 'released', 'phase60 rollout release', 'phase60');
  if v_res ->> 'outcome' <> 'unchanged' then raise exception 'phase60 R release twice: %', v_res; end if;
  if not public.tenant_has_feature(v_t_sur, 'clients_import') then
    raise exception 'phase60 R: released right must apply through the plan';
  end if;
  if (select pg_catalog.jsonb_array_length(r.history) from billing_private.feature_rollouts r
      join public.features f on f.id = r.feature_id where f.code = 'clients_import') <> 2
  then
    raise exception 'phase60 R: rollout history must have 2 entries';
  end if;

  -- -------------------------------------------------------------------------
  -- G: redemption (webhook) is idempotent and bound to tenant, mode, subscription
  -- -------------------------------------------------------------------------
  v_res := public.redeem_tenant_billing_offer_v1(v_offer_live, v_t_sur, true, ' ', 'sub_phase60');
  if v_res ->> 'reason' <> 'invalid_input' then raise exception 'phase60 G input: %', v_res; end if;
  v_res := public.redeem_tenant_billing_offer_v1(v_offer_live, v_t_other, true, 'cs_phase60', 'sub_phase60');
  if v_res ->> 'reason' <> 'offer_mismatch' then raise exception 'phase60 G tenant: %', v_res; end if;
  v_res := public.redeem_tenant_billing_offer_v1(v_offer_live, v_t_sur, false, 'cs_phase60', 'sub_phase60');
  if v_res ->> 'reason' <> 'offer_mismatch' then raise exception 'phase60 G mode: %', v_res; end if;
  v_res := public.redeem_tenant_billing_offer_v1(v_offer_live, v_t_sur, true, 'cs_phase60', 'sub_phase60');
  if v_res ->> 'outcome' <> 'redeemed' or v_res ->> 'previous_status' <> 'active' then
    raise exception 'phase60 G redeem: %', v_res;
  end if;
  v_res := public.redeem_tenant_billing_offer_v1(v_offer_live, v_t_sur, true, 'cs_phase60', 'sub_phase60');
  if v_res ->> 'outcome' <> 'unchanged' then raise exception 'phase60 G replay: %', v_res; end if;
  v_res := public.redeem_tenant_billing_offer_v1(v_offer_live, v_t_sur, true, 'cs_phase60_b', 'sub_phase60_b');
  if v_res ->> 'reason' <> 'redeemed_elsewhere' then raise exception 'phase60 G second sub: %', v_res; end if;
  v_res := public.revoke_tenant_billing_offer_v1(v_offer_live, 'Withdraw after payment', 'owner:phase60');
  if v_res ->> 'reason' <> 'already_redeemed' then raise exception 'phase60 G revoke redeemed: %', v_res; end if;
  if jsonb_array_length(public.list_tenant_billing_offers_v1(v_t_sur, true)) <> 0 then
    raise exception 'phase60 G: a redeemed offer is still usable';
  end if;
  -- After redemption a new offer for the same plan and mode can be granted.
  v_res := public.grant_tenant_billing_offer_v1(v_t_sur, 'pro', true, 'P60PRO3', 4000, 'eur', 2,
    null, v_promo_end, v_redeem_by, 'sur4-pro-39-v1', 'Second offer after redemption', 'owner:phase60');
  if v_res ->> 'outcome' <> 'granted' then raise exception 'phase60 G regrant: %', v_res; end if;
  v_offer := (v_res ->> 'offer_id')::uuid;

  -- -------------------------------------------------------------------------
  -- H: revocation (reason, idempotence, open Checkout reported, late payment)
  -- -------------------------------------------------------------------------
  insert into public.billing_checkout_attempts (
    tenant_id, provider, provider_session_id, status, plan_code, billing_interval, expires_at, livemode
  ) values (
    v_t_sur, 'stripe', 'cs_phase60_open', 'open', 'pro', 'month', now() + interval '1 hour', true
  );
  v_res := public.revoke_tenant_billing_offer_v1(v_offer, 'short', 'owner:phase60');
  if v_res ->> 'reason' <> 'reason_required' then raise exception 'phase60 H reason: %', v_res; end if;
  v_res := public.revoke_tenant_billing_offer_v1(v_offer, 'Commercial decision changed', 'owner:phase60');
  if v_res ->> 'outcome' <> 'revoked' or (v_res ->> 'open_checkout_attempts')::int <> 1 then
    raise exception 'phase60 H revoke: %', v_res;
  end if;
  v_res := public.revoke_tenant_billing_offer_v1(v_offer, 'Commercial decision changed', 'owner:phase60');
  if v_res ->> 'outcome' <> 'unchanged' then raise exception 'phase60 H revoke again: %', v_res; end if;
  v_res := public.accept_tenant_billing_offer_v1(v_offer, v_t_sur, v_owner, v_hash);
  if v_res ->> 'reason' <> 'offer_not_active' then raise exception 'phase60 H accept revoked: %', v_res; end if;
  -- A Checkout paid before it was expired is still recorded, with its trail.
  v_res := public.redeem_tenant_billing_offer_v1(v_offer, v_t_sur, true, 'cs_phase60_open', 'sub_phase60_late');
  if v_res ->> 'outcome' <> 'redeemed' or v_res ->> 'previous_status' <> 'revoked' then
    raise exception 'phase60 H late payment: %', v_res;
  end if;
  select * into v_row from billing_private.tenant_billing_offers where id = v_offer;
  if jsonb_array_length(v_row.history) <> 3
     or v_row.history -> 1 ->> 'action' <> 'revoked'
     or v_row.history -> 2 ->> 'previous_status' <> 'revoked'
  then
    raise exception 'phase60 H history: %', v_row.history;
  end if;

  -- -------------------------------------------------------------------------
  -- I: Pro → Basic on the same Stripe subscription keeps the data
  -- -------------------------------------------------------------------------
  v_sync := public.sync_billing_subscription_v1(
    v_t_sur, v_basic_id, 'stripe', 'cus_phase60', 'sub_phase60', 'active',
    v_anchor, v_anchor + interval '1 month', false,
    '{"plan_code":"basic","stripe_event_id":"evt_phase60_2"}'::jsonb,
    now() + interval '1 second', null, true
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'active' then
    raise exception 'phase60 I downgrade sync: %', v_sync;
  end if;
  select * into v_row from public.subscriptions where provider_subscription_id = 'sub_phase60';
  if v_row.id <> v_sub or v_row.plan_id <> v_basic_id then
    raise exception 'phase60 I: downgrade must update the same row to Basic';
  end if;
  select count(*) into v_count from public.subscriptions
  where tenant_id = v_t_sur and status in ('trialing', 'active', 'past_due');
  if v_count <> 1 then raise exception 'phase60 I: % current subscriptions', v_count; end if;
  if (select count(*) from public.clients where tenant_id = v_t_sur) <> 3 then
    raise exception 'phase60 I: tenant data changed on downgrade';
  end if;
  v_cap := public.resolve_tenant_storage_capacity_v1(v_t_sur);
  if (v_cap ->> 'limit_bytes')::bigint <> 5368709120 or v_cap ->> 'source' <> 'current_plan' then
    raise exception 'phase60 I: Basic capacity %', v_cap;
  end if;
  if not public.tenant_has_feature(v_t_sur, 'quotes')
     or not public.tenant_has_feature(v_t_sur, 'clients_import')
  then
    raise exception 'phase60 I: Basic must keep quotes and clients_import (released)';
  end if;
  -- Holding again turns the plan right off; quotes is never held.
  v_res := public.set_feature_rollout_v1('clients_import', 'held', 'phase60 rollout hold again', 'phase60');
  if v_res ->> 'previous_state' <> 'released'
     or public.tenant_has_feature(v_t_sur, 'clients_import')
     or not public.tenant_has_feature(v_t_sur, 'quotes')
  then
    raise exception 'phase60 I: hold again %', v_res;
  end if;

  raise notice 'phase60 commercial plans Basic/Pro and tenant billing offers PASS';
end;
$phase60$;

rollback;
