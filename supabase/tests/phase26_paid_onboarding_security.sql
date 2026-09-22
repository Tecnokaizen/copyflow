-- Paid Onboarding security hardening · phase26
-- Real role/JWT/RLS semantics for pending tenants + webhook claim retries.

begin;

do $phase26$
declare
  v_owner uuid := 'e2600000-0000-4000-8000-000000000001';
  v_staff uuid := 'e2600000-0000-4000-8000-000000000002';
  v_tenant uuid;
  v_basic_id uuid;
  v_result jsonb;
  v_claim jsonb;
  v_claim2 jsonb;
  v_count int;
  v_active boolean;
  v_demo_active boolean;
  v_sur4_active boolean;
  v_demo_plan text;
  v_sur4_plan text;
  v_can_select boolean;
begin
  select id into v_basic_id from public.plans where code = 'basic';
  if v_basic_id is null then
    raise exception 'phase26: basic plan missing';
  end if;

  select t.active into v_demo_active from public.tenants t where t.slug = 'demo';
  select t.active into v_sur4_active from public.tenants t where t.slug = 'sur4';
  select p.code into v_demo_plan
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'demo' limit 1;
  select p.code into v_sur4_plan
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'sur4' limit 1;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner@phase26.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ), (
    v_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'staff@phase26.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  -- A) authenticated cannot call internal provisioning
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.create_internal_organization_v1(
      v_owner, 'Hack Internal', 'phase26-hack-internal', 'Europe/Madrid'
    );
    raise exception 'phase26: authenticated must not call create_internal_organization_v1';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like '%phase26: authenticated must not%' then
        raise;
      end if;
      null;
  end;

  -- Commercial create → inactive
  v_result := public.create_organization(
    'Phase26 Pending', 'phase26-pending', 'Europe/Madrid'
  );
  v_tenant := (v_result ->> 'tenant_id')::uuid;

  if coalesce((v_result ->> 'active')::boolean, true) is not false then
    raise exception 'phase26: commercial create must be inactive';
  end if;

  -- Pending owner can see own tenant/membership (resume), not operational rows
  select exists(
    select 1 from public.tenants t where t.id = v_tenant
  ) into v_can_select;
  if not v_can_select then
    raise exception 'phase26: pending owner must SELECT own tenant';
  end if;

  select count(*) into v_count from public.order_statuses where tenant_id = v_tenant;
  if v_count <> 0 then
    raise exception 'phase26: pending owner must not SELECT order_statuses via RLS, got %', v_count;
  end if;

  select count(*) into v_count from public.stores where tenant_id = v_tenant;
  if v_count <> 0 then
    raise exception 'phase26: pending owner must not SELECT stores via RLS, got %', v_count;
  end if;

  select count(*) into v_count from public.clients where tenant_id = v_tenant;
  if v_count <> 0 then
    raise exception 'phase26: pending owner must not SELECT clients';
  end if;

  select count(*) into v_count from public.orders where tenant_id = v_tenant;
  if v_count <> 0 then
    raise exception 'phase26: pending owner must not SELECT orders';
  end if;

  select count(*) into v_count from public.services where tenant_id = v_tenant;
  if v_count <> 0 then
    raise exception 'phase26: pending owner must not SELECT services';
  end if;

  -- C/D mutations blocked
  begin
    insert into public.clients (tenant_id, name)
    values (v_tenant, 'Blocked Client');
    raise exception 'phase26: pending owner must not INSERT clients';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like '%phase26: pending owner must not INSERT%' then
        raise;
      end if;
      -- RLS with check failure
      null;
  end;

  begin
    update public.tenants set active = true where id = v_tenant;
  exception
    when insufficient_privilege then null;
    when others then null;
  end;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select t.active into v_active from public.tenants t where t.id = v_tenant;
  if v_active is not false then
    raise exception 'phase26: pending owner self-activated tenant';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  -- E) operational RPC blocked while pending
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.create_client(
      null, 'X', null, null, null, null, null, null, v_tenant
    );
    raise exception 'phase26: pending owner must not execute create_client';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like '%phase26: pending owner must not execute create_client%' then
        raise;
      end if;
      null;
  end;

  -- Activate via service path
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into public.subscriptions (
    tenant_id, plan_id, provider, provider_customer_id, provider_subscription_id,
    status, current_period_start, current_period_end, cancel_at_period_end, metadata
  ) values (
    v_tenant, v_basic_id, 'stripe', 'cus_phase26', 'sub_phase26_active',
    'active', now(), now() + interval '30 days', false, '{}'::jsonb
  );

  v_result := public.activate_tenant_after_billing_v1(v_tenant, 'sub_phase26_active');
  if v_result ->> 'outcome' <> 'activated' then
    raise exception 'phase26: activation failed %', v_result;
  end if;

  -- F) after active, operational SELECT returns for owner
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count from public.order_statuses where tenant_id = v_tenant;
  if v_count < 5 then
    raise exception 'phase26: active owner should see order_statuses, got %', v_count;
  end if;

  select count(*) into v_count from public.stores where tenant_id = v_tenant;
  if v_count < 1 then
    raise exception 'phase26: active owner should see stores';
  end if;

  -- L-ish: current subscription exists (verified via row presence)
  select count(*) into v_count
  from public.subscriptions s
  where s.tenant_id = v_tenant
    and s.provider = 'stripe'
    and s.status in ('trialing', 'active', 'past_due');
  if v_count < 1 then
    raise exception 'phase26: expected current stripe subscription';
  end if;

  -- H/I/J webhook claim retry semantics
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);

  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase26_1', 'customer.subscription.updated', false, now(), 'sub_phase26_active'
  );
  if v_claim ->> 'outcome' <> 'claimed' then
    raise exception 'phase26: first claim expected claimed, got %', v_claim;
  end if;

  -- concurrent second claim while processing → in_progress
  v_claim2 := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase26_1', 'customer.subscription.updated', false, now(), 'sub_phase26_active'
  );
  if v_claim2 ->> 'outcome' <> 'in_progress' then
    raise exception 'phase26: concurrent claim expected in_progress, got %', v_claim2;
  end if;

  -- finalize failed retryable
  perform public.finalize_billing_webhook_event_v1(
    'stripe', 'evt_phase26_1', 'failed', 'tenant_activation_failed', true
  );

  -- J) failed retryable can be reclaimed
  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase26_1', 'customer.subscription.updated', false, now(), 'sub_phase26_active'
  );
  if v_claim ->> 'outcome' <> 'claimed' then
    raise exception 'phase26: retryable failed should reclaim, got %', v_claim;
  end if;

  perform public.finalize_billing_webhook_event_v1(
    'stripe', 'evt_phase26_1', 'processed', null, false
  );

  -- I) duplicate processed stays final
  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase26_1', 'customer.subscription.updated', false, now(), 'sub_phase26_active'
  );
  if v_claim ->> 'outcome' <> 'already_final' then
    raise exception 'phase26: processed duplicate expected already_final, got %', v_claim;
  end if;

  -- deterministic failed cannot reclaim
  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase26_det', 'customer.subscription.updated', false, now(), 'sub_x'
  );
  perform public.finalize_billing_webhook_event_v1(
    'stripe', 'evt_phase26_det', 'failed', 'unknown_price_mapping', false
  );
  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase26_det', 'customer.subscription.updated', false, now(), 'sub_x'
  );
  if v_claim ->> 'outcome' <> 'already_final' then
    raise exception 'phase26: deterministic failed must stay final, got %', v_claim;
  end if;

  -- M) DEMO/SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase26: DEMO active mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase26: SUR4 active mutated';
  end if;
  if (
    select p.code from public.tenants t
    join public.subscriptions s on s.tenant_id = t.id
    join public.plans p on p.id = s.plan_id
    where t.slug = 'demo' limit 1
  ) is distinct from v_demo_plan then
    raise exception 'phase26: DEMO plan mutated';
  end if;
  if (
    select p.code from public.tenants t
    join public.subscriptions s on s.tenant_id = t.id
    join public.plans p on p.id = s.plan_id
    where t.slug = 'sur4' limit 1
  ) is distinct from v_sur4_plan then
    raise exception 'phase26: SUR4 plan mutated';
  end if;

  raise notice 'phase26_paid_onboarding_security_ok';
end;
$phase26$;

rollback;
