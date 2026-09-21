-- Billing Foundation V1 · schema + plan seed + sync RPC invariants.
-- Does NOT mutate demo/sur4 real data: uses disposable test tenants only.

begin;

do $phase23$
declare
  v_owner uuid := 'e2300000-0000-4000-8000-000000000001';
  v_tenant uuid := 'e2300000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e2300000-0000-4000-8000-000000000012';
  v_mvp_id uuid;
  v_basic_id uuid;
  v_price_test uuid;
  v_price_live uuid;
  v_sub_mvp uuid;
  v_sync jsonb;
  v_sub_stripe uuid;
  v_count int;
  v_demo_plan text;
  v_demo_provider text;
  v_demo_status text;
  v_sur4_plan text;
  v_sur4_provider text;
  v_sur4_status text;
  v_ok boolean;
begin
  -- Snapshot demo/sur4 must remain untouched after this suite.
  select p.code, s.provider, s.status
  into v_demo_plan, v_demo_provider, v_demo_status
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'demo'
  limit 1;

  select p.code, s.provider, s.status
  into v_sur4_plan, v_sur4_provider, v_sur4_status
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'sur4'
  limit 1;

  -- -------------------------------------------------------------------------
  -- Plan Basic
  -- -------------------------------------------------------------------------
  select count(*)::int into v_count from public.plans where code = 'basic';
  if v_count <> 1 then
    raise exception 'phase23: expected exactly one basic plan, got %', v_count;
  end if;

  select id into v_basic_id from public.plans where code = 'basic';
  select id into v_mvp_id from public.plans where code = 'mvp';

  if v_mvp_id is null then
    raise exception 'phase23: mvp plan missing';
  end if;

  if not exists (
    select 1
    from public.plans
    where code = 'basic'
      and name = 'Gestcopy Basic'
      and price_monthly = 39.00
      and price_yearly is null
      and currency = 'EUR'
      and active is true
  ) then
    raise exception 'phase23: basic plan fields mismatch';
  end if;

  select count(*)::int into v_count
  from public.plan_features pf
  join public.features f on f.id = pf.feature_id
  where pf.plan_id = v_basic_id
    and f.code in ('activity_log', 'core_clients', 'core_orders', 'core_team')
    and pf.enabled is true
    and pf.limit_value is null;

  if v_count <> 4 then
    raise exception 'phase23: basic core features mismatch (% )', v_count;
  end if;

  if exists (
    select 1
    from public.plan_features pf
    join public.features f on f.id = pf.feature_id
    where pf.plan_id = v_basic_id
      and f.code = 'storage_bytes'
  ) then
    raise exception 'phase23: basic must not have storage_bytes plan_feature';
  end if;

  -- mvp intact: still 0 EUR and no storage_bytes attachment required by B1
  if not exists (
    select 1 from public.plans
    where code = 'mvp' and price_monthly = 0 and active is true
  ) then
    raise exception 'phase23: mvp altered unexpectedly';
  end if;

  if exists (
    select 1
    from public.plan_features pf
    join public.features f on f.id = pf.feature_id
    where pf.plan_id = v_mvp_id
      and f.code = 'storage_bytes'
  ) then
    raise exception 'phase23: mvp unexpectedly gained storage_bytes';
  end if;

  -- -------------------------------------------------------------------------
  -- billing_prices constraints
  -- -------------------------------------------------------------------------
  insert into public.billing_prices (
    plan_id, provider, provider_product_id, provider_price_id,
    billing_interval, currency, unit_amount, livemode, active
  ) values (
    v_basic_id, 'stripe', 'prod_test_basic', 'price_test_basic_month',
    'month', 'EUR', 3900, false, true
  )
  returning id into v_price_test;

  insert into public.billing_prices (
    plan_id, provider, provider_product_id, provider_price_id,
    billing_interval, currency, unit_amount, livemode, active
  ) values (
    v_basic_id, 'stripe', 'prod_live_basic', 'price_live_basic_month',
    'month', 'EUR', 3900, true, true
  )
  returning id into v_price_live;

  -- duplicate provider_price_id rejected
  begin
    insert into public.billing_prices (
      plan_id, provider, provider_product_id, provider_price_id,
      billing_interval, currency, unit_amount, livemode, active
    ) values (
      v_basic_id, 'stripe', 'prod_other', 'price_test_basic_month',
      'month', 'EUR', 3900, false, false
    );
    raise exception 'phase23: expected duplicate provider_price_id to fail';
  exception
    when unique_violation then
      null;
  end;

  -- second active for same plan/interval/mode rejected
  begin
    insert into public.billing_prices (
      plan_id, provider, provider_product_id, provider_price_id,
      billing_interval, currency, unit_amount, livemode, active
    ) values (
      v_basic_id, 'stripe', 'prod_test_basic_2', 'price_test_basic_month_2',
      'month', 'EUR', 3900, false, true
    );
    raise exception 'phase23: expected second active price to fail';
  exception
    when unique_violation then
      null;
  end;

  -- historical inactive allowed alongside active
  insert into public.billing_prices (
    plan_id, provider, provider_product_id, provider_price_id,
    billing_interval, currency, unit_amount, livemode, active
  ) values (
    v_basic_id, 'stripe', 'prod_test_basic_old', 'price_test_basic_month_old',
    'month', 'EUR', 2900, false, false
  );

  -- authenticated cannot write
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  begin
    insert into public.billing_prices (
      plan_id, provider, provider_product_id, provider_price_id,
      billing_interval, currency, unit_amount, livemode, active
    ) values (
      v_basic_id, 'stripe', 'prod_auth', 'price_auth_denied',
      'month', 'EUR', 3900, false, true
    );
    raise exception 'phase23: authenticated must not insert billing_prices';
  exception
    when insufficient_privilege then
      null;
  end;

  execute 'reset role';

  -- -------------------------------------------------------------------------
  -- billing_webhook_events
  -- -------------------------------------------------------------------------
  insert into public.billing_webhook_events (
    provider, provider_event_id, event_type, livemode, status
  ) values (
    'stripe', 'evt_phase23_1', 'customer.subscription.updated', false, 'received'
  );

  begin
    insert into public.billing_webhook_events (
      provider, provider_event_id, event_type, livemode, status
    ) values (
      'stripe', 'evt_phase23_1', 'customer.subscription.updated', false, 'received'
    );
    raise exception 'phase23: duplicate webhook event id must fail';
  exception
    when unique_violation then
      null;
  end;

  execute 'set local role authenticated';

  begin
    insert into public.billing_webhook_events (
      provider, provider_event_id, event_type, livemode, status
    ) values (
      'stripe', 'evt_phase23_auth', 'invoice.paid', false, 'received'
    );
    raise exception 'phase23: authenticated must not write webhook events';
  exception
    when insufficient_privilege then
      null;
  end;

  v_ok := true;
  begin
    select count(*)::int into v_count from public.billing_webhook_events;
    if v_count > 0 then
      v_ok := false;
    end if;
  exception
    when insufficient_privilege then
      v_ok := true;
  end;

  if not v_ok then
    raise exception 'phase23: authenticated must not read webhook events';
  end if;

  execute 'reset role';

  -- -------------------------------------------------------------------------
  -- Disposable tenants for subscription hardening + sync
  -- -------------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner@phase23.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into public.profiles (id, full_name) values (v_owner, 'Phase23 Owner');

  insert into public.tenants (id, name, slug, active)
  values
    (v_tenant, 'Phase23 Tenant A', 'phase23-tenant-a', true),
    (v_tenant_b, 'Phase23 Tenant B', 'phase23-tenant-b', true);

  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant, v_owner, 'owner', true);

  insert into public.subscriptions (
    id, tenant_id, plan_id, provider, status,
    current_period_start, current_period_end, cancel_at_period_end
  ) values (
    'e2300000-0000-4000-8000-000000000061',
    v_tenant, v_mvp_id, 'internal', 'active',
    now(), now() + interval '1 year', false
  )
  returning id into v_sub_mvp;

  -- historical canceled allowed with same tenant
  insert into public.subscriptions (
    tenant_id, plan_id, provider, status, cancel_at_period_end
  ) values (
    v_tenant, v_mvp_id, 'internal', 'canceled', false
  );

  -- provider_subscription_id uniqueness
  insert into public.subscriptions (
    tenant_id, plan_id, provider, provider_subscription_id, status
  ) values (
    v_tenant_b, v_basic_id, 'stripe', 'sub_phase23_unique', 'canceled'
  );

  begin
    insert into public.subscriptions (
      tenant_id, plan_id, provider, provider_subscription_id, status
    ) values (
      v_tenant, v_basic_id, 'stripe', 'sub_phase23_unique', 'canceled'
    );
    raise exception 'phase23: duplicate provider_subscription_id must fail';
  exception
    when unique_violation then
      null;
  end;

  -- one-current still enforced
  begin
    insert into public.subscriptions (
      tenant_id, plan_id, provider, status
    ) values (
      v_tenant, v_mvp_id, 'internal', 'active'
    );
    raise exception 'phase23: second current subscription must fail';
  exception
    when unique_violation then
      null;
  end;

  -- sync: mvp/internal current → canceled; basic/stripe current inserted
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase23',
    'sub_phase23_sync',
    'active',
    now(),
    now() + interval '30 days',
    false,
    '{}'::jsonb
  );

  v_sub_stripe := (v_sync ->> 'subscription_id')::uuid;

  select count(*)::int into v_count
  from public.subscriptions
  where tenant_id = v_tenant
    and status = any (array['trialing', 'active', 'past_due']);

  if v_count <> 1 then
    raise exception 'phase23: expected exactly one current after sync, got %', v_count;
  end if;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_mvp and status = 'canceled'
  ) then
    raise exception 'phase23: previous mvp current was not canceled';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_stripe
      and provider = 'stripe'
      and provider_subscription_id = 'sub_phase23_sync'
      and status = 'active'
      and plan_id = v_basic_id
  ) then
    raise exception 'phase23: stripe current subscription missing';
  end if;

  -- idempotent sync
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase23',
    'sub_phase23_sync',
    'active',
    now(),
    now() + interval '30 days',
    true,
    '{"source":"phase23"}'::jsonb
  );

  if (v_sync ->> 'subscription_id')::uuid <> v_sub_stripe then
    raise exception 'phase23: sync not idempotent by provider_subscription_id';
  end if;

  select count(*)::int into v_count
  from public.subscriptions
  where tenant_id = v_tenant
    and status = any (array['trialing', 'active', 'past_due']);

  if v_count <> 1 then
    raise exception 'phase23: idempotent sync broke one-current';
  end if;

  -- authenticated cannot execute sync
  execute 'set local role authenticated';
  begin
    perform public.sync_billing_subscription_v1(
      v_tenant,
      v_basic_id,
      'stripe',
      'cus_x',
      'sub_x',
      'active',
      now(),
      now() + interval '30 days',
      false,
      '{}'::jsonb
    );
    raise exception 'phase23: authenticated must not execute sync RPC';
  exception
    when insufficient_privilege then
      null;
  end;
  execute 'reset role';

  -- Cleanup disposable prices (leave seed catalog empty of fake Stripe IDs)
  delete from public.billing_prices
  where provider_price_id like 'price_%phase23%'
     or provider_price_id like 'price_test_basic%'
     or provider_price_id like 'price_live_basic%'
     or provider_price_id like 'price_auth%';

  delete from public.billing_webhook_events
  where provider_event_id like 'evt_phase23%';

  delete from public.subscriptions where tenant_id in (v_tenant, v_tenant_b);
  delete from public.memberships where tenant_id = v_tenant;
  delete from public.tenants where id in (v_tenant, v_tenant_b);
  delete from public.profiles where id = v_owner;
  delete from auth.users where id = v_owner;

  -- Verify demo/sur4 unchanged when present
  if v_demo_plan is not null then
    if not exists (
      select 1
      from public.tenants t
      join public.subscriptions s on s.tenant_id = t.id
      join public.plans p on p.id = s.plan_id
      where t.slug = 'demo'
        and p.code = v_demo_plan
        and s.provider = v_demo_provider
        and s.status = v_demo_status
    ) then
      raise exception 'phase23: demo subscription mutated';
    end if;
  end if;

  if v_sur4_plan is not null then
    if not exists (
      select 1
      from public.tenants t
      join public.subscriptions s on s.tenant_id = t.id
      join public.plans p on p.id = s.plan_id
      where t.slug = 'sur4'
        and p.code = v_sur4_plan
        and s.provider = v_sur4_provider
        and s.status = v_sur4_status
    ) then
      raise exception 'phase23: sur4 subscription mutated';
    end if;
  end if;

  raise notice 'phase23_billing_foundation: ok';
end;
$phase23$;

rollback;
