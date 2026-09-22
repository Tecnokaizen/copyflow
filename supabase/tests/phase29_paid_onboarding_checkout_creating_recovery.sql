-- Paid onboarding Checkout creating recovery · phase29
-- Provider-expiry based creating recovery; DEMO/SUR4 unchanged.

begin;

do $phase29$
declare
  v_owner uuid := 'e2900000-0000-4000-8000-000000000099';
  v_tenant uuid := 'e2900000-0000-4000-8000-000000000011';
  v_prep jsonb;
  v_prep2 jsonb;
  v_attach jsonb;
  v_attach2 jsonb;
  v_attempt_id uuid;
  v_key text;
  v_expires text;
  v_demo_active boolean;
  v_sur4_active boolean;
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
    'owner@phase29.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values (v_owner, 'Phase29');
  insert into public.tenants (id, name, slug, active)
  values (v_tenant, 'Phase29 Tenant', 'phase29-tenant', false);
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant, v_owner, 'owner', true);

  -- A/B/C: creating older than 5 minutes but provider expiry still future
  --        -> same attempt, same key, same expires_at
  insert into public.billing_checkout_attempts (
    id, tenant_id, provider, provider_session_id, status, plan_code,
    billing_interval, expires_at, created_at, updated_at
  ) values (
    'e2900000-0000-4000-8000-0000000000a1',
    v_tenant, 'stripe', null, 'creating', 'basic', 'month',
    timestamptz '2030-01-15 12:00:00+00',
    now() - interval '30 minutes',
    now() - interval '30 minutes'
  );

  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase29 A: expected reserved, got %', v_prep;
  end if;
  if (v_prep ->> 'attempt_id')::uuid <> 'e2900000-0000-4000-8000-0000000000a1' then
    raise exception 'phase29 A: must return same attempt, got %', v_prep;
  end if;

  v_key := v_prep ->> 'idempotency_key';
  v_expires := v_prep ->> 'expires_at';
  if v_key <> 'gestcopy-checkout:e2900000-0000-4000-8000-0000000000a1' then
    raise exception 'phase29 B: unexpected idempotency key %', v_prep;
  end if;
  if v_expires is null then
    raise exception 'phase29 C: expires_at missing %', v_prep;
  end if;
  if v_expires::timestamptz <> timestamptz '2030-01-15 12:00:00+00' then
    raise exception 'phase29 C: expires_at must stay reserved value, got %', v_expires;
  end if;

  v_prep2 := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if v_prep2 ->> 'attempt_id' is distinct from v_prep ->> 'attempt_id' then
    raise exception 'phase29 A retry: attempt_id changed';
  end if;
  if v_prep2 ->> 'idempotency_key' is distinct from v_key then
    raise exception 'phase29 B retry: idempotency key changed';
  end if;
  if v_prep2 ->> 'expires_at' is distinct from v_expires then
    raise exception 'phase29 C retry: expires_at changed';
  end if;

  -- Attach-after-retry remains idempotent (G): conceptual Stripe success then DB attach
  v_attach := public.attach_billing_checkout_session_v2(
    'e2900000-0000-4000-8000-0000000000a1',
    'cs_test_phase29_a',
    timestamptz '2030-01-15 12:00:00+00'
  );
  if v_attach ->> 'outcome' <> 'attached' then
    raise exception 'phase29 G: first attach failed %', v_attach;
  end if;
  if (v_attach ->> 'expires_at')::timestamptz <> timestamptz '2030-01-15 12:00:00+00' then
    raise exception 'phase29 G: attach must preserve reserved expires_at %', v_attach;
  end if;

  -- Simulate attach failure recovery path: still creating with same reservation
  update public.billing_checkout_attempts
  set status = 'creating', provider_session_id = null, updated_at = now()
  where id = 'e2900000-0000-4000-8000-0000000000a1';

  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'onboarding'
  );
  if (v_prep ->> 'attempt_id')::uuid <> 'e2900000-0000-4000-8000-0000000000a1' then
    raise exception 'phase29 attach-fail recovery: new attempt created %', v_prep;
  end if;
  if v_prep ->> 'idempotency_key' is distinct from v_key then
    raise exception 'phase29 attach-fail recovery: key changed %', v_prep;
  end if;
  if v_prep ->> 'expires_at' is distinct from v_expires then
    raise exception 'phase29 attach-fail recovery: expires_at changed %', v_prep;
  end if;

  v_attach2 := public.attach_billing_checkout_session_v2(
    'e2900000-0000-4000-8000-0000000000a1',
    'cs_test_phase29_a',
    timestamptz '2030-01-15 12:00:00+00'
  );
  if v_attach2 ->> 'outcome' <> 'attached' then
    raise exception 'phase29 G retry attach failed %', v_attach2;
  end if;

  v_attach2 := public.attach_billing_checkout_session_v2(
    'e2900000-0000-4000-8000-0000000000a1',
    'cs_test_phase29_a',
    timestamptz '2030-01-15 12:00:00+00'
  );
  if coalesce((v_attach2 ->> 'idempotent')::boolean, false) is not true then
    raise exception 'phase29 G: second attach must be idempotent %', v_attach2;
  end if;

  -- E/F: only after provider expiry (+ grace) may creating expire and yield new attempt
  perform public.finalize_billing_checkout_attempt_v2(
    'e2900000-0000-4000-8000-0000000000a1', 'cs_test_phase29_a', 'expired'
  );

  insert into public.billing_checkout_attempts (
    id, tenant_id, provider, provider_session_id, status, plan_code,
    billing_interval, expires_at, created_at, updated_at
  ) values (
    'e2900000-0000-4000-8000-0000000000b1',
    v_tenant, 'stripe', null, 'creating', 'basic', 'month',
    now() - interval '3 minutes', -- past expiry + 2m grace
    now() - interval '1 day',
    now() - interval '1 day'
  );

  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'billing'
  );
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase29 E: expected new reserved after safe expiry, got %', v_prep;
  end if;
  v_attempt_id := (v_prep ->> 'attempt_id')::uuid;
  if v_attempt_id = 'e2900000-0000-4000-8000-0000000000b1' then
    raise exception 'phase29 E: past-expiry creating must be expired, not resumed';
  end if;
  if v_prep ->> 'idempotency_key' = 'gestcopy-checkout:e2900000-0000-4000-8000-0000000000b1' then
    raise exception 'phase29 F: new attempt must get a different idempotency key';
  end if;
  if v_prep ->> 'expires_at' is null then
    raise exception 'phase29 F: new attempt must include expires_at';
  end if;
  if (
    select status from public.billing_checkout_attempts
    where id = 'e2900000-0000-4000-8000-0000000000b1'
  ) <> 'expired' then
    raise exception 'phase29 E: past-expiry creating row must be marked expired';
  end if;

  -- Within grace after expiry: still not expired (expires_at = now()-1m, grace=2m)
  perform public.finalize_billing_checkout_attempt_v2(
    v_attempt_id, null, 'expired'
  );
  insert into public.billing_checkout_attempts (
    id, tenant_id, provider, provider_session_id, status, plan_code,
    billing_interval, expires_at, created_at, updated_at
  ) values (
    'e2900000-0000-4000-8000-0000000000c1',
    v_tenant, 'stripe', null, 'creating', 'basic', 'month',
    now() - interval '1 minute',
    now() - interval '1 day',
    now() - interval '1 day'
  );
  v_prep := public.prepare_billing_checkout_attempt_v2(
    v_tenant, 'basic', 'month', 'billing'
  );
  if (v_prep ->> 'attempt_id')::uuid <> 'e2900000-0000-4000-8000-0000000000c1' then
    raise exception 'phase29 E grace: creating inside grace must still resume, got %', v_prep;
  end if;

  -- H DEMO/SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase29: DEMO mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase29: SUR4 mutated';
  end if;

  raise notice 'phase29_checkout_creating_recovery_ok';
end;
$phase29$;

rollback;
