-- Billing internal subscription webhook guard · phase57 (D1)
-- A Stripe sync never cancels a current non-Stripe subscription: it is held
-- (nothing written) and the event can be requeued by an operator. prepare and
-- sync share the tenant billing lock (key 31).

begin;

do $phase57$
declare
  v_tenant uuid := 'e5400000-0000-4000-8000-000000000011';
  v_tenant_null uuid := 'e5400000-0000-4000-8000-000000000012';
  v_tenant_ooo uuid := 'e5400000-0000-4000-8000-000000000013';
  v_tenant_modes uuid := 'e5400000-0000-4000-8000-000000000014';
  v_tenant_lock_sync uuid := 'e5400000-0000-4000-8000-000000000015';
  v_tenant_lock_prep uuid := 'e5400000-0000-4000-8000-000000000016';
  v_internal uuid := 'e5400000-0000-4000-8000-000000000061';
  v_internal_null uuid := 'e5400000-0000-4000-8000-000000000062';
  v_internal_ooo uuid := 'e5400000-0000-4000-8000-000000000063';
  v_basic_id uuid;
  v_mvp_id uuid;
  v_before public.subscriptions%rowtype;
  v_after public.subscriptions%rowtype;
  v_sync jsonb;
  v_prep jsonb;
  v_res jsonb;
  v_status text;
  v_count int;
  v_key bigint;
  v_has boolean;
  v_test_sub uuid;
  v_live_sub uuid;
  v_demo_status text;
  v_sur4_status text;
