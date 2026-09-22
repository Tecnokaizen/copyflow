-- Stripe Live Hardening V1 · phase32
-- Covers subscriptions.livemode, checkout attempts mode scope, sync/prepare fail-closed.

begin;

do $phase32$
declare
  v_owner uuid := 'e3200000-0000-4000-8000-000000000099';
  v_tenant uuid;
  v_basic_id uuid;
  v_sync jsonb;
  v_prep jsonb;
  v_prep_live jsonb;
  v_sub_id uuid;
  v_attempt_test uuid;
  v_attempt_live uuid;
  v_count int;
  v_livemode boolean;
  v_demo_active boolean;
  v_sur4_active boolean;
begin
  select t.active into v_demo_active from public.tenants t where t.slug = 'demo';
  select t.active into v_sur4_active from public.tenants t where t.slug = 'sur4';

  select p.id into v_basic_id from public.plans p where p.code = 'basic' limit 1;
  if v_basic_id is null then
    raise exception 'phase32: basic plan missing';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner@phase32.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values (v_owner, 'Phase32');

  insert into public.tenants (name, slug, active, provisioning_state)
  values ('Phase32 Tenant', 'phase32-tenant', true, 'ready')
  returning id into v_tenant;

  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant, v_owner, 'owner', true);

  -- A: subscriptions.livemode defaults false
  insert into public.subscriptions (
    tenant_id, plan_id, provider, provider_subscription_id, status
  ) values (
    v_tenant, v_basic_id, 'internal', null, 'canceled'
  );

  select s.livemode into v_livemode
  from public.subscriptions s
  where s.tenant_id = v_tenant and s.provider = 'internal'
  limit 1;

  if v_livemode is distinct from false then
    raise exception 'phase32 A: livemode default expected false, got %', v_livemode;
  end if;

  delete from public.subscriptions where tenant_id = v_tenant;

  -- B: sync test → livemode false
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase32_test',
    'sub_phase32_mode',
    'active',
    now(),
    now() + interval '30 days',
    false,
    '{}'::jsonb,
    now(),
    null,
    false
  );

  v_sub_id := (v_sync ->> 'subscription_id')::uuid;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id and livemode = false and status = 'active'
  ) then
    raise exception 'phase32 B: expected test livemode=false row';
  end if;

  -- C: sync live (different provider_subscription_id) → livemode true
  -- Also cancels prior Test current (one-current semantics).
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase32_live',
    'sub_phase32_live_new',
    'active',
    now(),
    now() + interval '30 days',
    false,
    '{}'::jsonb,
    now(),
    null,
    true
  );

  if not exists (
    select 1 from public.subscriptions
    where provider_subscription_id = 'sub_phase32_live_new'
      and livemode = true
      and status = 'active'
  ) then
    raise exception 'phase32 C: expected live livemode=true row';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id and status = 'canceled'
  ) then
    raise exception 'phase32 C: prior Test current should be canceled by Live current';
  end if;

  -- D: same provider_subscription_id cannot move false→true
  -- Re-seed a Test row with a fresh id for mismatch check.
  update public.subscriptions
  set status = 'canceled'
  where tenant_id = v_tenant and status = 'active';

  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase32_locked',
    'sub_phase32_locked',
    'active',
    now(),
    now() + interval '30 days',
    false,
    '{}'::jsonb,
    now(),
    null,
    false
  );

  begin
    perform public.sync_billing_subscription_v1(
      v_tenant,
      v_basic_id,
      'stripe',
      'cus_phase32_locked',
      'sub_phase32_locked',
      'active',
      now(),
      now() + interval '30 days',
      false,
      '{}'::jsonb,
      now(),
      null,
      true
    );
    raise exception 'phase32 D: expected livemode mismatch rejection';
  exception
    when check_violation then
      null;
    when integrity_constraint_violation then
      null;
  end;

  if not exists (
    select 1 from public.subscriptions
    where provider_subscription_id = 'sub_phase32_locked'
      and livemode = false
      and status = 'active'
  ) then
    raise exception 'phase32 D: Test row must remain after rejected Live sync';
  end if;

  -- E: Test current blocks prepare Test
  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'billing', false
  );
  if (v_prep ->> 'outcome') is distinct from 'current_subscription_exists' then
    raise exception 'phase32 E: expected current_subscription_exists for Test, got %', v_prep;
  end if;

  -- F: Test current does NOT block prepare Live
  v_prep_live := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'billing', true
  );
  if (v_prep_live ->> 'outcome') is distinct from 'reserved' then
    raise exception 'phase32 F: Live prepare should not be blocked by Test current, got %', v_prep_live;
  end if;

  v_attempt_live := (v_prep_live ->> 'attempt_id')::uuid;

  -- Cancel Live attempt so G/H can use clean state; keep Test current.
  update public.billing_checkout_attempts
  set status = 'expired', updated_at = now()
  where id = v_attempt_live;

  -- G: active Test attempt does not block Live reserve
  -- First clear Test current so Test attempt can be created.
  update public.subscriptions
  set status = 'canceled'
  where tenant_id = v_tenant and status = 'active';

  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'billing', false
  );
  if (v_prep ->> 'outcome') is distinct from 'reserved' then
    raise exception 'phase32 G setup: expected Test reserved, got %', v_prep;
  end if;
  v_attempt_test := (v_prep ->> 'attempt_id')::uuid;

  v_prep_live := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding', true
  );
  if (v_prep_live ->> 'outcome') is distinct from 'reserved' then
    raise exception 'phase32 G: Live prepare blocked by Test attempt, got %', v_prep_live;
  end if;
  v_attempt_live := (v_prep_live ->> 'attempt_id')::uuid;

  -- H: two active attempts same tenant different mode → allowed
  select count(*)::int into v_count
  from public.billing_checkout_attempts
  where tenant_id = v_tenant
    and status = any (array['creating'::text, 'open'::text, 'completed'::text]);

  if v_count <> 2 then
    raise exception 'phase32 H: expected 2 active attempts (test+live), got %', v_count;
  end if;

  if not exists (
    select 1 from public.billing_checkout_attempts
    where id = v_attempt_test and livemode = false and status = 'creating'
  ) then
    raise exception 'phase32 H: Test attempt missing';
  end if;

  if not exists (
    select 1 from public.billing_checkout_attempts
    where id = v_attempt_live and livemode = true and status = 'creating'
  ) then
    raise exception 'phase32 H: Live attempt missing';
  end if;

  -- I: second active attempt same tenant + same mode → prohibited
  begin
    insert into public.billing_checkout_attempts (
      tenant_id, provider, provider_session_id, status,
      plan_code, billing_interval, expires_at, livemode
    ) values (
      v_tenant, 'stripe', null, 'creating',
      'basic', 'month', now() + interval '1 day', false
    );
    raise exception 'phase32 I: expected unique violation for second Test active attempt';
  exception
    when unique_violation then
      null;
  end;

  -- J: RPCs remain service-only
  if has_function_privilege(
    'anon',
    'public.sync_billing_subscription_v1(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean)',
    'execute'
  ) then
    raise exception 'phase32 J: anon must not execute sync';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.sync_billing_subscription_v1(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean)',
    'execute'
  ) then
    raise exception 'phase32 J: authenticated must not execute sync';
  end if;
  if has_function_privilege(
    'anon',
    'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)',
    'execute'
  ) then
    raise exception 'phase32 J: anon must not execute prepare';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)',
    'execute'
  ) then
    raise exception 'phase32 J: authenticated must not execute prepare';
  end if;

  -- DEMO/SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase32: DEMO mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase32: SUR4 mutated';
  end if;

  raise notice 'phase32_stripe_live_hardening_ok';
end;
$phase32$;

rollback;
