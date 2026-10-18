-- Billing Checkout re-subscribe after cancellation · phase53
-- A completed attempt must stop blocking Checkout once the subscription it
-- produced has been recorded and has ended (canceled). Until then it keeps
-- answering checkout_processing: Stripe may hold a paid subscription that the
-- webhook has not recorded yet, and a second Checkout would charge twice.

begin;

do $phase53$
declare
  v_tenant uuid := 'e5300000-0000-4000-8000-000000000011';
  v_tenant_ooo uuid := 'e5300000-0000-4000-8000-000000000012';
  v_tenant_nosync uuid := 'e5300000-0000-4000-8000-000000000013';
  v_tenant_incomplete uuid := 'e5300000-0000-4000-8000-000000000014';
  v_tenant_old uuid := 'e5300000-0000-4000-8000-000000000015';
  v_tenant_mode uuid := 'e5300000-0000-4000-8000-000000000016';
  v_basic_id uuid;
  v_prep jsonb;
  v_fin jsonb;
  v_sync jsonb;
  v_attempt uuid;
  v_attempt2 uuid;
  v_key text;
  v_status text;
  v_active_count int;
  v_demo_active boolean;
  v_sur4_active boolean;
begin
  select t.active into v_demo_active from public.tenants t where t.slug = 'demo';
  select t.active into v_sur4_active from public.tenants t where t.slug = 'sur4';

  select p.id into v_basic_id from public.plans p where p.code = 'basic' limit 1;
  if v_basic_id is null then
    raise exception 'phase53: basic plan missing';
  end if;

  insert into public.tenants (id, name, slug, active)
  values
    (v_tenant, 'Phase53 Tenant', 'phase53-tenant', true),
    (v_tenant_ooo, 'Phase53 Out of order', 'phase53-ooo', true),
    (v_tenant_nosync, 'Phase53 No sync', 'phase53-nosync', true),
    (v_tenant_incomplete, 'Phase53 Incomplete', 'phase53-incomplete', true),
    (v_tenant_old, 'Phase53 Old sub', 'phase53-old', true),
    (v_tenant_mode, 'Phase53 Mode', 'phase53-mode', true);

  -- -------------------------------------------------------------------------
  -- A: checkout → webhook → cancel → Checkout again (webhook order).
  -- -------------------------------------------------------------------------
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase53 A: first prepare expected reserved, got %', v_prep;
  end if;
  v_attempt := (v_prep ->> 'attempt_id')::uuid;
  v_key := v_prep ->> 'idempotency_key';
  perform public.attach_billing_checkout_session_v2(
    v_attempt, 'cs_test_phase53_a', now() + interval '1 hour'
  );

  -- checkout.session.completed: finalize first, then sync (lib/billing/webhook.ts).
  v_fin := public.finalize_billing_checkout_attempt_v2(null, 'cs_test_phase53_a', 'completed');
  if v_fin ->> 'outcome' <> 'finalized' then
    raise exception 'phase53 A: finalize completed failed %', v_fin;
  end if;
  v_sync := public.sync_billing_subscription_v1(
    v_tenant, v_basic_id, 'stripe', 'cus_phase53_a', 'sub_phase53_a', 'active',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '5 minutes', null, false
  );
  if v_sync ->> 'status' <> 'active' then
    raise exception 'phase53 A: sync active failed %', v_sync;
  end if;

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'current_subscription_exists' then
    raise exception 'phase53 A: active subscription must block Checkout, got %', v_prep;
  end if;

  -- customer.subscription.deleted
  v_sync := public.sync_billing_subscription_v1(
    v_tenant, v_basic_id, 'stripe', 'cus_phase53_a', 'sub_phase53_a', 'canceled',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, false
  );
  if v_sync ->> 'status' <> 'canceled' then
    raise exception 'phase53 A: sync canceled failed %', v_sync;
  end if;

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase53 A: re-subscribe after cancellation must reserve a new attempt, got %', v_prep;
  end if;
  v_attempt2 := (v_prep ->> 'attempt_id')::uuid;
  if v_attempt2 = v_attempt then
    raise exception 'phase53 A: new attempt must differ from the completed one';
  end if;
  if v_prep ->> 'idempotency_key' = v_key then
    raise exception 'phase53 A: new attempt must get a new idempotency key';
  end if;

  select a.status into v_status from public.billing_checkout_attempts a where a.id = v_attempt;
  if v_status is distinct from 'settled' then
    raise exception 'phase53 A: completed attempt must become settled, got %', v_status;
  end if;

  select count(*) into v_active_count
  from public.billing_checkout_attempts a
  where a.tenant_id = v_tenant
    and a.status = any (array['creating', 'open', 'completed']);
  if v_active_count <> 1 then
    raise exception 'phase53 A: expected one active attempt after re-subscribe, got %', v_active_count;
  end if;

  -- Re-delivered checkout.session.completed for the old session must not revive it.
  v_fin := public.finalize_billing_checkout_attempt_v2(null, 'cs_test_phase53_a', 'completed');
  if v_fin ->> 'outcome' <> 'noop' or v_fin ->> 'reason' <> 'already_terminal' then
    raise exception 'phase53 A: late finalize on settled attempt must be a terminal noop, got %', v_fin;
  end if;
  select a.status into v_status from public.billing_checkout_attempts a where a.id = v_attempt;
  if v_status is distinct from 'settled' then
    raise exception 'phase53 A: late finalize changed settled attempt to %', v_status;
  end if;

  -- The new attempt keeps working as before.
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'reserved' or (v_prep ->> 'attempt_id')::uuid <> v_attempt2 then
    raise exception 'phase53 A: second prepare must resume the new attempt, got %', v_prep;
  end if;

  -- -------------------------------------------------------------------------
  -- B: subscription created and canceled before the attempt is finalized
  --    (out-of-order webhooks, or finalize via resolveReusableCheckoutSession).
  -- -------------------------------------------------------------------------
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_ooo, 'basic', 'month', 'billing', false);
  v_attempt := (v_prep ->> 'attempt_id')::uuid;
  perform public.attach_billing_checkout_session_v2(
    v_attempt, 'cs_test_phase53_b', now() + interval '1 hour'
  );
  perform public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase53_b', 'sub_phase53_b', 'active',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '5 minutes', null, false
  );
  perform public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase53_b', 'sub_phase53_b', 'canceled',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, false
  );
  perform public.finalize_billing_checkout_attempt_v2(v_attempt, 'cs_test_phase53_b', 'completed');

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_ooo, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'reserved' or (v_prep ->> 'attempt_id')::uuid = v_attempt then
    raise exception 'phase53 B: cancellation recorded before finalize must still release, got %', v_prep;
  end if;

  -- -------------------------------------------------------------------------
  -- C: completed but the subscription was never recorded (sync failed without
  --    retry, e.g. unknown_price_mapping). Stays blocked, also long after the
  --    session expiry: Stripe may hold a paid subscription. Operator case.
  -- -------------------------------------------------------------------------
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_nosync, 'basic', 'month', 'billing', false);
  v_attempt := (v_prep ->> 'attempt_id')::uuid;
  perform public.attach_billing_checkout_session_v2(
    v_attempt, 'cs_test_phase53_c', now() + interval '1 hour'
  );
  perform public.finalize_billing_checkout_attempt_v2(null, 'cs_test_phase53_c', 'completed');
  update public.billing_checkout_attempts a
  set
    created_at = now() - interval '30 days',
    updated_at = now() - interval '30 days',
    expires_at = now() - interval '29 days'
  where a.id = v_attempt;

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_nosync, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase53 C: completed attempt without recorded subscription must stay checkout_processing, got %', v_prep;
  end if;
  select a.status into v_status from public.billing_checkout_attempts a where a.id = v_attempt;
  if v_status is distinct from 'completed' then
    raise exception 'phase53 C: unrecorded completed attempt must stay completed, got %', v_status;
  end if;

  -- -------------------------------------------------------------------------
  -- D: this checkout's subscription is recorded but not ended (incomplete),
  --    or another one created since the attempt is still alive → blocked.
  -- -------------------------------------------------------------------------
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_incomplete, 'basic', 'month', 'billing', false);
  v_attempt := (v_prep ->> 'attempt_id')::uuid;
  perform public.attach_billing_checkout_session_v2(
    v_attempt, 'cs_test_phase53_d', now() + interval '1 hour'
  );
  perform public.finalize_billing_checkout_attempt_v2(null, 'cs_test_phase53_d', 'completed');
  perform public.sync_billing_subscription_v1(
    v_tenant_incomplete, v_basic_id, 'stripe', 'cus_phase53_d', 'sub_phase53_d', 'incomplete',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '5 minutes', null, false
  );

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_incomplete, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase53 D: incomplete subscription must keep checkout_processing, got %', v_prep;
  end if;

  -- A canceled sibling does not release while another recent row is alive.
  perform public.sync_billing_subscription_v1(
    v_tenant_incomplete, v_basic_id, 'stripe', 'cus_phase53_d', 'sub_phase53_d_other', 'canceled',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '4 minutes', null, false
  );
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_incomplete, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase53 D: canceled sibling with an incomplete row alive must not release, got %', v_prep;
  end if;

  update public.subscriptions s set status = 'unpaid' where s.provider_subscription_id = 'sub_phase53_d';
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_incomplete, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase53 D: unpaid row alive must not release, got %', v_prep;
  end if;

  update public.subscriptions s set status = 'paused' where s.provider_subscription_id = 'sub_phase53_d';
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_incomplete, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase53 D: paused row alive must not release, got %', v_prep;
  end if;

  -- incomplete_expired is synced as canceled: once every recent row ended, release.
  update public.subscriptions s set status = 'canceled' where s.provider_subscription_id = 'sub_phase53_d';
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_incomplete, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'reserved' or (v_prep ->> 'attempt_id')::uuid = v_attempt then
    raise exception 'phase53 D: all recent rows canceled must release, got %', v_prep;
  end if;

  -- -------------------------------------------------------------------------
  -- E: a late event on an OLDER canceled subscription must not release the
  --    attempt while this checkout's own subscription is still unrecorded.
  -- -------------------------------------------------------------------------
  perform public.sync_billing_subscription_v1(
    v_tenant_old, v_basic_id, 'stripe', 'cus_phase53_e', 'sub_phase53_e_old', 'canceled',
    now() - interval '60 days', now() - interval '30 days', false, '{}'::jsonb,
    now() - interval '30 days', null, false
  );
  update public.subscriptions s
  set created_at = now() - interval '60 days', updated_at = now() - interval '30 days'
  where s.provider_subscription_id = 'sub_phase53_e_old';

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_old, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase53 E: old canceled subscription must not block a first Checkout, got %', v_prep;
  end if;
  v_attempt := (v_prep ->> 'attempt_id')::uuid;
  perform public.attach_billing_checkout_session_v2(
    v_attempt, 'cs_test_phase53_e', now() + interval '1 hour'
  );
  perform public.finalize_billing_checkout_attempt_v2(null, 'cs_test_phase53_e', 'completed');
  -- Late, non-stale event for the old subscription touches its row now.
  perform public.sync_billing_subscription_v1(
    v_tenant_old, v_basic_id, 'stripe', 'cus_phase53_e', 'sub_phase53_e_old', 'canceled',
    now() - interval '60 days', now() - interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, false
  );

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_old, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase53 E: older canceled subscription must not release the new attempt, got %', v_prep;
  end if;

  -- -------------------------------------------------------------------------
  -- F: Test and Live are independent: a canceled Live subscription does not
  --    release a completed Test attempt.
  -- -------------------------------------------------------------------------
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_mode, 'basic', 'month', 'billing', false);
  v_attempt := (v_prep ->> 'attempt_id')::uuid;
  perform public.attach_billing_checkout_session_v2(
    v_attempt, 'cs_test_phase53_f', now() + interval '1 hour'
  );
  perform public.finalize_billing_checkout_attempt_v2(null, 'cs_test_phase53_f', 'completed');
  perform public.sync_billing_subscription_v1(
    v_tenant_mode, v_basic_id, 'stripe', 'cus_phase53_f_live', 'sub_phase53_f_live', 'canceled',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, true
  );

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_mode, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'checkout_processing' then
    raise exception 'phase53 F: Live cancellation must not release a Test attempt, got %', v_prep;
  end if;
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_mode, 'basic', 'month', 'billing', true);
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase53 F: Live Checkout independent of Test attempt, got %', v_prep;
  end if;

  -- -------------------------------------------------------------------------
  -- G: DEMO/SUR4 untouched; service-only grants unchanged.
  -- -------------------------------------------------------------------------
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase53: DEMO mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase53: SUR4 mutated';
  end if;
  if has_function_privilege('anon', 'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)', 'execute')
  then
    raise exception 'phase53: prepare_v2 must stay service-only';
  end if;

  raise notice 'phase53_billing_checkout_resubscribe_ok';
end;
$phase53$;

rollback;
