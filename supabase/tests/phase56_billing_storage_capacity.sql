-- Billing storage capacity explicit · phase56 (S2)
-- Capacity is never NULL: current plan, else last contracted, else 0.
-- Internal subscriptions are granted through an authorized, audited RPC.

begin;

do $phase56$
declare
  v_none uuid := 'e5600000-0000-4000-8000-000000000011';
  v_basic_cur uuid := 'e5600000-0000-4000-8000-000000000012';
  v_cancelled uuid := 'e5600000-0000-4000-8000-000000000013';
  v_mvp_only uuid := 'e5600000-0000-4000-8000-000000000014';
  v_mvp_after uuid := 'e5600000-0000-4000-8000-000000000015';
  v_zero uuid := 'e5600000-0000-4000-8000-000000000016';
  v_grant uuid := 'e5600000-0000-4000-8000-000000000017';
  v_attempt_t uuid := 'e5600000-0000-4000-8000-000000000018';
  v_api uuid := 'e5600000-0000-4000-8000-000000000019';
  v_basic_id uuid;
  v_mvp_id uuid;
  v_zero_plan uuid := 'e5600000-0000-4000-8000-000000000091';
  v_nocap_plan uuid := 'e5600000-0000-4000-8000-000000000092';
  v_feature uuid;
  v_basic_bytes bigint;
  v_cap jsonb;
  v_res jsonb;
  v_status text;
  v_count int;
  v_sub uuid;
  v_key bigint;
  v_has boolean;
  v_message text;
  v_audit record;
  v_demo_cap jsonb;
  v_sur4_cap jsonb;
