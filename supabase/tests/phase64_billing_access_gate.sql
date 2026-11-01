-- Billing Access Gate V1 · phase64 (local/CI only, rollback-only).
-- States of every commercial lifecycle step, the SUR4 shape (Checkout before
-- the trial end, first invoice later, late webhook), enforcement modes,
-- tenant isolation, grants and reactivation.

begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'phase64: %', label; end if; end $$;

create function pg_temp.st(p_tenant uuid, p_at timestamptz default null) returns text
language sql as $$ select public.resolve_tenant_billing_access_v1(p_tenant, p_at) ->> 'state' $$;

create function pg_temp.allowed(p_tenant uuid, p_at timestamptz default null) returns boolean
language sql as $$ select (public.resolve_tenant_billing_access_v1(p_tenant, p_at) ->> 'allowed')::boolean $$;

-- Each test step starts with an empty per-transaction gate cache.
create function pg_temp.clear_gate_cache(p_tenants uuid[]) returns void language plpgsql as $$
declare v uuid;
begin
  foreach v in array p_tenants loop
    perform set_config('app.billing_gate_' || replace(v::text, '-', ''), '', true);
  end loop;
end $$;

grant execute on function pg_temp.ok(boolean, text) to authenticated, anon, service_role;
grant execute on function pg_temp.clear_gate_cache(uuid[]) to authenticated, anon, service_role;

do $phase64$
declare
  t0 timestamptz := date_trunc('second', now());
  owner_a uuid := 'e6400000-0000-4000-8000-000000000001';
  owner_b uuid := 'e6400000-0000-4000-8000-000000000002';
  outsider uuid := 'e6400000-0000-4000-8000-000000000003';
  t_trial uuid := 'e6400000-0000-4000-8000-000000000011';
  t_open uuid := 'e6400000-0000-4000-8000-000000000012';
  t_active uuid := 'e6400000-0000-4000-8000-000000000013';
  t_cancel uuid := 'e6400000-0000-4000-8000-000000000014';
  t_past_due uuid := 'e6400000-0000-4000-8000-000000000015';
  t_unpaid uuid := 'e6400000-0000-4000-8000-000000000016';
  t_none uuid := 'e6400000-0000-4000-8000-000000000017';
  t_pending uuid := 'e6400000-0000-4000-8000-000000000018';
  t_hold uuid := 'e6400000-0000-4000-8000-000000000019';
  t_sur4 uuid := 'e6400000-0000-4000-8000-00000000001a';
  t_a uuid := 'e6400000-0000-4000-8000-00000000001b';
  t_b uuid := 'e6400000-0000-4000-8000-00000000001c';
  v_basic uuid;
  v_pro uuid;
  v_internal_sur4 uuid := 'e6400000-0000-4000-8000-000000000061';
  v_eval jsonb;
  v_sync jsonb;
  v_n int;
  v_raised boolean;
  v_detail text;