begin
  select s.status into v_demo_status
  from public.subscriptions s join public.tenants t on t.id = s.tenant_id
  where t.slug = 'demo' and s.status in ('trialing', 'active', 'past_due');
  select s.status into v_sur4_status
  from public.subscriptions s join public.tenants t on t.id = s.tenant_id
  where t.slug = 'sur4' and s.status in ('trialing', 'active', 'past_due');

  select p.id into v_basic_id from public.plans p where p.code = 'basic';
  select p.id into v_mvp_id from public.plans p where p.code = 'mvp';
  if v_basic_id is null or v_mvp_id is null then
    raise exception 'phase57: basic/mvp plan missing';
  end if;

  insert into public.tenants (id, name, slug, active)
  values
    (v_tenant, 'Phase54 Internal trial', 'phase57-internal', true),
    (v_tenant_null, 'Phase54 NULL provider', 'phase57-null', true),
    (v_tenant_ooo, 'Phase54 Out of order', 'phase57-ooo', true),
    (v_tenant_modes, 'Phase54 Modes', 'phase57-modes', true),
    (v_tenant_lock_sync, 'Phase54 Lock sync', 'phase57-lock-sync', true),
    (v_tenant_lock_prep, 'Phase54 Lock prepare', 'phase57-lock-prep', true);

  -- SUR4-shaped internal trial (period already over, still trialing).
  insert into public.subscriptions (
    id, tenant_id, plan_id, provider, status,
    current_period_start, current_period_end, metadata
  ) values (
    v_internal, v_tenant, v_basic_id, 'internal', 'trialing',
    now() - interval '40 days', now() - interval '1 day',
    '{"source":"phase57","billing_activation":"deferred_until_go_live"}'::jsonb
  );
  update public.subscriptions set updated_at = now() - interval '2 days' where id = v_internal;
  select * into v_before from public.subscriptions where id = v_internal;

  -- -------------------------------------------------------------------------
  -- A: current Stripe sync for a tenant with a current internal row → held.
  -- -------------------------------------------------------------------------
  foreach v_status in array array['active', 'trialing', 'past_due'] loop
    v_sync := public.sync_billing_subscription_v1(
      v_tenant, v_basic_id, 'stripe', 'cus_phase57', 'sub_phase57_a', v_status,
      now(), now() + interval '30 days', false, '{}'::jsonb,
      now() - interval '1 minute', null, true
    );
    if v_sync ->> 'outcome' is distinct from 'held'
       or v_sync ->> 'code' is distinct from 'internal_subscription_current'
       or (v_sync ->> 'internal_subscription_id')::uuid is distinct from v_internal
       or (v_sync ->> 'held')::boolean is not true
    then
      raise exception 'phase57 A: % sync must be held, got %', v_status, v_sync;
    end if;
  end loop;

  select * into v_after from public.subscriptions where id = v_internal;
  if v_after.status <> 'trialing'
     or v_after.metadata is distinct from v_before.metadata
     or v_after.current_period_end is distinct from v_before.current_period_end
     or v_after.updated_at is distinct from v_before.updated_at
  then
    raise exception 'phase57 A: held sync touched the internal row';
  end if;
  if exists (select 1 from public.subscriptions where provider_subscription_id = 'sub_phase57_a') then
    raise exception 'phase57 A: held sync must not record the Stripe subscription';
  end if;

  -- -------------------------------------------------------------------------
  -- B: NULL provider and mvp plan rows are protected too.
  -- -------------------------------------------------------------------------
  insert into public.subscriptions (id, tenant_id, plan_id, provider, status)
  values (v_internal_null, v_tenant_null, v_mvp_id, null, 'active');

  v_sync := public.sync_billing_subscription_v1(
    v_tenant_null, v_basic_id, 'stripe', 'cus_phase57_b', 'sub_phase57_b', 'active',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, false
  );
  if v_sync ->> 'outcome' is distinct from 'held' then
    raise exception 'phase57 B: NULL provider row must hold the sync, got %', v_sync;
  end if;
  if (select status from public.subscriptions where id = v_internal_null) <> 'active' then
    raise exception 'phase57 B: NULL provider row was canceled';
  end if;

  -- -------------------------------------------------------------------------
  -- C: non-current Stripe statuses are recorded as before (no hold); a later
  --    current update for the same subscription is held and changes nothing.
  -- -------------------------------------------------------------------------
  insert into public.subscriptions (id, tenant_id, plan_id, provider, status)
  values (v_internal_ooo, v_tenant_ooo, v_basic_id, 'internal', 'active');

  v_sync := public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase57_c', 'sub_phase57_c', 'incomplete',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '5 minutes', null, false
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'incomplete' then
    raise exception 'phase57 C: incomplete must be recorded, got %', v_sync;
  end if;

  v_sync := public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase57_c', 'sub_phase57_c', 'active',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, false
  );
  if v_sync ->> 'outcome' is distinct from 'held' then
    raise exception 'phase57 C: active update must be held, got %', v_sync;
  end if;
  if (select status from public.subscriptions where provider_subscription_id = 'sub_phase57_c') <> 'incomplete'
     or (select status from public.subscriptions where id = v_internal_ooo) <> 'active'
  then
    raise exception 'phase57 C: held update changed rows';
  end if;

  -- Once the operator closes the internal row, the same sync applies.
  update public.subscriptions set status = 'canceled' where id = v_internal_ooo;
  v_sync := public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase57_c', 'sub_phase57_c', 'active',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, false
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'active' then
    raise exception 'phase57 C: sync after closing the internal row must apply, got %', v_sync;
  end if;

  -- -------------------------------------------------------------------------
  -- D: one-current among Stripe rows unchanged: Live current cancels Test.
  -- -------------------------------------------------------------------------
  v_sync := public.sync_billing_subscription_v1(
    v_tenant_modes, v_basic_id, 'stripe', 'cus_phase57_d_test', 'sub_phase57_d_test', 'active',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '5 minutes', null, false
  );
  v_test_sub := (v_sync ->> 'subscription_id')::uuid;
  v_sync := public.sync_billing_subscription_v1(
    v_tenant_modes, v_basic_id, 'stripe', 'cus_phase57_d_live', 'sub_phase57_d_live', 'active',
    now(), now() + interval '30 days', false, '{}'::jsonb,
    now() - interval '1 minute', null, true
  );
  v_live_sub := (v_sync ->> 'subscription_id')::uuid;
  if (select status from public.subscriptions where id = v_test_sub) <> 'canceled'
     or (select status from public.subscriptions where id = v_live_sub) <> 'active'
  then
    raise exception 'phase57 D: Stripe one-current must still cancel the Test row';
  end if;

  -- -------------------------------------------------------------------------
  -- E: prepare refuses Checkout in every mode while the internal row is current.
  -- -------------------------------------------------------------------------
  foreach v_has in array array[false, true] loop
    v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', v_has);
    if v_prep ->> 'outcome' is distinct from 'internal_subscription_current'
       or v_prep ->> 'code' is distinct from 'internal_subscription_current'
    then
      raise exception 'phase57 E: prepare (livemode %) must refuse, got %', v_has, v_prep;
    end if;
  end loop;
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_null, 'basic', 'month', 'onboarding', false);
  if v_prep ->> 'outcome' is distinct from 'internal_subscription_current' then
    raise exception 'phase57 E: NULL provider must refuse onboarding Checkout, got %', v_prep;
  end if;
  select count(*) into v_count
  from public.billing_checkout_attempts
  where tenant_id in (v_tenant, v_tenant_null);
  if v_count <> 0 then
    raise exception 'phase57 E: refused prepare must not reserve attempts, got %', v_count;
  end if;

  -- -------------------------------------------------------------------------
  -- F: shared tenant billing lock (key 31) in sync and prepare; 4242 retired.
  -- -------------------------------------------------------------------------
  perform public.sync_billing_subscription_v1(
    v_tenant_lock_sync, v_basic_id, 'stripe', 'cus_phase57_f', 'sub_phase57_f', 'canceled',
    now(), now() + interval '30 days', false, '{}'::jsonb, null, null, false
  );
  perform public.prepare_billing_checkout_attempt_v2(v_tenant_lock_prep, 'basic', 'month', 'billing', false);

  foreach v_key in array array[
    pg_catalog.hashtextextended(v_tenant_lock_sync::text, 31),
    pg_catalog.hashtextextended(v_tenant_lock_prep::text, 31)
  ] loop
    select exists (
      select 1 from pg_catalog.pg_locks l
      where l.locktype = 'advisory'
        and l.pid = pg_catalog.pg_backend_pid()
        and l.objsubid = 1
        and l.classid::text = ((v_key >> 32) & 4294967295)::text
        and l.objid::text = (v_key & 4294967295)::text
    ) into v_has;
    if not v_has then
      raise exception 'phase57 F: tenant billing lock (key 31) not taken';
    end if;
  end loop;

  v_key := pg_catalog.hashtextextended(v_tenant_lock_sync::text, 4242);
  select exists (
    select 1 from pg_catalog.pg_locks l
    where l.locktype = 'advisory'
      and l.pid = pg_catalog.pg_backend_pid()
      and l.objsubid = 1
      and l.classid::text = ((v_key >> 32) & 4294967295)::text
      and l.objid::text = (v_key & 4294967295)::text
  ) into v_has;
  if v_has then
    raise exception 'phase57 F: sync must no longer use the private 4242 key';
  end if;

  -- -------------------------------------------------------------------------
  -- G: requeue_billing_webhook_event_v1, operator path for held events.
  -- -------------------------------------------------------------------------
  insert into public.billing_webhook_events (
    provider, provider_event_id, event_type, livemode, status, error_code, retryable, processed_at
  ) values
    ('stripe', 'evt_phase57_held', 'checkout.session.completed', false, 'failed',
     'internal_subscription_current', false, now()),
    ('stripe', 'evt_phase57_price', 'checkout.session.completed', false, 'failed',
     'unknown_price_mapping', false, now()),
    ('stripe', 'evt_phase57_ok', 'invoice.paid', false, 'processed', null, false, now());

  -- Before requeue the held event is final for a provider resend.
  v_res := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase57_held', 'checkout.session.completed', false, null, null
  );
  if v_res ->> 'outcome' <> 'already_final' then
    raise exception 'phase57 G: held event must be final before requeue, got %', v_res;
  end if;

  v_res := public.requeue_billing_webhook_event_v1('evt_phase57_held');
  if v_res ->> 'outcome' <> 'requeued' or (v_res ->> 'idempotent')::boolean then
    raise exception 'phase57 G: requeue failed %', v_res;
  end if;
  if not (select retryable from public.billing_webhook_events where provider_event_id = 'evt_phase57_held')
     or (select (metadata ->> 'requeue_count')::int from public.billing_webhook_events where provider_event_id = 'evt_phase57_held') <> 1
  then
    raise exception 'phase57 G: requeue must mark retryable and count it';
  end if;
  v_res := public.requeue_billing_webhook_event_v1('evt_phase57_held');
  if v_res ->> 'outcome' <> 'requeued' or not (v_res ->> 'idempotent')::boolean then
    raise exception 'phase57 G: second requeue must be idempotent, got %', v_res;
  end if;

  v_res := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase57_held', 'checkout.session.completed', false, null, null
  );
  if v_res ->> 'outcome' <> 'claimed' then
    raise exception 'phase57 G: requeued event must be claimable on resend, got %', v_res;
  end if;

  foreach v_status in array array['evt_phase57_price', 'evt_phase57_ok'] loop
    v_res := public.requeue_billing_webhook_event_v1(v_status);
    if v_res ->> 'outcome' <> 'rejected' or v_res ->> 'reason' <> 'not_held' then
      raise exception 'phase57 G: % must not be requeued, got %', v_status, v_res;
    end if;
  end loop;
  v_res := public.requeue_billing_webhook_event_v1('evt_phase57_missing');
  if v_res ->> 'reason' <> 'not_found' then
    raise exception 'phase57 G: missing event, got %', v_res;
  end if;
  v_res := public.requeue_billing_webhook_event_v1('  ');
  if v_res ->> 'reason' <> 'missing_identity' then
    raise exception 'phase57 G: blank id, got %', v_res;
  end if;

  if has_function_privilege('anon', 'public.requeue_billing_webhook_event_v1(text)', 'execute')
     or has_function_privilege('authenticated', 'public.requeue_billing_webhook_event_v1(text)', 'execute')
     or not has_function_privilege('service_role', 'public.requeue_billing_webhook_event_v1(text)', 'execute')
  then
    raise exception 'phase57 G: requeue must be service-only';
  end if;
  if has_function_privilege('authenticated', 'public.sync_billing_subscription_v1(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)', 'execute')
  then
    raise exception 'phase57: sync/prepare must stay service-only';
  end if;

  -- -------------------------------------------------------------------------
  -- H: DEMO/SUR4 untouched.
  -- -------------------------------------------------------------------------
  if (select s.status from public.subscriptions s join public.tenants t on t.id = s.tenant_id
      where t.slug = 'demo' and s.status in ('trialing', 'active', 'past_due')) is distinct from v_demo_status
     or (select s.status from public.subscriptions s join public.tenants t on t.id = s.tenant_id
      where t.slug = 'sur4' and s.status in ('trialing', 'active', 'past_due')) is distinct from v_sur4_status
  then
    raise exception 'phase57: DEMO/SUR4 mutated';
  end if;

  raise notice 'phase57_billing_internal_subscription_guard_ok';
end;
$phase57$;

rollback;
