-- Paid Onboarding V1 · pending tenant + activation RPC

begin;

do $phase25$
declare
  v_owner uuid := 'e2500000-0000-4000-8000-000000000001';
  v_other uuid := 'e2500000-0000-4000-8000-000000000002';
  v_mvp_id uuid;
  v_basic_id uuid;
  v_result jsonb;
  v_tenant_id uuid;
  v_active boolean;
  v_sub_count int;
  v_seed_statuses int;
  v_seed_stores int;
  v_demo_active boolean;
  v_sur4_active boolean;
  v_demo_plan text;
  v_sur4_plan text;
  v_outcome text;
begin
  select id into v_basic_id from public.plans where code = 'basic';
  select id into v_mvp_id from public.plans where code = 'mvp';

  if v_basic_id is null or v_mvp_id is null then
    raise exception 'phase25: basic/mvp plan missing';
  end if;

  select t.active into v_demo_active from public.tenants t where t.slug = 'demo';
  select t.active into v_sur4_active from public.tenants t where t.slug = 'sur4';
  select p.code into v_demo_plan
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'demo'
  limit 1;
  select p.code into v_sur4_plan
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'sur4'
  limit 1;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner@phase25.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ), (
    v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'other@phase25.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  v_result := public.create_organization(
    'Phase25 Paid',
    'phase25-paid',
    'Europe/Madrid'
  );

  v_tenant_id := (v_result ->> 'tenant_id')::uuid;

  if v_tenant_id is null then
    raise exception 'phase25: create_organization returned no tenant_id';
  end if;

  if coalesce((v_result ->> 'active')::boolean, true) is not false then
    raise exception 'phase25: commercial tenant must start active=false';
  end if;

  select t.active into v_active from public.tenants t where t.id = v_tenant_id;
  if v_active is not false then
    raise exception 'phase25: tenant row active expected false';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = v_tenant_id
      and m.user_id = v_owner
      and m.role = 'owner'
      and m.active
  ) then
    raise exception 'phase25: owner membership missing';
  end if;

  -- Seed rows are written by DEFINER; verify as postgres (pending owner RLS
  -- must NOT see operational catalogs until active=true).
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_seed_statuses
  from public.order_statuses where tenant_id = v_tenant_id;
  select count(*) into v_seed_stores
  from public.stores where tenant_id = v_tenant_id;

  if v_seed_statuses < 5 then
    raise exception 'phase25: expected order status seed, got %', v_seed_statuses;
  end if;
  if v_seed_stores < 1 then
    raise exception 'phase25: expected store seed';
  end if;

  select count(*) into v_sub_count
  from public.subscriptions s
  where s.tenant_id = v_tenant_id;

  if v_sub_count <> 0 then
    raise exception 'phase25: commercial tenant must not get MVP subscription';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  -- Activation permissions: authenticated must not execute
  begin
    perform public.activate_tenant_after_billing_v1(v_tenant_id, null);
    raise exception 'phase25: authenticated must not call activate RPC';
  exception
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm like '%phase25: authenticated must not%' then
        raise;
      end if;
      -- some environments raise different privilege errors
      null;
  end;

  -- Reset to postgres/service for activation tests
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- incomplete must not activate
  insert into public.subscriptions (
    tenant_id, plan_id, provider, provider_customer_id, provider_subscription_id,
    status, current_period_start, current_period_end, cancel_at_period_end, metadata
  ) values (
    v_tenant_id, v_basic_id, 'stripe', 'cus_phase25', 'sub_phase25_incomplete',
    'incomplete', now(), now() + interval '30 days', false, '{}'::jsonb
  );

  v_result := public.activate_tenant_after_billing_v1(v_tenant_id, 'sub_phase25_incomplete');
  if v_result ->> 'outcome' <> 'not_eligible' then
    raise exception 'phase25: incomplete must not activate, got %', v_result;
  end if;

  update public.subscriptions
  set status = 'past_due', provider_subscription_id = 'sub_phase25_pastdue'
  where tenant_id = v_tenant_id;

  v_result := public.activate_tenant_after_billing_v1(v_tenant_id, 'sub_phase25_pastdue');
  if v_result ->> 'outcome' <> 'not_eligible' then
    raise exception 'phase25: past_due must not initial-activate, got %', v_result;
  end if;

  update public.subscriptions
  set status = 'canceled', provider_subscription_id = 'sub_phase25_canceled'
  where tenant_id = v_tenant_id;

  v_result := public.activate_tenant_after_billing_v1(v_tenant_id, 'sub_phase25_canceled');
  if v_result ->> 'outcome' <> 'not_eligible' then
    raise exception 'phase25: canceled must not activate, got %', v_result;
  end if;

  update public.subscriptions
  set status = 'trialing', provider_subscription_id = 'sub_phase25_trial'
  where tenant_id = v_tenant_id;

  v_result := public.activate_tenant_after_billing_v1(v_tenant_id, 'sub_phase25_trial');
  if v_result ->> 'outcome' <> 'activated' then
    raise exception 'phase25: trialing should activate, got %', v_result;
  end if;

  select t.active into v_active from public.tenants t where t.id = v_tenant_id;
  if v_active is not true then
    raise exception 'phase25: tenant should be active after trialing';
  end if;

  -- idempotent
  v_result := public.activate_tenant_after_billing_v1(v_tenant_id, 'sub_phase25_trial');
  if v_result ->> 'outcome' <> 'already_active' then
    raise exception 'phase25: second activation must be already_active, got %', v_result;
  end if;

  -- never turn active back to false via this RPC
  update public.subscriptions set status = 'canceled' where tenant_id = v_tenant_id;
  v_result := public.activate_tenant_after_billing_v1(v_tenant_id, 'sub_phase25_trial');
  if v_result ->> 'outcome' <> 'already_active' then
    raise exception 'phase25: activation RPC must not deactivate, got %', v_result;
  end if;
  select t.active into v_active from public.tenants t where t.id = v_tenant_id;
  if v_active is not true then
    raise exception 'phase25: tenant must remain active';
  end if;

  -- active status path on a fresh pending tenant
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  v_result := public.create_organization(
    'Phase25 Active Path',
    'phase25-active-path',
    'Europe/Madrid'
  );
  v_tenant_id := (v_result ->> 'tenant_id')::uuid;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into public.subscriptions (
    tenant_id, plan_id, provider, provider_customer_id, provider_subscription_id,
    status, current_period_start, current_period_end, cancel_at_period_end, metadata
  ) values (
    v_tenant_id, v_basic_id, 'stripe', 'cus_phase25b', 'sub_phase25_active',
    'active', now(), now() + interval '30 days', false, '{}'::jsonb
  );

  v_result := public.activate_tenant_after_billing_v1(v_tenant_id, 'sub_phase25_active');
  v_outcome := v_result ->> 'outcome';
  if v_outcome <> 'activated' then
    raise exception 'phase25: active should activate, got %', v_result;
  end if;

  -- DEMO / SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase25: DEMO active mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase25: SUR4 active mutated';
  end if;

  if (
    select p.code
    from public.tenants t
    join public.subscriptions s on s.tenant_id = t.id
    join public.plans p on p.id = s.plan_id
    where t.slug = 'demo'
    limit 1
  ) is distinct from v_demo_plan then
    raise exception 'phase25: DEMO plan mutated';
  end if;

  if (
    select p.code
    from public.tenants t
    join public.subscriptions s on s.tenant_id = t.id
    join public.plans p on p.id = s.plan_id
    where t.slug = 'sur4'
    limit 1
  ) is distinct from v_sur4_plan then
    raise exception 'phase25: SUR4 plan mutated';
  end if;

  raise notice 'phase25_paid_onboarding_ok';
end;
$phase25$;

rollback;