begin
  select id into v_basic_id from public.plans where code = 'basic';
  select id into v_mvp_id from public.plans where code = 'mvp';
  select id into v_feature from public.features where code = 'storage_bytes';
  select pf.limit_value into v_basic_bytes
  from public.plan_features pf where pf.plan_id = v_basic_id and pf.feature_id = v_feature;
  if v_basic_id is null or v_mvp_id is null or v_basic_bytes is null then
    raise exception 'phase56: basic/mvp catalog missing';
  end if;

  select public.resolve_tenant_storage_capacity_v1(t.id) into v_demo_cap from public.tenants t where t.slug = 'demo';
  select public.resolve_tenant_storage_capacity_v1(t.id) into v_sur4_cap from public.tenants t where t.slug = 'sur4';

  insert into public.tenants (id, name, slug, active) values
    (v_none, 'P56 none', 'p56-none', true),
    (v_basic_cur, 'P56 basic', 'p56-basic', true),
    (v_cancelled, 'P56 cancelled', 'p56-cancelled', true),
    (v_mvp_only, 'P56 mvp', 'p56-mvp', true),
    (v_mvp_after, 'P56 mvp after basic', 'p56-mvp-after', true),
    (v_zero, 'P56 zero plan', 'p56-zero', true),
    (v_grant, 'P56 grant', 'p56-grant', true),
    (v_attempt_t, 'P56 attempt', 'p56-attempt', true),
    (v_api, 'P56 api', 'p56-api', true);

  -- -------------------------------------------------------------------------
  -- A: capacity matrix (never NULL)
  -- -------------------------------------------------------------------------
  v_cap := public.resolve_tenant_storage_capacity_v1(v_none);
  if (v_cap ->> 'limit_bytes')::bigint <> 0 or v_cap ->> 'source' <> 'no_subscription' then
    raise exception 'phase56 A none: %', v_cap;
  end if;

  insert into public.subscriptions (tenant_id, plan_id, provider, status)
  values (v_basic_cur, v_basic_id, 'internal', 'trialing');
  v_cap := public.resolve_tenant_storage_capacity_v1(v_basic_cur);
  if (v_cap ->> 'limit_bytes')::bigint <> v_basic_bytes or v_cap ->> 'source' <> 'current_plan' then
    raise exception 'phase56 A basic current: %', v_cap;
  end if;

  -- Cancellation keeps the last contracted capacity, in every ended status.
  insert into public.subscriptions (tenant_id, plan_id, provider, provider_subscription_id, status)
  values (v_cancelled, v_basic_id, 'stripe', 'sub_p56_cancelled', 'active')
  returning id into v_sub;
  foreach v_status in array array['canceled', 'unpaid', 'paused', 'incomplete'] loop
    update public.subscriptions set status = v_status where id = v_sub;
    v_cap := public.resolve_tenant_storage_capacity_v1(v_cancelled);
    if (v_cap ->> 'limit_bytes')::bigint <> v_basic_bytes
       or v_cap ->> 'source' <> 'last_contracted'
       or (v_cap ->> 'subscription_id')::uuid <> v_sub
    then
      raise exception 'phase56 A % keeps last contracted: %', v_status, v_cap;
    end if;
  end loop;
  update public.subscriptions set status = 'past_due' where id = v_sub;
  if public.resolve_tenant_storage_capacity_v1(v_cancelled) ->> 'source' <> 'current_plan' then
    raise exception 'phase56 A past_due is current';
  end if;

  -- The internal mvp plan (demo) keeps its rights with an explicit capacity.
  insert into public.subscriptions (tenant_id, plan_id, provider, status)
  values (v_mvp_only, v_mvp_id, 'internal', 'active');
  v_cap := public.resolve_tenant_storage_capacity_v1(v_mvp_only);
  if (v_cap ->> 'limit_bytes')::bigint <> v_basic_bytes or v_cap ->> 'source' <> 'current_plan' then
    raise exception 'phase56 A mvp explicit capacity: %', v_cap;
  end if;

  -- A plan without storage_bytes is an absence: 0, not unlimited.
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (v_nocap_plan, 'p56_nocap', 'P56 no capacity', true, 99, 0, 0);
  insert into public.subscriptions (tenant_id, plan_id, provider, status)
  values (v_mvp_after, v_nocap_plan, 'internal', 'active');
  v_cap := public.resolve_tenant_storage_capacity_v1(v_mvp_after);
  if (v_cap ->> 'limit_bytes')::bigint <> 0 or v_cap ->> 'source' <> 'no_contracted_capacity' then
    raise exception 'phase56 A plan without capacity: %', v_cap;
  end if;

  -- The same plan current after a canceled Basic keeps Basic's capacity.
  insert into public.subscriptions (tenant_id, plan_id, provider, status, created_at)
  values (v_mvp_after, v_basic_id, 'internal', 'canceled', now() - interval '10 days');
  v_cap := public.resolve_tenant_storage_capacity_v1(v_mvp_after);
  if (v_cap ->> 'limit_bytes')::bigint <> v_basic_bytes or v_cap ->> 'source' <> 'last_contracted' then
    raise exception 'phase56 A no-capacity plan after basic: %', v_cap;
  end if;

  -- An explicit 0 capacity is honoured.
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (v_zero_plan, 'p56_zero', 'P56 zero', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
  values (v_zero_plan, v_feature, true, 0);
  insert into public.subscriptions (tenant_id, plan_id, provider, status)
  values (v_zero, v_zero_plan, 'internal', 'active');
  if public.resolve_tenant_storage_capacity_v1(v_zero) <> jsonb_build_object(
       'limit_bytes', 0, 'source', 'current_plan',
       'subscription_id', (select id from public.subscriptions where tenant_id = v_zero))
  then
    raise exception 'phase56 A explicit zero';
  end if;

  -- The bigint wrapper never returns NULL and matches the resolver everywhere.
  select count(*) into v_count
  from public.tenants t
  where public.resolve_tenant_storage_limit_bytes(t.id) is null
     or public.resolve_tenant_storage_limit_bytes(t.id)
        is distinct from (public.resolve_tenant_storage_capacity_v1(t.id) ->> 'limit_bytes')::bigint;
  if v_count <> 0 then
    raise exception 'phase56 A: % tenants with NULL or inconsistent capacity', v_count;
  end if;
  if public.resolve_tenant_storage_limit_bytes(null) is distinct from 0 then
    raise exception 'phase56 A: NULL tenant must resolve to 0';
  end if;

  -- -------------------------------------------------------------------------
  -- B: grant_internal_subscription_v1 · authorization, validation, lock
  -- -------------------------------------------------------------------------
  v_res := public.grant_internal_subscription_v1(v_grant, 'basic', 'active', null, 'short', 'owner');
  if v_res ->> 'reason' <> 'reason_required' then raise exception 'phase56 B reason: %', v_res; end if;
  v_res := public.grant_internal_subscription_v1(v_grant, 'basic', 'active', null, 'Pilot capacity for p56', '  ');
  if v_res ->> 'reason' <> 'authorization_required' then raise exception 'phase56 B authorizer: %', v_res; end if;
  v_res := public.grant_internal_subscription_v1(v_grant, 'basic', 'past_due', null, 'Pilot capacity for p56', 'owner');
  if v_res ->> 'reason' <> 'invalid_input' then raise exception 'phase56 B status: %', v_res; end if;
  v_res := public.grant_internal_subscription_v1(v_grant, 'nope', 'active', null, 'Pilot capacity for p56', 'owner');
  if v_res ->> 'reason' <> 'plan_not_found' then raise exception 'phase56 B plan: %', v_res; end if;
  v_res := public.grant_internal_subscription_v1(v_grant, 'basic', 'active', now() - interval '1 day', 'Pilot capacity for p56', 'owner');
  if v_res ->> 'reason' <> 'period_end_in_past' then raise exception 'phase56 B period: %', v_res; end if;
  v_res := public.grant_internal_subscription_v1('e5600000-0000-4000-8000-0000000000ff', 'basic', 'active', null, 'Pilot capacity for p56', 'owner');
  if v_res ->> 'reason' <> 'tenant_not_found' then raise exception 'phase56 B tenant: %', v_res; end if;
  if exists (select 1 from public.subscriptions where tenant_id = v_grant) then
    raise exception 'phase56 B: rejected grants must not write';
  end if;

  v_res := public.grant_internal_subscription_v1(
    v_grant, 'basic', 'trialing', now() + interval '30 days',
    'Pilot capacity for p56 (test)', 'owner:phase56', '{"billing_activation":"internal_pilot"}'::jsonb
  );
  if v_res ->> 'outcome' <> 'granted'
     or (v_res -> 'capacity' ->> 'limit_bytes')::bigint <> v_basic_bytes
  then
    raise exception 'phase56 B grant: %', v_res;
  end if;
  v_sub := (v_res ->> 'subscription_id')::uuid;
  if not exists (
    select 1 from public.subscriptions s
    where s.id = v_sub and s.provider = 'internal' and s.status = 'trialing' and not s.livemode
      and s.metadata ->> 'billing_activation' = 'internal_pilot'
      and s.metadata ->> 'grant_reason' = 'Pilot capacity for p56 (test)'
      and s.metadata ->> 'granted_by' = 'owner:phase56'
  ) then
    raise exception 'phase56 B: granted row wrong';
  end if;

  v_key := pg_catalog.hashtextextended(v_grant::text, 31);
  select exists (
    select 1 from pg_catalog.pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid() and l.objsubid = 1
      and l.classid::text = ((v_key >> 32) & 4294967295)::text
      and l.objid::text = (v_key & 4294967295)::text
  ) into v_has;
  if not v_has then
    raise exception 'phase56 B: grant must take the tenant billing lock (key 31)';
  end if;

  v_res := public.grant_internal_subscription_v1(v_grant, 'basic', 'active', null, 'Second grant must fail', 'owner');
  if v_res ->> 'reason' <> 'current_subscription_exists' then
    raise exception 'phase56 B: second grant: %', v_res;
  end if;

  -- A Checkout that can still be paid blocks the grant; an expired one does not.
  v_res := public.prepare_billing_checkout_attempt_v2(v_attempt_t, 'basic', 'month', 'billing', false);
  v_res := public.grant_internal_subscription_v1(v_attempt_t, 'basic', 'active', null, 'Grant during checkout', 'owner');
  if v_res ->> 'reason' <> 'checkout_in_progress' then
    raise exception 'phase56 B: open checkout must block the grant: %', v_res;
  end if;
  update public.billing_checkout_attempts
  set expires_at = now() - interval '1 hour'
  where tenant_id = v_attempt_t;
  v_res := public.grant_internal_subscription_v1(v_attempt_t, 'basic', 'active', null, 'Grant after expiry', 'owner');
  if v_res ->> 'outcome' <> 'granted' then
    raise exception 'phase56 B: expired checkout must not block: %', v_res;
  end if;

  -- -------------------------------------------------------------------------
  -- C: audit of every non-Stripe change; API roles must use the RPC
  -- -------------------------------------------------------------------------
  select * into v_audit
  from billing_private.internal_subscription_audit a
  where a.subscription_id = v_sub
  order by a.id desc limit 1;
  if v_audit.action is distinct from 'grant' or v_audit.via is distinct from 'grant_rpc'
     or v_audit.reason is distinct from 'Pilot capacity for p56 (test)' or v_audit.authorized_by is distinct from 'owner:phase56'
  then
    raise exception 'phase56 C: grant audit wrong: % % % %', v_audit.action, v_audit.via, v_audit.reason, v_audit.authorized_by;
  end if;

  -- Direct SQL (postgres) is allowed but audited as direct, without authorization.
  select * into v_audit
  from billing_private.internal_subscription_audit a
  where a.tenant_id = v_mvp_only
  order by a.id desc limit 1;
  if v_audit.action is distinct from 'grant' or v_audit.via is distinct from 'direct' or v_audit.authorized_by is not null
     or coalesce(v_audit.actor_role, '') not like 'sql:%'
  then
    raise exception 'phase56 C: direct grant audit wrong: % % %', v_audit.action, v_audit.via, v_audit.actor_role;
  end if;

  -- Period extension on a current internal row (SUR4 B'') is audited as update.
  update public.subscriptions set current_period_end = now() + interval '60 days' where id = v_sub;
  select * into v_audit
  from billing_private.internal_subscription_audit a
  where a.subscription_id = v_sub order by a.id desc limit 1;
  if v_audit.action is distinct from 'update' or v_audit.old_row ->> 'current_period_end' is not distinct from v_audit.new_row ->> 'current_period_end' then
    raise exception 'phase56 C: update audit wrong';
  end if;

  update public.subscriptions set status = 'canceled' where id = v_sub;
  select * into v_audit
  from billing_private.internal_subscription_audit a
  where a.subscription_id = v_sub order by a.id desc limit 1;
  if v_audit.action is distinct from 'close' then
    raise exception 'phase56 C: close audit wrong: %', v_audit.action;
  end if;

  -- Stripe rows are not audited here (they have the webhook trail).
  select count(*) into v_count
  from billing_private.internal_subscription_audit a where a.tenant_id = v_cancelled;
  if v_count <> 0 then
    raise exception 'phase56 C: Stripe rows must not be audited, got %', v_count;
  end if;

  -- service_role (PostgREST) cannot grant nor reactivate directly.
  set local role service_role;
  begin
    insert into public.subscriptions (tenant_id, plan_id, provider, status)
    values (v_api, v_basic_id, 'internal', 'active');
    raise exception 'phase56 C: service_role direct grant allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%requires grant_internal_subscription_v1%' then raise; end if;
  end;
  begin
    insert into public.subscriptions (tenant_id, plan_id, provider, status)
    values (v_api, v_basic_id, null, 'trialing');
    raise exception 'phase56 C: service_role NULL-provider grant allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%requires grant_internal_subscription_v1%' then raise; end if;
  end;
  begin
    update public.subscriptions set status = 'active' where id = v_sub;
    raise exception 'phase56 C: service_role reactivation allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%requires grant_internal_subscription_v1%' then raise; end if;
  end;
  -- Non-granting updates (e.g. metadata) stay possible and audited.
  update public.subscriptions set metadata = metadata || '{"note":"p56"}'::jsonb where id = v_sub;
  -- The RPC is the way for API roles.
  v_res := public.grant_internal_subscription_v1(v_api, 'basic', 'active', null, 'API grant through the RPC', 'owner:phase56');
  if v_res ->> 'outcome' <> 'granted' then
    raise exception 'phase56 C: service_role RPC grant: %', v_res;
  end if;
  -- The audit is closed to API roles.
  begin
    perform 1 from billing_private.internal_subscription_audit limit 1;
    raise exception 'phase56 C: service_role can read billing_private';
  exception when insufficient_privilege then null;
  end;
  reset role;

  if (select count(*) from billing_private.internal_subscription_audit a
      where a.subscription_id = v_sub and a.action = 'update' and a.actor_role = 'service_role') <> 1
  then
    raise exception 'phase56 C: service_role metadata update not audited';
  end if;
  if public.list_internal_subscription_audit_v1(v_api, 10) -> 0 ->> 'via' <> 'grant_rpc' then
    raise exception 'phase56 C: list audit wrong';
  end if;

  -- -------------------------------------------------------------------------
  -- D: grants and DEMO/SUR4
  -- -------------------------------------------------------------------------
  foreach v_status in array array[
    'public.grant_internal_subscription_v1(uuid, text, text, timestamp with time zone, text, text, jsonb)',
    'public.resolve_tenant_storage_capacity_v1(uuid)',
    'public.resolve_tenant_storage_limit_bytes(uuid)',
    'public.list_internal_subscription_audit_v1(uuid, integer)'
  ] loop
    if has_function_privilege('anon', v_status, 'execute')
       or has_function_privilege('authenticated', v_status, 'execute')
       or not has_function_privilege('service_role', v_status, 'execute')
    then
      raise exception 'phase56 D: % must be service-only', v_status;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.tg_subscriptions_internal_audit()', 'execute') then
    raise exception 'phase56 D: trigger function executable by authenticated';
  end if;

  if (select public.resolve_tenant_storage_capacity_v1(t.id) from public.tenants t where t.slug = 'demo') is distinct from v_demo_cap
     or (select public.resolve_tenant_storage_capacity_v1(t.id) from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_cap
  then
    raise exception 'phase56: DEMO/SUR4 capacity changed by the suite';
  end if;

  raise notice 'phase56_billing_storage_capacity_ok';
end;
$phase56$;

rollback;
