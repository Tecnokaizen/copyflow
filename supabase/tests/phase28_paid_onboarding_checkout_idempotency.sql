-- Paid onboarding Checkout idempotency · phase28
-- Reserve-before-Stripe, attach idempotency, processing gate, DEMO/SUR4.

begin;

do $phase28$
declare
  v_owner uuid := 'e2800000-0000-4000-8000-000000000099';
  v_tenant uuid := 'e2800000-0000-4000-8000-000000000011';
  v_tenant2 uuid := 'e2800000-0000-4000-8000-000000000012';
  v_prep jsonb;
  v_prep2 jsonb;
  v_attach jsonb;
  v_attach2 jsonb;
  v_fin jsonb;
  v_attempt_id uuid;
  v_key text;
  v_demo_active boolean;
  v_sur4_active boolean;
  v_active_count int;
begin
  select t.active into v_demo_active from public.tenants t where t.slug = 'demo';
  select t.active into v_sur4_active from public.tenants t where t.slug = 'sur4';

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner@phase28.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values (v_owner, 'Phase28');
  insert into public.tenants (id, name, slug, active)
  values
    (v_tenant, 'Phase28 Tenant', 'phase28-tenant', false),
    (v_tenant2, 'Phase28 Tenant2', 'phase28-tenant-2', false);
  insert into public.memberships (tenant_id, user_id, role, active)
  values
    (v_tenant, v_owner, 'owner', true),
    (v_tenant2, v_owner, 'owner', true);

  -- A: two concurrent prepare calls resolve to the SAME reserved attempt
  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase28 A: first prepare expected reserved, got %', v_prep;
  end if;
  v_attempt_id := (v_prep ->> 'attempt_id')::uuid;
  v_key := v_prep ->> 'idempotency_key';
  if v_key is distinct from ('gestcopy-checkout:' || v_attempt_id::text) then
    raise exception 'phase28 B: idempotency key mismatch %', v_prep;
  end if;

  v_prep2 := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if v_prep2 ->> 'outcome' <> 'reserved' then
    raise exception 'phase28 A: second prepare expected reserved, got %', v_prep2;
  end if;
  if (v_prep2 ->> 'attempt_id')::uuid is distinct from v_attempt_id then
    raise exception 'phase28 A: concurrent prepare must share attempt_id';
  end if;
  if v_prep2 ->> 'idempotency_key' is distinct from v_key then
    raise exception 'phase28 B: concurrent prepare must share idempotency_key';
  end if;

  select count(*) into v_active_count
  from public.billing_checkout_attempts
  where tenant_id = v_tenant
    and status = any (array['creating', 'open', 'completed']);
  if v_active_count <> 1 then
    raise exception 'phase28 A: expected one active attempt, got %', v_active_count;
  end if;

  -- D: attach is idempotent for the same Stripe session
  v_attach := public.attach_billing_checkout_session_v2(
    v_attempt_id, 'cs_test_phase28_a', now() + interval '1 hour'
  );
  if v_attach ->> 'outcome' <> 'attached' then
    raise exception 'phase28 D: first attach failed %', v_attach;
  end if;
  if coalesce((v_attach ->> 'idempotent')::boolean, false) then
    raise exception 'phase28 D: first attach should not be idempotent flag';
  end if;

  v_attach2 := public.attach_billing_checkout_session_v2(
    v_attempt_id, 'cs_test_phase28_a', now() + interval '1 hour'
  );
  if v_attach2 ->> 'outcome' <> 'attached' then
    raise exception 'phase28 D: second attach failed %', v_attach2;
  end if;
  if coalesce((v_attach2 ->> 'idempotent')::boolean, false) is not true then
    raise exception 'phase28 D: second attach must be idempotent %', v_attach2;
  end if;

  -- reuse path after open
  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if v_prep ->> 'outcome' <> 'reuse' then
    raise exception 'phase28 reuse: expected reuse, got %', v_prep;
  end if;
  if v_prep ->> 'provider_session_id' <> 'cs_test_phase28_a' then
    raise exception 'phase28 reuse: wrong session %', v_prep;
  end if;

  -- G: explicit expired frees unique slot for a new attempt
  v_fin := public.finalize_billing_checkout_attempt_v2(
    v_attempt_id, 'cs_test_phase28_a', 'expired'
  );
  if v_fin ->> 'outcome' <> 'finalized' then
    raise exception 'phase28 G: finalize expired failed %', v_fin;
  end if;

  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase28 G: after expire expected reserved, got %', v_prep;
  end if;
  if (v_prep ->> 'attempt_id')::uuid = v_attempt_id then
    raise exception 'phase28 G: new attempt id must differ after expire';
  end if;
  if v_prep ->> 'idempotency_key' = v_key then
    raise exception 'phase28 G: new attempt must get a new idempotency key';
  end if;

  v_attempt_id := (v_prep ->> 'attempt_id')::uuid;
  perform public.attach_billing_checkout_session_v2(
    v_attempt_id, 'cs_test_phase28_b', now() + interval '1 hour'
  );

  -- H/I: completed without local subscription -> checkout_processing (no new create)
  v_fin := public.finalize_billing_checkout_attempt_v2(
    v_attempt_id, 'cs_test_phase28_b', 'completed'
  );
  if v_fin ->> 'outcome' <> 'finalized' then
    raise exception 'phase28 H: finalize completed failed %', v_fin;
  end if;

  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase28 H: expected checkout_processing, got %', v_prep;
  end if;
  if v_prep ->> 'code' <> 'checkout_processing' then
    raise exception 'phase28 H: missing code checkout_processing %', v_prep;
  end if;

  select count(*) into v_active_count
  from public.billing_checkout_attempts
  where tenant_id = v_tenant
    and status = any (array['creating', 'open', 'completed']);
  if v_active_count <> 1 then
    raise exception 'phase28 I: completed must remain the sole active attempt';
  end if;

  -- J: current trialing/active/past_due -> current_subscription_exists
  declare
    v_basic_id uuid;
  begin
    select p.id into v_basic_id from public.plans p where p.code = 'basic' limit 1;
    if v_basic_id is null then
      raise exception 'phase28 J: basic plan missing';
    end if;

    insert into public.subscriptions (
      tenant_id, plan_id, provider, provider_subscription_id, status,
      current_period_start, current_period_end, cancel_at_period_end
    ) values (
      v_tenant2, v_basic_id, 'stripe', 'sub_phase28_current', 'trialing',
      now(), now() + interval '30 days', false
    );

    v_prep := public.prepare_billing_checkout_attempt_v2(
      v_tenant2, 'basic', 'month', 'billing'
    );
    if v_prep ->> 'outcome' <> 'current_subscription_exists' then
      raise exception 'phase28 J trialing: expected current_subscription_exists, got %', v_prep;
    end if;

    update public.subscriptions
    set status = 'active'
    where provider_subscription_id = 'sub_phase28_current';
    v_prep := public.prepare_billing_checkout_attempt_v2(
      v_tenant2, 'basic', 'month', 'billing'
    );
    if v_prep ->> 'outcome' <> 'current_subscription_exists' then
      raise exception 'phase28 J active: expected current_subscription_exists, got %', v_prep;
    end if;

    update public.subscriptions
    set status = 'past_due'
    where provider_subscription_id = 'sub_phase28_current';
    v_prep := public.prepare_billing_checkout_attempt_v2(
      v_tenant2, 'basic', 'month', 'billing'
    );
    if v_prep ->> 'outcome' <> 'current_subscription_exists' then
      raise exception 'phase28 J past_due: expected current_subscription_exists, got %', v_prep;
    end if;

    -- creating older than 5 minutes with future provider expiry stays resumable
    insert into public.billing_checkout_attempts (
      id, tenant_id, provider, provider_session_id, status, plan_code,
      billing_interval, expires_at, created_at, updated_at
    ) values (
      'e2800000-0000-4000-8000-0000000000aa',
      v_tenant2, 'stripe', null, 'creating', 'basic', 'month',
      now() + interval '20 hours',
      now() - interval '6 minutes',
      now() - interval '6 minutes'
    );
    delete from public.subscriptions
    where provider_subscription_id = 'sub_phase28_current';

    v_prep := public.prepare_billing_checkout_attempt_v2(
      v_tenant2, 'basic', 'month', 'billing'
    );
    if v_prep ->> 'outcome' <> 'reserved' then
      raise exception 'phase28 creating recovery: expected reserved, got %', v_prep;
    end if;
    if (v_prep ->> 'attempt_id')::uuid <> 'e2800000-0000-4000-8000-0000000000aa' then
      raise exception 'phase28 creating recovery: must resume same attempt, got %', v_prep;
    end if;
  end;

  -- K DEMO/SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase28: DEMO mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase28: SUR4 mutated';
  end if;

  -- service_role only grants
  if has_function_privilege('anon', 'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)', 'execute') then
    raise exception 'phase28: anon must not execute prepare_v2';
  end if;
  if has_function_privilege('authenticated', 'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)', 'execute') then
    raise exception 'phase28: authenticated must not execute prepare_v2';
  end if;

  raise notice 'phase28_checkout_idempotency_ok';
end;
$phase28$;

rollback;
