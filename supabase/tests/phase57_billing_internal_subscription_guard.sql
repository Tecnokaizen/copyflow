-- Billing internal subscription webhook guard · phase57 (D1, options B + C)
-- A Stripe sync never cancels a protected internal subscription: it is held,
-- traced and blocks new Checkout until reconciled. Recovery is idempotent.
-- prepare, sync and the operator RPCs share the tenant billing lock (key 31).

begin;

do $phase57$
declare
  v_tenant uuid := 'e5700000-0000-4000-8000-000000000011';
  v_tenant_null uuid := 'e5700000-0000-4000-8000-000000000012';
  v_tenant_ooo uuid := 'e5700000-0000-4000-8000-000000000013';
  v_tenant_modes uuid := 'e5700000-0000-4000-8000-000000000014';
  v_tenant_lock_sync uuid := 'e5700000-0000-4000-8000-000000000015';
  v_tenant_lock_prep uuid := 'e5700000-0000-4000-8000-000000000016';
  v_tenant_pending uuid := 'e5700000-0000-4000-8000-000000000017';
  v_tenant_stuck uuid := 'e5700000-0000-4000-8000-000000000018';
  v_internal uuid := 'e5700000-0000-4000-8000-000000000061';
  v_internal_null uuid := 'e5700000-0000-4000-8000-000000000062';
  v_internal_ooo uuid := 'e5700000-0000-4000-8000-000000000063';
  v_internal_pending uuid := 'e5700000-0000-4000-8000-000000000064';
  v_basic_id uuid;
  v_mvp_id uuid;
  v_before public.subscriptions%rowtype;
  v_after public.subscriptions%rowtype;
  v_hold billing_private.subscription_holds%rowtype;
  v_hold_a uuid;
  v_hold_pending uuid;
  v_sync jsonb;
  v_prep jsonb;
  v_res jsonb;
  v_list jsonb;
  v_status text;
  v_count int;
  v_key bigint;
  v_has boolean;
  v_test_sub uuid;
  v_live_sub uuid;
  v_audit record;
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
    (v_tenant, 'Phase57 Internal trial', 'phase57-internal', true),
    (v_tenant_null, 'Phase57 NULL provider', 'phase57-null', true),
    (v_tenant_ooo, 'Phase57 Out of order', 'phase57-ooo', true),
    (v_tenant_modes, 'Phase57 Modes', 'phase57-modes', true),
    (v_tenant_lock_sync, 'Phase57 Lock sync', 'phase57-lock-sync', true),
    (v_tenant_lock_prep, 'Phase57 Lock prepare', 'phase57-lock-prep', true),
    (v_tenant_pending, 'Phase57 Pending', 'phase57-pending', true),
    (v_tenant_stuck, 'Phase57 Stuck checkout', 'phase57-stuck', true);

  -- SUR4-shaped internal trial (period already over, still trialing).
  insert into public.subscriptions (
    id, tenant_id, plan_id, provider, status,
    current_period_start, current_period_end, metadata
  ) values (
    v_internal, v_tenant, v_basic_id, 'internal', 'trialing',
    now() - interval '40 days', now() - interval '1 day',
    '{"source":"phase57","billing_activation":"deferred_until_go_live"}'::jsonb
  );
  select * into v_before from public.subscriptions where id = v_internal;

  -- -------------------------------------------------------------------------
  -- A: a current Stripe sync for a tenant with a protected internal row is
  --    held: nothing written to subscriptions, one traced hold per Stripe
  --    subscription, event ids deduplicated.
  -- -------------------------------------------------------------------------
  foreach v_status in array array['active', 'trialing', 'past_due', 'active'] loop
    v_sync := public.sync_billing_subscription_v1(
      v_tenant, v_basic_id, 'stripe', 'cus_phase57', 'sub_phase57_a', v_status,
      now(), now() + interval '30 days', false,
      jsonb_build_object('plan_code', 'basic', 'stripe_event_id',
        case when v_status = 'trialing' then 'evt_phase57_a1' else 'evt_phase57_a_' || v_status end),
      now() - interval '1 minute', null, true
    );
    if v_sync ->> 'outcome' is distinct from 'held'
       or v_sync ->> 'code' is distinct from 'internal_subscription_current'
       or (v_sync ->> 'internal_subscription_id')::uuid is distinct from v_internal
       or (v_sync ->> 'held')::boolean is not true
       or v_sync ->> 'hold_id' is null
    then
      raise exception 'phase57 A: % sync must be held, got %', v_status, v_sync;
    end if;
    if v_hold_a is null then
      v_hold_a := (v_sync ->> 'hold_id')::uuid;
      if not (v_sync ->> 'hold_created')::boolean then
        raise exception 'phase57 A: first held sync must open the hold (alert)';
      end if;
    elsif (v_sync ->> 'hold_id')::uuid <> v_hold_a or (v_sync ->> 'hold_created')::boolean then
      raise exception 'phase57 A: repeated held syncs must reuse the hold without a new alert, got %', v_sync;
    end if;
  end loop;

  select * into v_hold from billing_private.subscription_holds where id = v_hold_a;
  if v_hold.status <> 'held' or v_hold.hold_count <> 4 or not v_hold.livemode
     or v_hold.tenant_id <> v_tenant or v_hold.internal_subscription_id <> v_internal
     or v_hold.last_status <> 'active' or v_hold.provider_customer_id <> 'cus_phase57'
     or v_hold.event_ids <> array['evt_phase57_a_active', 'evt_phase57_a1', 'evt_phase57_a_past_due']
     or jsonb_array_length(v_hold.history) <> 4
  then
    raise exception 'phase57 A: hold trace wrong: % % %', v_hold.hold_count, v_hold.event_ids, v_hold.history;
  end if;

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
    now(), now() + interval '30 days', false, '{"stripe_event_id":"evt_phase57_b"}'::jsonb,
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
  --    current update is held; once the internal row is closed the same event
  --    applies and reconciles the hold. The event id never reaches
  --    subscriptions.metadata.
  -- -------------------------------------------------------------------------
  insert into public.subscriptions (id, tenant_id, plan_id, provider, status)
  values (v_internal_ooo, v_tenant_ooo, v_basic_id, 'internal', 'active');

  v_sync := public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase57_c', 'sub_phase57_c', 'incomplete',
    now(), now() + interval '30 days', false, '{"stripe_event_id":"evt_phase57_c0"}'::jsonb,
    now() - interval '5 minutes', null, false
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'incomplete' then
    raise exception 'phase57 C: incomplete must be recorded, got %', v_sync;
  end if;

  v_sync := public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase57_c', 'sub_phase57_c', 'active',
    now(), now() + interval '30 days', false, '{"stripe_event_id":"evt_phase57_c1"}'::jsonb,
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

  update public.subscriptions set status = 'canceled' where id = v_internal_ooo;
  v_sync := public.sync_billing_subscription_v1(
    v_tenant_ooo, v_basic_id, 'stripe', 'cus_phase57_c', 'sub_phase57_c', 'active',
    now(), now() + interval '30 days', false, '{"stripe_event_id":"evt_phase57_c1"}'::jsonb,
    now() - interval '1 minute', null, false
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'active' or v_sync ->> 'reconciled_hold_id' is null then
    raise exception 'phase57 C: sync after closing must apply and reconcile, got %', v_sync;
  end if;
  if (select status from billing_private.subscription_holds where provider_subscription_id = 'sub_phase57_c') <> 'reconciled' then
    raise exception 'phase57 C: hold must be reconciled';
  end if;
  if exists (
    select 1 from public.subscriptions
    where provider_subscription_id = 'sub_phase57_c' and metadata ? 'stripe_event_id'
  ) then
    raise exception 'phase57 C: stripe_event_id must not be stored on the subscription';
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
  -- E: no incompatible Checkout with a protected internal row: every mode,
  --    both flows, and an existing open attempt is not reused.
  -- -------------------------------------------------------------------------
  foreach v_has in array array[false, true] loop
    v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', v_has);
    if v_prep ->> 'outcome' is distinct from 'internal_subscription_current' then
      raise exception 'phase57 E: prepare (livemode %) must refuse, got %', v_has, v_prep;
    end if;
  end loop;
  insert into public.billing_checkout_attempts (
    tenant_id, provider, provider_session_id, status, plan_code, billing_interval, expires_at, livemode
  ) values (
    v_tenant_null, 'stripe', 'cs_test_phase57_open', 'open', 'basic', 'month', now() + interval '20 hours', false
  );
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_null, 'basic', 'month', 'onboarding', false);
  if v_prep ->> 'outcome' is distinct from 'internal_subscription_current' then
    raise exception 'phase57 E: an open attempt must not be reused while protected, got %', v_prep;
  end if;
  select count(*) into v_count from public.billing_checkout_attempts where tenant_id = v_tenant;
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
      where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid() and l.objsubid = 1
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
    where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid() and l.objsubid = 1
      and l.classid::text = ((v_key >> 32) & 4294967295)::text
      and l.objid::text = (v_key & 4294967295)::text
  ) into v_has;
  if v_has then
    raise exception 'phase57 F: sync must no longer use the private 4242 key';
  end if;

  -- -------------------------------------------------------------------------
  -- G: a pending hold blocks new charges even after the internal row is
  --    closed; dismissal (after verifying Stripe) is traced and idempotent.
  -- -------------------------------------------------------------------------
  insert into public.subscriptions (id, tenant_id, plan_id, provider, status)
  values (v_internal_pending, v_tenant_pending, v_basic_id, 'internal', 'active');
  v_sync := public.sync_billing_subscription_v1(
    v_tenant_pending, v_basic_id, 'stripe', 'cus_phase57_g', 'sub_phase57_g', 'active',
    now(), now() + interval '30 days', false, '{"stripe_event_id":"evt_phase57_g"}'::jsonb,
    now() - interval '1 minute', null, false
  );
  v_hold_pending := (v_sync ->> 'hold_id')::uuid;
  update public.subscriptions set status = 'canceled' where id = v_internal_pending;

  foreach v_has in array array[false, true] loop
    v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_pending, 'basic', 'month', 'billing', v_has);
    if v_prep ->> 'outcome' is distinct from 'subscription_pending_reconciliation' then
      raise exception 'phase57 G: pending hold must block Checkout (livemode %), got %', v_has, v_prep;
    end if;
  end loop;
  v_res := public.grant_internal_subscription_v1(v_tenant_pending, 'basic', 'active', null, 'Grant while pending', 'owner');
  if v_res ->> 'reason' is distinct from 'subscription_pending_reconciliation' then
    raise exception 'phase57 G: pending hold must block internal grants, got %', v_res;
  end if;

  v_res := public.resolve_billing_subscription_hold_v1(v_hold_pending, 'short', 'owner');
  if v_res ->> 'reason' <> 'reason_required' then raise exception 'phase57 G: resolve reason %', v_res; end if;
  v_res := public.resolve_billing_subscription_hold_v1(v_hold_pending, 'Refunded and canceled in Stripe (verified)', ' ');
  if v_res ->> 'reason' <> 'authorization_required' then raise exception 'phase57 G: resolve authorizer %', v_res; end if;
  v_res := public.resolve_billing_subscription_hold_v1(v_hold_pending, 'Refunded and canceled in Stripe (verified)', 'owner:phase57');
  if v_res ->> 'outcome' <> 'dismissed' or (v_res ->> 'idempotent')::boolean then
    raise exception 'phase57 G: dismiss failed %', v_res;
  end if;
  v_res := public.resolve_billing_subscription_hold_v1(v_hold_pending, 'Refunded and canceled in Stripe (verified)', 'owner:phase57');
  if v_res ->> 'outcome' <> 'dismissed' or not (v_res ->> 'idempotent')::boolean then
    raise exception 'phase57 G: second dismiss must be idempotent %', v_res;
  end if;
  select * into v_hold from billing_private.subscription_holds where id = v_hold_pending;
  if v_hold.resolution_reason <> 'Refunded and canceled in Stripe (verified)' or v_hold.resolved_by <> 'owner:phase57'
     or v_hold.history -> -1 ->> 'action' <> 'dismissed'
  then
    raise exception 'phase57 G: dismissal not traced';
  end if;
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant_pending, 'basic', 'month', 'billing', false);
  if v_prep ->> 'outcome' <> 'reserved' then
    raise exception 'phase57 G: after dismissal Checkout is allowed again, got %', v_prep;
  end if;
  v_res := public.resolve_billing_subscription_hold_v1(
    (select id from billing_private.subscription_holds where provider_subscription_id = 'sub_phase57_c'),
    'Should not dismiss a reconciled hold', 'owner');
  if v_res ->> 'reason' <> 'already_reconciled' then
    raise exception 'phase57 G: reconciled hold cannot be dismissed, got %', v_res;
  end if;

  -- -------------------------------------------------------------------------
  -- H: requeue of a hold: refused while protected, idempotent afterwards, and
  --    the requeued events are claimable for a Stripe resend.
  -- -------------------------------------------------------------------------
  insert into public.billing_webhook_events (
    provider, provider_event_id, event_type, livemode, status, error_code, retryable, processed_at
  )
  select 'stripe', e, 'customer.subscription.updated', true, 'failed', 'internal_subscription_current', false, now()
  from unnest(array['evt_phase57_a_active', 'evt_phase57_a1', 'evt_phase57_a_past_due']) as e;
  insert into public.billing_webhook_events (
    provider, provider_event_id, event_type, livemode, status, error_code, retryable, processed_at
  ) values ('stripe', 'evt_phase57_other', 'invoice.paid', true, 'failed', 'unknown_price_mapping', false, now());

  v_res := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase57_a1', 'customer.subscription.updated', true, null, null
  );
  if v_res ->> 'outcome' <> 'already_final' then
    raise exception 'phase57 H: held event must be final before requeue, got %', v_res;
  end if;

  v_res := public.requeue_billing_subscription_hold_v1(v_hold_a, 'Adopt the paid Stripe subscription', 'owner:phase57');
  if v_res ->> 'reason' <> 'internal_subscription_current' then
    raise exception 'phase57 H: requeue must wait for the internal row, got %', v_res;
  end if;
  v_res := public.requeue_billing_subscription_hold_v1(v_hold_a, 'short', 'owner');
  if v_res ->> 'reason' <> 'reason_required' then raise exception 'phase57 H: requeue reason %', v_res; end if;
  v_res := public.requeue_billing_subscription_hold_v1(v_hold_pending, 'Dismissed hold cannot be requeued', 'owner');
  if v_res ->> 'reason' <> 'not_held' then raise exception 'phase57 H: dismissed requeue %', v_res; end if;

  -- -------------------------------------------------------------------------
  -- I (option C): the operator marks the internal row ready_for_checkout
  --    (audited RPC); new Checkout stays blocked by the pending hold; requeue
  --    + resend converts the internal row and reconciles the hold.
  -- -------------------------------------------------------------------------
  v_res := public.set_internal_billing_activation_v1(v_tenant, 'stripe_checkout_pending', 'Not an allowed value', 'owner');
  if v_res ->> 'reason' <> 'invalid_input' then raise exception 'phase57 I: invalid value %', v_res; end if;
  v_res := public.set_internal_billing_activation_v1(v_tenant, 'ready_for_checkout', 'short', 'owner');
  if v_res ->> 'reason' <> 'reason_required' then raise exception 'phase57 I: reason %', v_res; end if;
  v_res := public.set_internal_billing_activation_v1(v_tenant_modes, 'ready_for_checkout', 'No internal row here', 'owner');
  if v_res ->> 'reason' <> 'no_internal_subscription' then raise exception 'phase57 I: no internal %', v_res; end if;

  v_res := public.set_internal_billing_activation_v1(
    v_tenant, 'ready_for_checkout', 'SUR4-like cutover authorized for test', 'owner:phase57'
  );
  if v_res ->> 'outcome' <> 'updated' or v_res ->> 'previous' <> 'deferred_until_go_live' then
    raise exception 'phase57 I: mark ready %', v_res;
  end if;
  v_res := public.set_internal_billing_activation_v1(
    v_tenant, 'ready_for_checkout', 'SUR4-like cutover authorized for test', 'owner:phase57'
  );
  if v_res ->> 'outcome' <> 'unchanged' then raise exception 'phase57 I: idempotent mark %', v_res; end if;

  select * into v_audit from billing_private.internal_subscription_audit
  where subscription_id = v_internal order by id desc limit 1;
  if v_audit.via is distinct from 'activation_rpc' or v_audit.reason is distinct from 'SUR4-like cutover authorized for test'
     or v_audit.authorized_by is distinct from 'owner:phase57' or v_audit.action is distinct from 'update'
  then
    raise exception 'phase57 I: activation not audited: % % %', v_audit.via, v_audit.reason, v_audit.authorized_by;
  end if;

  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', true);
  if v_prep ->> 'outcome' <> 'subscription_pending_reconciliation' then
    raise exception 'phase57 I: ready row with a pending hold must not allow a second charge, got %', v_prep;
  end if;

  v_res := public.requeue_billing_subscription_hold_v1(v_hold_a, 'Adopt the paid Stripe subscription', 'owner:phase57');
  if v_res ->> 'outcome' <> 'requeued' or (v_res ->> 'events_marked')::int <> 3 or (v_res ->> 'idempotent')::boolean then
    raise exception 'phase57 I: requeue %', v_res;
  end if;
  v_res := public.requeue_billing_subscription_hold_v1(v_hold_a, 'Adopt the paid Stripe subscription', 'owner:phase57');
  if v_res ->> 'outcome' <> 'requeued' or (v_res ->> 'events_marked')::int <> 0 or not (v_res ->> 'idempotent')::boolean then
    raise exception 'phase57 I: second requeue must be idempotent %', v_res;
  end if;
  if (select retryable from public.billing_webhook_events where provider_event_id = 'evt_phase57_other') then
    raise exception 'phase57 I: unrelated failed events must not be requeued';
  end if;
  v_res := public.claim_billing_webhook_event_v1(
    'stripe', 'evt_phase57_a1', 'customer.subscription.updated', true, null, null
  );
  if v_res ->> 'outcome' <> 'claimed' then
    raise exception 'phase57 I: requeued event must be claimable on resend, got %', v_res;
  end if;

  -- The resend runs the sync again: conversion + reconciliation.
  v_sync := public.sync_billing_subscription_v1(
    v_tenant, v_basic_id, 'stripe', 'cus_phase57', 'sub_phase57_a', 'active',
    now(), now() + interval '30 days', false, '{"stripe_event_id":"evt_phase57_a1"}'::jsonb,
    now(), null, true
  );
  if v_sync ->> 'outcome' = 'held' or v_sync ->> 'status' <> 'active'
     or (v_sync ->> 'reconciled_hold_id')::uuid is distinct from v_hold_a
  then
    raise exception 'phase57 I: ready internal row must be converted and the hold reconciled, got %', v_sync;
  end if;

  select * into v_after from public.subscriptions where id = v_internal;
  if v_after.status <> 'canceled'
     or v_after.metadata ->> 'billing_activation' <> 'converted_to_stripe'
     or v_after.metadata ->> 'converted_to_provider_subscription_id' <> 'sub_phase57_a'
     or (v_after.metadata ->> 'converted_livemode')::boolean is not true
     or v_after.metadata ->> 'internal_closed_at' is null
     or v_after.metadata ->> 'source' <> 'phase57'
  then
    raise exception 'phase57 I: conversion trail wrong: %', v_after.metadata;
  end if;
  select * into v_audit from billing_private.internal_subscription_audit
  where subscription_id = v_internal order by id desc limit 1;
  if v_audit.action is distinct from 'close' or v_audit.via is distinct from 'stripe_conversion'
     or v_audit.authorized_by is distinct from 'owner:phase57'
  then
    raise exception 'phase57 I: conversion not audited: % % %', v_audit.action, v_audit.via, v_audit.authorized_by;
  end if;
  if (select status from billing_private.subscription_holds where id = v_hold_a) <> 'reconciled' then
    raise exception 'phase57 I: hold must be reconciled';
  end if;

  select count(*) into v_count
  from public.subscriptions
  where tenant_id = v_tenant and status in ('trialing', 'active', 'past_due');
  if v_count <> 1
     or not exists (
       select 1 from public.subscriptions
       where provider_subscription_id = 'sub_phase57_a' and status = 'active' and livemode
     )
  then
    raise exception 'phase57 I: Stripe row must be the only current one';
  end if;
  v_prep := public.prepare_billing_checkout_attempt_v2(v_tenant, 'basic', 'month', 'billing', true);
  if v_prep ->> 'outcome' <> 'current_subscription_exists' then
    raise exception 'phase57 I: after conversion Checkout sees the Stripe subscription, got %', v_prep;
  end if;

  -- -------------------------------------------------------------------------
  -- J: list_billing_reconciliation_v1 surfaces what needs an operator.
  -- -------------------------------------------------------------------------
  insert into public.billing_checkout_attempts (
    tenant_id, provider, provider_session_id, status, plan_code, billing_interval,
    expires_at, livemode, created_at, updated_at
  ) values (
    v_tenant_stuck, 'stripe', 'cs_test_phase57_stuck', 'completed', 'basic', 'month',
    now() - interval '1 day', false, now() - interval '2 days', now() - interval '1 hour'
  );

  v_list := public.list_billing_reconciliation_v1();
  if not exists (
    select 1 from jsonb_array_elements(v_list) i
    where i ->> 'kind' = 'subscription_held' and i ->> 'provider_subscription_id' = 'sub_phase57_b'
  ) then
    raise exception 'phase57 J: pending hold missing from the list';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_list) i
    where i ->> 'provider_subscription_id' in ('sub_phase57_a', 'sub_phase57_c', 'sub_phase57_g')
  ) then
    raise exception 'phase57 J: resolved holds must not be listed';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_list) i
    where i ->> 'kind' = 'checkout_completed_unrecorded' and i ->> 'tenant_slug' = 'phase57-stuck'
  ) then
    raise exception 'phase57 J: paid checkout without subscription missing';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_list) i
    where i ->> 'kind' = 'internal_grant_direct' and i ->> 'tenant_slug' = 'phase57-internal'
  ) then
    raise exception 'phase57 J: direct internal grant missing';
  end if;

  -- -------------------------------------------------------------------------
  -- K: grants and private schema.
  -- -------------------------------------------------------------------------
  foreach v_status in array array[
    'public.requeue_billing_subscription_hold_v1(uuid, text, text)',
    'public.resolve_billing_subscription_hold_v1(uuid, text, text)',
    'public.set_internal_billing_activation_v1(uuid, text, text, text)',
    'public.list_billing_reconciliation_v1()',
    'public.prepare_billing_checkout_attempt_v2(uuid, text, text, text, boolean)',
    'public.sync_billing_subscription_v1(uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone, boolean, jsonb, timestamp with time zone, timestamp with time zone, boolean)'
  ] loop
    if has_function_privilege('anon', v_status, 'execute')
       or has_function_privilege('authenticated', v_status, 'execute')
       or not has_function_privilege('service_role', v_status, 'execute')
    then
      raise exception 'phase57 K: % must be service-only', v_status;
    end if;
  end loop;
  if has_table_privilege('service_role', 'billing_private.subscription_holds', 'select') then
    raise exception 'phase57 K: holds must be closed to API roles';
  end if;

  -- -------------------------------------------------------------------------
  -- L: DEMO/SUR4 untouched.
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
