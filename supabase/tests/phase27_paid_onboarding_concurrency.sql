-- Paid onboarding concurrency hardening · phase27
-- Lease, stale finalize, checkout pending attempts.

begin;

do $phase27$
declare
  v_owner uuid := 'e2700000-0000-4000-8000-000000000099';
  v_tenant uuid := 'e2700000-0000-4000-8000-000000000011';
  v_claim jsonb;
  v_claim2 jsonb;
  v_fin jsonb;
  v_prep jsonb;
  v_reg jsonb;
  v_reg2 jsonb;
  v_attempt int;
  v_started timestamptz;
  v_started2 timestamptz;
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
    'owner@phase27.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values (v_owner, 'Phase27');
  insert into public.tenants (id, name, slug, active)
  values (v_tenant, 'Phase27 Tenant', 'phase27-tenant', true);
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant, v_owner, 'owner', true);

  -- A/B first claim
  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase27_lease', 'customer.subscription.updated', false, now(), 'sub_x'
  );
  if v_claim ->> 'outcome' <> 'claimed' then
    raise exception 'phase27: first claim failed %', v_claim;
  end if;
  if (v_claim ->> 'attempt')::int <> 1 then
    raise exception 'phase27: first attempt expected 1, got %', v_claim;
  end if;
  v_started := (v_claim ->> 'processing_started_at')::timestamptz;

  -- C fresh second delivery -> in_progress
  v_claim2 := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase27_lease', 'customer.subscription.updated', false, now(), 'sub_x'
  );
  if v_claim2 ->> 'outcome' <> 'in_progress' then
    raise exception 'phase27: expected in_progress, got %', v_claim2;
  end if;

  -- fail retryable with attempt 1
  v_fin := public.finalize_billing_webhook_event_v1(
    'stripe', 'evt_phase27_lease', 'failed', 'tenant_activation_failed', true, 1
  );
  if v_fin ->> 'outcome' <> 'finalized' then
    raise exception 'phase27: finalize attempt1 failed %', v_fin;
  end if;

  -- A reclaim with new processing_started_at + attempt 2
  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase27_lease', 'customer.subscription.updated', false, now(), 'sub_x'
  );
  if v_claim ->> 'outcome' <> 'claimed' then
    raise exception 'phase27: reclaim failed %', v_claim;
  end if;
  v_attempt := (v_claim ->> 'attempt')::int;
  if v_attempt <> 2 then
    raise exception 'phase27: attempt expected 2, got %', v_claim;
  end if;
  v_started2 := (v_claim ->> 'processing_started_at')::timestamptz;
  if v_started2 is null or v_started2 < v_started then
    raise exception 'phase27: processing_started_at must advance on reclaim';
  end if;

  -- E stale worker (attempt 1) cannot finalize newer claim
  v_fin := public.finalize_billing_webhook_event_v1(
    'stripe', 'evt_phase27_lease', 'processed', null, false, 1
  );
  if v_fin ->> 'outcome' <> 'stale_claim' then
    raise exception 'phase27: stale finalize expected stale_claim, got %', v_fin;
  end if;

  -- F current attempt finalizes
  v_fin := public.finalize_billing_webhook_event_v1(
    'stripe', 'evt_phase27_lease', 'processed', null, false, 2
  );
  if v_fin ->> 'outcome' <> 'finalized' then
    raise exception 'phase27: current finalize failed %', v_fin;
  end if;

  -- G processed remains final
  v_claim := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase27_lease', 'customer.subscription.updated', false, now(), 'sub_x'
  );
  if v_claim ->> 'outcome' <> 'already_final' then
    raise exception 'phase27: processed duplicate expected already_final, got %', v_claim;
  end if;

  -- H concurrent checkout attempts: only one usable open session
  v_prep := public.prepare_billing_checkout_attempt_v1(v_tenant);
  if v_prep ->> 'outcome' <> 'create' then
    raise exception 'phase27: expected create, got %', v_prep;
  end if;

  v_reg := public.register_billing_checkout_attempt_v1(
    v_tenant, 'cs_test_phase27_a', now() + interval '1 hour', 'basic', 'month'
  );
  if v_reg ->> 'outcome' <> 'registered' then
    raise exception 'phase27: register A failed %', v_reg;
  end if;

  v_reg2 := public.register_billing_checkout_attempt_v1(
    v_tenant, 'cs_test_phase27_b', now() + interval '1 hour', 'basic', 'month'
  );
  if v_reg2 ->> 'outcome' <> 'reuse' then
    raise exception 'phase27: concurrent B expected reuse, got %', v_reg2;
  end if;
  if v_reg2 ->> 'provider_session_id' <> 'cs_test_phase27_a' then
    raise exception 'phase27: reuse must return session A';
  end if;

  if (
    select count(*) from public.billing_checkout_attempts
    where tenant_id = v_tenant and status = 'open'
  ) <> 1 then
    raise exception 'phase27: expected exactly one open checkout attempt';
  end if;

  -- I expired/canceled can retry
  perform public.finalize_billing_checkout_attempt_v1('cs_test_phase27_a', 'expired');
  v_prep := public.prepare_billing_checkout_attempt_v1(v_tenant);
  if v_prep ->> 'outcome' <> 'create' then
    raise exception 'phase27: after expire expected create, got %', v_prep;
  end if;
  v_reg := public.register_billing_checkout_attempt_v1(
    v_tenant, 'cs_test_phase27_c', now() + interval '1 hour', 'basic', 'month'
  );
  if v_reg ->> 'outcome' <> 'registered' then
    raise exception 'phase27: register after expire failed %', v_reg;
  end if;

  -- J current subscription still blocks at app layer (presence check here)
  -- Insert a current stripe sub and ensure prepare still works (guard is TS);
  -- DB unique open remains one.

  -- K DEMO/SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase27: DEMO mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase27: SUR4 mutated';
  end if;

  raise notice 'phase27_concurrency_hardening_ok';
end;
$phase27$;

rollback;