begin
  select id into v_basic from public.plans where code = 'basic';
  select id into v_pro from public.plans where code = 'pro';
  perform pg_temp.ok(v_basic is not null and v_pro is not null, 'basic/pro plans exist');

  -- Default after the migration: nothing enforced.
  perform pg_temp.ok((select mode from billing_private.access_gate_settings) = 'off', 'default mode is off');
  perform pg_temp.ok((select past_due_grace_days from billing_private.access_gate_settings) = 7, 'default grace 7 days');

  insert into auth.users (id, email, raw_user_meta_data) values
    (owner_a, 'owner-a@phase64.test', '{}'), (owner_b, 'owner-b@phase64.test', '{}'),
    (outsider, 'outsider@phase64.test', '{}');
  insert into public.profiles (id, full_name) values
    (owner_a, 'Owner A'), (owner_b, 'Owner B'), (outsider, 'Outsider');

  insert into public.tenants (id, name, slug, active) values
    (t_trial, 'P64 trial', 'p64-trial', true),
    (t_open, 'P64 open internal', 'p64-open', true),
    (t_active, 'P64 active', 'p64-active', true),
    (t_cancel, 'P64 canceling', 'p64-cancel', true),
    (t_past_due, 'P64 past due', 'p64-past-due', true),
    (t_unpaid, 'P64 unpaid', 'p64-unpaid', true),
    (t_none, 'P64 none', 'p64-none', true),
    (t_pending, 'P64 pending', 'p64-pending', true),
    (t_hold, 'P64 hold', 'p64-hold', true),
    (t_sur4, 'P64 SUR4 shape', 'p64-sur4', true),
    (t_a, 'P64 suspended A', 'p64-a', true),
    (t_b, 'P64 active B', 'p64-b', true);

  insert into public.tenant_domains (tenant_id, hostname) values (t_a, 'p64-a.phase64.test');
  insert into public.memberships (tenant_id, user_id, role, active) values
    (t_a, owner_a, 'owner', true), (t_b, owner_a, 'owner', true), (t_b, owner_b, 'owner', true);

  -- -------------------------------------------------------------------------
  -- A. States
  -- -------------------------------------------------------------------------
  insert into public.subscriptions (tenant_id, plan_id, provider, status, current_period_start, current_period_end, metadata) values
    (t_trial, v_basic, 'internal', 'trialing', t0 - interval '37 days', t0, '{}'),
    (t_open, v_basic, 'internal', 'active', t0 - interval '1 day', null, '{}'),
    (t_active, v_basic, 'stripe', 'active', t0 - interval '3 days', t0 + interval '27 days', '{}'),
    (t_past_due, v_basic, 'stripe', 'past_due', t0 - interval '3 days', t0 + interval '27 days', '{}'),
    (t_unpaid, v_basic, 'stripe', 'unpaid', t0 - interval '40 days', t0 - interval '10 days', '{}'),
    (t_pending, v_basic, 'internal', 'trialing', t0 - interval '37 days', t0, '{}'),
    (t_hold, v_basic, 'internal', 'trialing', t0 - interval '37 days', t0 - interval '1 day', '{}'),
    (t_a, v_basic, 'internal', 'trialing', t0 - interval '40 days', t0 - interval '1 day', '{}'),
    (t_b, v_basic, 'stripe', 'active', t0 - interval '3 days', t0 + interval '27 days', '{}');
  insert into public.subscriptions (tenant_id, plan_id, provider, status, current_period_start, current_period_end, cancel_at_period_end, metadata)
  values (t_cancel, v_pro, 'stripe', 'active', t0 - interval '3 days', t0 + interval '27 days', true, '{}');

  -- Trial: valid until the exact end, never extended.
  perform pg_temp.ok(pg_temp.st(t_trial, t0 - interval '1 second') = 'trial_active', 'trial valid before end');
  perform pg_temp.ok(pg_temp.st(t_trial, t0) = 'trial_expired', 'trial expired at its end');
  perform pg_temp.ok(not pg_temp.allowed(t_trial, t0 + interval '30 days'), 'expired trial stays suspended');
  perform pg_temp.ok(pg_temp.st(t_open) = 'internal_active', 'open-ended internal grant allowed');
  -- Stripe: status is authoritative.
  perform pg_temp.ok(pg_temp.st(t_active, t0 + interval '60 days') = 'subscription_active', 'stripe active allowed');
  perform pg_temp.ok(pg_temp.st(t_cancel) = 'subscription_canceling' and pg_temp.allowed(t_cancel), 'cancel at period end keeps service');
  -- past_due grace: 7 days from the start of the unpaid period.
  perform pg_temp.ok(pg_temp.st(t_past_due) = 'past_due_grace', 'past_due within grace');
  perform pg_temp.ok(pg_temp.st(t_past_due, t0 + interval '4 days' + interval '1 second') = 'past_due_suspended', 'past_due after grace');
  v_eval := public.resolve_tenant_billing_access_v1(t_past_due);
  perform pg_temp.ok((v_eval ->> 'grace_until')::timestamptz = t0 + interval '4 days', 'grace_until reported');
  perform pg_temp.ok(pg_temp.st(t_unpaid) = 'subscription_ended', 'unpaid suspended');
  perform pg_temp.ok(pg_temp.st(t_none) = 'no_subscription', 'no subscription suspended');
  perform pg_temp.ok(pg_temp.st(null) = 'unknown_tenant', 'null tenant');

  -- Cancellation reaches its end: Stripe sends deleted → canceled.
  update public.subscriptions set status = 'canceled' where tenant_id = t_cancel;
  perform pg_temp.ok(pg_temp.st(t_cancel) = 'subscription_ended', 'canceled at period end suspends');

  -- Regularised payment: past_due → active reactivates (no manual step).
  update public.subscriptions set status = 'active' where tenant_id = t_past_due;
  perform pg_temp.ok(pg_temp.st(t_past_due, t0 + interval '10 days') = 'subscription_active', 'paid invoice reactivates');
  -- Plan change keeps access (rights come from plan_features).
  update public.subscriptions set plan_id = v_pro where tenant_id = t_past_due;
  perform pg_temp.ok(pg_temp.allowed(t_past_due), 'plan change keeps access');

  -- Checkout pending: started before the trial end, webhook late.
  insert into public.billing_checkout_attempts (tenant_id, provider, provider_session_id, status, plan_code, billing_interval, created_at, expires_at, livemode)
  values (t_pending, 'stripe', 'cs_phase64_pending', 'open', 'pro', 'month', t0 - interval '4 hours', t0 - interval '10 minutes', true);
  perform pg_temp.ok(pg_temp.st(t_pending, t0 + interval '1 hour') = 'checkout_pending', 'checkout pending after trial end');
  perform pg_temp.ok(pg_temp.st(t_pending, t0 + interval '2 hours' - interval '1 second') = 'checkout_pending', 'pending until end + 120 min');
  perform pg_temp.ok(pg_temp.st(t_pending, t0 + interval '2 hours') = 'trial_expired', 'pending window closes');
  update public.billing_checkout_attempts set status = 'expired' where provider_session_id = 'cs_phase64_pending';
  perform pg_temp.ok(pg_temp.st(t_pending, t0 + interval '1 hour') = 'trial_expired', 'expired attempt is not pending');
  -- A Checkout opened after the trial end does not extend it.
  insert into public.billing_checkout_attempts (tenant_id, provider, provider_session_id, status, plan_code, billing_interval, created_at, expires_at, livemode)
  values (t_pending, 'stripe', 'cs_phase64_late', 'open', 'basic', 'month', t0 + interval '5 minutes', t0 + interval '35 minutes', true);
  perform pg_temp.ok(pg_temp.st(t_pending, t0 + interval '10 minutes') = 'trial_expired', 'late checkout grants nothing');
  -- Without any trial (no subscription), a recent Checkout is pending.
  insert into public.billing_checkout_attempts (tenant_id, provider, provider_session_id, status, plan_code, billing_interval, created_at, expires_at, livemode)
  values (t_none, 'stripe', 'cs_phase64_none', 'completed', 'basic', 'month', now() - interval '5 minutes', now() + interval '25 minutes', true);
  perform pg_temp.ok(pg_temp.st(t_none) = 'checkout_pending', 'completed checkout awaiting webhook');
  delete from public.billing_checkout_attempts where provider_session_id = 'cs_phase64_none';

  -- Held Stripe subscription (reconciliation) is never suspended.
  insert into billing_private.subscription_holds (tenant_id, provider_subscription_id, livemode, last_status)
  values (t_hold, 'sub_phase64_hold', true, 'active');
  perform pg_temp.ok(pg_temp.st(t_hold) = 'reconciliation_pending', 'held subscription allowed');
  update billing_private.subscription_holds set status = 'dismissed' where provider_subscription_id = 'sub_phase64_hold';
  perform pg_temp.ok(pg_temp.st(t_hold) = 'trial_expired', 'dismissed hold no longer protects');

  -- Exemptions (operator, audited, optional expiry).
  perform public.set_tenant_billing_access_exemption_v1(t_none, true, null, 'phase64 operator', 'internal demo tenant');
  perform pg_temp.ok(pg_temp.st(t_none) = 'exempt', 'exemption allows');
  perform pg_temp.ok((select jsonb_array_length(history) from billing_private.tenant_access_exemptions where tenant_id = t_none) = 1, 'exemption audited');
  update billing_private.tenant_access_exemptions set expires_at = now() - interval '1 second' where tenant_id = t_none;
  perform pg_temp.ok(pg_temp.st(t_none) = 'no_subscription', 'expired exemption ignored');
  perform pg_temp.ok(public.set_tenant_billing_access_exemption_v1(t_none, false, null, 'phase64 operator', 'remove') ->> 'outcome' = 'removed', 'exemption removed');
  begin
    perform public.set_tenant_billing_access_exemption_v1(t_none, true, null, '', 'x');
    raise exception 'phase64: exemption without authorizer accepted';
  exception when sqlstate '22023' then null;
  end;

  -- -------------------------------------------------------------------------
  -- B. SUR4 shape: Checkout before the trial end, anchored first invoice.
  --    The conversion keeps access before and after the old trial end.
  -- -------------------------------------------------------------------------
  insert into public.subscriptions (id, tenant_id, plan_id, provider, status, current_period_start, current_period_end, metadata)
  values (v_internal_sur4, t_sur4, v_basic, 'internal', 'trialing', now() - interval '37 days', now() + interval '3 hours',
          '{"billing_activation":"ready_for_checkout"}');
  v_sync := public.sync_billing_subscription_v1(
    t_sur4, v_pro, 'stripe', 'cus_phase64_sur4', 'sub_phase64_sur4', 'active',
    now(), now() + interval '3 hours', false,
    jsonb_build_object('plan_code', 'pro', 'stripe_event_id', 'evt_phase64_sur4'),
    now() - interval '1 minute', null, true);
  perform pg_temp.ok((select status from public.subscriptions where id = v_internal_sur4) = 'canceled', 'internal converted: ' || v_sync::text);
  perform pg_temp.ok(pg_temp.st(t_sur4, now() + interval '1 day') = 'subscription_active', 'anchored Stripe sub allowed after old trial end');

  -- -------------------------------------------------------------------------
  -- C. Enforcement (trigger) by mode, isolation, bypasses
  -- -------------------------------------------------------------------------
  perform pg_temp.ok((select count(*) from pg_trigger where tgname = 'trg_billing_access_gate' and not tgisinternal) = 35, 'trigger on 35 tables');

  -- off: suspended tenant A still writes.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  execute 'set local role authenticated';
  insert into public.clients (tenant_id, name) values (t_a, 'Cliente modo off');
  execute 'reset role';

  perform public.set_billing_access_gate_settings_v1('observe', null, null, 'phase64 operator', 'observe test');
  perform pg_temp.clear_gate_cache(array[t_a, t_b]);
  execute 'set local role authenticated';
  insert into public.clients (tenant_id, name) values (t_a, 'Cliente modo observe');
  execute 'reset role';

  perform public.set_billing_access_gate_settings_v1('enforce', null, null, 'phase64 operator', 'enforce test');
  perform pg_temp.ok((select jsonb_array_length(history) from billing_private.access_gate_settings) = 2, 'settings changes audited');
  perform pg_temp.clear_gate_cache(array[t_a, t_b]);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    insert into public.clients (tenant_id, name) values (t_a, 'Cliente bloqueado');
  exception when sqlstate 'PT402' then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_raised := true;
  end;
  perform pg_temp.ok(v_raised and v_detail = 'trial_expired', 'enforce blocks insert (PT402, trial_expired)');

  v_raised := false;
  begin
    update public.clients set name = 'Renombrado' where tenant_id = t_a;
  exception when sqlstate 'PT402' then v_raised := true;
  end;
  perform pg_temp.ok(v_raised, 'enforce blocks update');

  v_raised := false;
  begin
    delete from public.tenant_domains where tenant_id = t_a;
  exception when sqlstate 'PT402' then v_raised := true;
  end;
  perform pg_temp.ok(v_raised, 'enforce blocks delete');

  -- Reads and data stay intact.
  perform pg_temp.ok((select count(*) from public.clients where tenant_id = t_a) = 2, 'suspended tenant keeps and reads its data');
  -- Same user, another (paid) tenant: unaffected.
  insert into public.clients (tenant_id, name) values (t_b, 'Cliente tenant B');
  perform pg_temp.ok((select count(*) from public.clients where tenant_id = t_b) = 1, 'other tenant unaffected');

  -- Member read of the gate (proxy).
  v_eval := public.current_tenant_billing_access_v1('p64-a');
  perform pg_temp.ok(v_eval ->> 'state' = 'trial_expired' and (v_eval ->> 'allowed')::boolean = false
                     and (v_eval ->> 'enforced')::boolean and v_eval ->> 'role' = 'owner', 'member reads gate state');
  perform pg_temp.ok(not (v_eval ? 'subscription_id'), 'member read exposes no subscription ids');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.ok(public.current_tenant_billing_access_v1('p64-a') is null, 'non-member gets null');
  execute 'reset role';

  -- anon (kiosk path) is blocked too.
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.ok(public.current_tenant_billing_access_v1('p64-a') is null, 'anon gets null');

  -- service_role (webhook, billing, support) and no-JWT sessions pass.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.stores (tenant_id, name) values (t_a, 'Tienda alta por soporte');
  perform set_config('request.jwt.claim.role', '', true);
  update public.stores set code = 'MIG' where tenant_id = t_a;
  perform pg_temp.ok((select code from public.stores where tenant_id = t_a) = 'MIG', 'service_role and no-JWT pass');

  -- Grants: users cannot evaluate other tenants or change the gate.
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.resolve_tenant_billing_access_v1(uuid, timestamptz)', 'execute'), 'resolve is service-only');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.set_billing_access_gate_settings_v1(text, integer, integer, text, text)', 'execute'), 'settings service-only');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.set_tenant_billing_access_exemption_v1(uuid, boolean, timestamptz, text, text)', 'execute'), 'exemptions service-only');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.current_tenant_billing_access_v1(text)', 'execute'), 'anon cannot read gate');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'billing_private.access_gate_settings', 'select'), 'settings table private');

  -- Reactivation: payment confirmed → next transaction writes again.
  update public.subscriptions set provider = 'stripe', status = 'active', provider_subscription_id = 'sub_phase64_a',
         current_period_end = now() + interval '30 days'
  where tenant_id = t_a;
  perform pg_temp.clear_gate_cache(array[t_a]);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  execute 'set local role authenticated';
  insert into public.clients (tenant_id, name) values (t_a, 'Cliente tras regularizar');
  execute 'reset role';

  select count(*) into v_n from public.clients where tenant_id = t_a;
  perform pg_temp.ok(v_n = 3, 'reactivated tenant writes; nothing lost');

  raise notice 'phase64 billing access gate PASS';
end;
$phase64$;

rollback;
