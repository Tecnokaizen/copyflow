-- phase53: Gestcopy AI · Pedidos por voz V1 (#90) budget ledger.
-- Catalog code ai_voice_orders, grants, roles, tenant isolation, kill switch,
-- default and specific tenant/user budgets, rate limit, expiry, idempotency
-- and the operator function. Synthetic fixtures only; everything is rolled
-- back. Run on a freshly migrated database (asserts the seeded limits).
\set ON_ERROR_STOP on
begin;

-- Reserve as an authenticated member, the way the app session does.
-- Returns the event id, or ERR:<sqlstate>:<message>[:<hint>].
create function pg_temp.phase53_reserve(
  p_user uuid,
  p_tenant uuid,
  p_request uuid,
  p_micros bigint,
  p_operation text default 'transcription',
  p_feature text default 'ai_voice_orders'
)
  returns text
  language plpgsql
as $helper$
declare
  v_result text;
  v_hint text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    execute 'set local role authenticated';
    v_result := public.ai_reserve_usage(
      p_tenant, p_feature, p_operation, p_request, p_micros, 'fake', 'fake-model', 'phase53'
    )::text;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_result := 'ERR:' || sqlstate || ':' || sqlerrm || coalesce(':' || nullif(v_hint, ''), '');
  end;
  execute 'reset role';
  return v_result;
end;
$helper$;

create function pg_temp.phase53_settle(
  p_user uuid,
  p_event uuid,
  p_status text,
  p_micros bigint
)
  returns text
  language plpgsql
as $helper$
declare
  v_result text := 'ok';
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    execute 'set local role authenticated';
    perform public.ai_settle_usage(p_event, p_status, p_micros, null, null, null, null);
  exception when others then
    v_result := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return v_result;
end;
$helper$;

create function pg_temp.phase53_status(p_user uuid, p_tenant uuid)
  returns jsonb
  language plpgsql
as $helper$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    execute 'set local role authenticated';
    v_result := public.ai_voice_status(p_tenant);
  exception when others then
    v_result := jsonb_build_object('error', sqlstate);
  end;
  execute 'reset role';
  return v_result;
end;
$helper$;

-- Operator context: database owner without JWT claims.
create function pg_temp.phase53_operator()
  returns void
  language plpgsql
as $helper$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end;
$helper$;

-- Operator call as another role; returns 'ok' or ERR:<sqlstate>.
create function pg_temp.phase53_set_limit_as(
  p_role text,
  p_scope text,
  p_slug text,
  p_user uuid,
  p_enabled boolean,
  p_budget bigint
)
  returns text
  language plpgsql
as $helper$
declare
  v_result text := 'ok';
begin
  perform set_config('request.jwt.claim.role', p_role, true);
  begin
    execute format('set local role %I', p_role);
    perform public.ai_set_voice_usage_limit(p_scope, p_slug, p_user, p_enabled, p_budget, null, null, null);
  exception when others then
    v_result := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', true);
  return v_result;
end;
$helper$;

do $phase53$
declare
  tenant_a uuid := 'e5300000-0000-4000-8000-000000000011';
  tenant_b uuid := 'e5300000-0000-4000-8000-000000000012';
  owner_a uuid := 'e5300000-0000-4000-8000-000000000001';
  staff_a uuid := 'e5300000-0000-4000-8000-000000000002';
  manager_a uuid := 'e5300000-0000-4000-8000-000000000003';
  viewer_a uuid := 'e5300000-0000-4000-8000-000000000004';
  owner_b uuid := 'e5300000-0000-4000-8000-000000000005';
  outsider uuid := 'e5300000-0000-4000-8000-000000000006';
  feature uuid;
  result text;
  event_a uuid;
  event_again uuid;
  voice_status jsonb;
  row_count integer;
  fn text;
begin
  -- 1. Catalog: one code (#105's ai_voice_orders), no legacy voice_orders,
  --    no plan inherits it and no tenant has it on a fresh database.
  select id into feature from public.features where code = 'ai_voice_orders';
  if feature is null then
    raise exception 'phase53: ai_voice_orders missing from catalog';
  end if;
  if exists (select 1 from public.features where code = 'voice_orders') then
    raise exception 'phase53: legacy voice_orders code must not exist';
  end if;
  if exists (select 1 from public.plan_features where feature_id = feature) then
    raise exception 'phase53: ai_voice_orders must not be on plan_features';
  end if;
  if exists (select 1 from public.tenant_feature_overrides where feature_id = feature) then
    raise exception 'phase53: a tenant has ai_voice_orders before any operator grant';
  end if;

  -- 2. Seeded limits: kill switch off and pilot defaults, nothing else.
  if (select count(*) from public.ai_usage_limits) <> 3
     or not exists (
       select 1 from public.ai_usage_limits
       where scope = 'platform' and feature_code = 'ai_voice_orders'
         and enabled is false and monthly_budget_micros = 10000000
         and daily_request_limit = 60 and max_clip_seconds = 60
         and max_audio_bytes = 3000000)
     or not exists (
       select 1 from public.ai_usage_limits
       where scope = 'tenant_default' and enabled
         and monthly_budget_micros = 2000000 and daily_request_limit is null)
     or not exists (
       select 1 from public.ai_usage_limits
       where scope = 'user_default' and enabled
         and monthly_budget_micros = 1000000 and daily_request_limit is null)
     or exists (select 1 from public.ai_usage_events)
  then
    raise exception 'phase53: unexpected seeded limits or ledger rows';
  end if;

  -- 3. Grants: tables closed; helpers and the operator function closed to API
  --    roles; anon cannot call anything; authenticated only the three RPCs.
  if has_table_privilege('authenticated', 'public.ai_usage_limits', 'SELECT')
     or has_table_privilege('authenticated', 'public.ai_usage_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.ai_usage_events', 'INSERT')
     or has_table_privilege('anon', 'public.ai_usage_limits', 'SELECT')
     or has_table_privilege('anon', 'public.ai_usage_events', 'SELECT')
  then
    raise exception 'phase53: AI ledger tables must not be readable by API roles';
  end if;
  foreach fn in array array[
    'public.ai_expire_stale_reservations(uuid,uuid,text)',
    'public.ai_resolve_limits(uuid,uuid,text)',
    'public.ai_usage_charged_micros(text,uuid,uuid,text,date)',
    'public.ai_set_voice_usage_limit(text,text,uuid,boolean,bigint,integer,integer,integer)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'phase53: % must not be executable by anon/authenticated', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.ai_reserve_usage(uuid,text,text,uuid,bigint,text,text,text)',
    'public.ai_settle_usage(uuid,text,bigint,numeric,integer,integer,text)',
    'public.ai_voice_status(uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE')
       or not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'phase53: % must be authenticated-only', fn;
    end if;
  end loop;
  if not has_function_privilege('service_role',
       'public.ai_set_voice_usage_limit(text,text,uuid,boolean,bigint,integer,integer,integer)', 'EXECUTE') then
    raise exception 'phase53: service_role must keep the operator function';
  end if;

  -- 4. Fixtures.
  insert into auth.users (id, email, raw_user_meta_data) values
    (owner_a, 'owner-a@phase53.test', '{}'::jsonb),
    (staff_a, 'staff-a@phase53.test', '{}'::jsonb),
    (manager_a, 'manager-a@phase53.test', '{}'::jsonb),
    (viewer_a, 'viewer-a@phase53.test', '{}'::jsonb),
    (owner_b, 'owner-b@phase53.test', '{}'::jsonb),
    (outsider, 'outsider@phase53.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values
    (owner_a, 'Owner A'), (staff_a, 'Staff A'), (manager_a, 'Manager A'),
    (viewer_a, 'Viewer A'), (owner_b, 'Owner B'), (outsider, 'Outsider');
  insert into public.tenants (id, name, slug, active) values
    (tenant_a, 'Phase53 A', 'phase53a', true),
    (tenant_b, 'Phase53 B', 'phase53b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (tenant_a, owner_a, 'owner', true),
    (tenant_a, staff_a, 'staff', true),
    (tenant_a, manager_a, 'manager', true),
    (tenant_a, viewer_a, 'viewer', true),
    (tenant_b, owner_b, 'owner', true);

  -- 5. Feature off: no reservation even with the platform switched on.
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('platform', null, null, true, 10000000, 60, 60, 3000000);
  result := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000a1', 1000);
  if result not like 'ERR:42501:feature disabled%' then
    raise exception 'phase53: feature off must deny, got %', result;
  end if;

  -- 6. Kill switch: feature on, platform off → ai_budget_exhausted (platform_disabled).
  perform pg_temp.phase53_operator();
  perform public.set_tenant_feature('phase53a', 'ai_voice_orders', true, null);
  perform public.ai_set_voice_usage_limit('platform', null, null, false, 10000000, 60, 60, 3000000);
  result := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000a2', 1000);
  if result not like 'ERR:P0001:ai_budget_exhausted:platform_disabled' then
    raise exception 'phase53: kill switch must block, got %', result;
  end if;
  voice_status := pg_temp.phase53_status(owner_a, tenant_a);
  if (voice_status->>'feature_enabled')::boolean is not true
     or (voice_status->>'budget_enabled')::boolean is not false
     or voice_status->>'reason' is distinct from 'platform_disabled' then
    raise exception 'phase53: status must report the kill switch, got %', voice_status;
  end if;

  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('platform', null, null, true, 10000000, 60, 60, 3000000);

  -- 7. Roles and isolation: viewer, outsider and cross-tenant callers are denied;
  --    another feature code cannot borrow the ledger.
  result := pg_temp.phase53_reserve(viewer_a, tenant_a, 'e5300000-0000-4000-8000-0000000000a3', 1000);
  if result not like 'ERR:42501:%' then
    raise exception 'phase53: viewer reserve expected 42501, got %', result;
  end if;
  result := pg_temp.phase53_reserve(outsider, tenant_a, 'e5300000-0000-4000-8000-0000000000a4', 1000);
  if result not like 'ERR:42501:%' then
    raise exception 'phase53: outsider reserve expected 42501, got %', result;
  end if;
  result := pg_temp.phase53_reserve(owner_a, tenant_b, 'e5300000-0000-4000-8000-0000000000a5', 1000);
  if result not like 'ERR:42501:%' then
    raise exception 'phase53: cross-tenant reserve expected 42501, got %', result;
  end if;
  result := pg_temp.phase53_reserve(owner_b, tenant_b, 'e5300000-0000-4000-8000-0000000000a6', 1000);
  if result not like 'ERR:42501:feature disabled%' then
    raise exception 'phase53: tenant B has no feature, got %', result;
  end if;
  perform pg_temp.phase53_operator();
  perform public.set_tenant_feature('phase53a', 'quotes', true, null);
  foreach fn in array array['quotes', 'pro_early_access', 'voice_orders'] loop
    result := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000a7', 1000, 'transcription', fn);
    if result not like 'ERR:22023:invalid feature%' then
      raise exception 'phase53: feature % must not use the ledger, got %', fn, result;
    end if;
  end loop;
  voice_status := pg_temp.phase53_status(outsider, tenant_a);
  if voice_status->>'error' is distinct from '42501' then
    raise exception 'phase53: outsider status expected 42501, got %', voice_status;
  end if;

  -- 8. Reserve, idempotency by request id, and no reuse across members.
  result := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000b1', 400000);
  if result like 'ERR:%' then
    raise exception 'phase53: owner reserve failed: %', result;
  end if;
  event_a := result::uuid;
  event_again := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000b1', 400000)::uuid;
  if event_again is distinct from event_a then
    raise exception 'phase53: reserve must be idempotent by request id';
  end if;
  result := pg_temp.phase53_reserve(staff_a, tenant_a, 'e5300000-0000-4000-8000-0000000000b1', 400000);
  if result not like 'ERR:23505:%' then
    raise exception 'phase53: another member must not get the same reservation, got %', result;
  end if;

  -- 9. Settle: only its owner, committed once, idempotent afterwards.
  result := pg_temp.phase53_settle(staff_a, event_a, 'committed', 1);
  if result not like 'ERR:42501:%' then
    raise exception 'phase53: settle by another member expected 42501, got %', result;
  end if;
  if pg_temp.phase53_settle(owner_a, event_a, 'committed', 300000) <> 'ok'
     or pg_temp.phase53_settle(owner_a, event_a, 'released', 0) <> 'ok' then
    raise exception 'phase53: owner settle failed';
  end if;
  perform pg_temp.phase53_operator();
  if not exists (
    select 1 from public.ai_usage_events
    where id = event_a and status = 'committed' and actual_micros = 300000
      and user_id = owner_a and feature_code = 'ai_voice_orders'
  ) then
    raise exception 'phase53: settle committed failed or was overwritten';
  end if;

  -- 10. user_default budget (1 USD): owner has 0.30 committed.
  result := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000b2', 600000);
  if result like 'ERR:%' then
    raise exception 'phase53: owner second reserve failed: %', result;
  end if;
  result := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000b3', 200000);
  if result not like 'ERR:P0001:ai_budget_exhausted%' then
    raise exception 'phase53: user default budget must cap the owner, got %', result;
  end if;

  -- 11. tenant_default budget (2 USD): 0.90 (owner) + 0.95 (staff) + 0.20 (manager) > 2.00.
  result := pg_temp.phase53_reserve(staff_a, tenant_a, 'e5300000-0000-4000-8000-0000000000c1', 950000);
  if result like 'ERR:%' then
    raise exception 'phase53: staff reserve failed: %', result;
  end if;
  result := pg_temp.phase53_reserve(manager_a, tenant_a, 'e5300000-0000-4000-8000-0000000000c2', 200000);
  if result not like 'ERR:P0001:ai_budget_exhausted%' then
    raise exception 'phase53: tenant default budget must cap the manager, got %', result;
  end if;

  -- 12. Operator raises the tenant budget for tenant A only.
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('tenant', 'phase53a', null, true, 5000000, null, null, null);
  result := pg_temp.phase53_reserve(manager_a, tenant_a, 'e5300000-0000-4000-8000-0000000000c3', 200000);
  if result like 'ERR:%' then
    raise exception 'phase53: specific tenant budget not applied: %', result;
  end if;
  -- A user row with NULL budget inherits the 1 USD default.
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('user', 'phase53a', owner_a, true, null, null, null, null);
  result := pg_temp.phase53_reserve(owner_a, tenant_a, 'e5300000-0000-4000-8000-0000000000c4', 200000);
  if result not like 'ERR:P0001:ai_budget_exhausted%' then
    raise exception 'phase53: NULL user budget must inherit the default, got %', result;
  end if;

  -- 13. Specific switches and the per-user daily limit.
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('user', 'phase53a', manager_a, false, null, null, null, null);
  result := pg_temp.phase53_reserve(manager_a, tenant_a, 'e5300000-0000-4000-8000-0000000000d1', 1);
  if result not like 'ERR:P0001:ai_budget_exhausted:user_disabled' then
    raise exception 'phase53: user switch off must block, got %', result;
  end if;
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('user', 'phase53a', manager_a, true, null, 2, null, null);
  voice_status := pg_temp.phase53_status(manager_a, tenant_a);
  if (voice_status->'limits'->>'daily_request_limit')::integer <> 2
     or (voice_status->'remaining'->>'user_requests_today')::integer <> 1
     or voice_status::text like '%budget_micros%' or voice_status::text like '%spent%' then
    raise exception 'phase53: status must show limits without budgets, got %', voice_status;
  end if;
  result := pg_temp.phase53_reserve(manager_a, tenant_a, 'e5300000-0000-4000-8000-0000000000d2', 1, 'extraction');
  if result like 'ERR:%' then
    raise exception 'phase53: manager reserve within daily limit failed: %', result;
  end if;
  result := pg_temp.phase53_reserve(manager_a, tenant_a, 'e5300000-0000-4000-8000-0000000000d3', 1);
  if result not like 'ERR:P0001:ai_rate_limited%' then
    raise exception 'phase53: daily limit must block, got %', result;
  end if;
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('tenant', 'phase53a', null, false, 5000000, null, null, null);
  result := pg_temp.phase53_reserve(staff_a, tenant_a, 'e5300000-0000-4000-8000-0000000000d4', 1);
  if result not like 'ERR:P0001:ai_budget_exhausted:tenant_disabled' then
    raise exception 'phase53: tenant switch off must block, got %', result;
  end if;
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('tenant', 'phase53a', null, true, 5000000, null, null, null);

  -- 14. Expired reservations are expired lazily and still count (fail-closed).
  perform pg_temp.phase53_operator();
  update public.ai_usage_events
  set expires_at = now() - interval '1 second'
  where tenant_id = tenant_a and user_id = staff_a and status = 'reserved';
  get diagnostics row_count = row_count;
  if row_count <> 1 then
    raise exception 'phase53: expected one open staff reservation, got %', row_count;
  end if;
  -- A successful reservation expires the stale one (a failed one rolls back).
  result := pg_temp.phase53_reserve(staff_a, tenant_a, 'e5300000-0000-4000-8000-0000000000e1', 10000);
  if result like 'ERR:%' then
    raise exception 'phase53: staff reserve after expiry failed: %', result;
  end if;
  perform pg_temp.phase53_operator();
  if not exists (
    select 1 from public.ai_usage_events
    where tenant_id = tenant_a and user_id = staff_a and status = 'expired'
      and error_code = 'reservation_expired' and reserved_micros = 950000
  ) then
    raise exception 'phase53: stale reservation was not expired';
  end if;
  -- 0.95 expired + 0.01 reserved + 0.10 > 1 USD.
  result := pg_temp.phase53_reserve(staff_a, tenant_a, 'e5300000-0000-4000-8000-0000000000e2', 100000);
  if result not like 'ERR:P0001:ai_budget_exhausted%' then
    raise exception 'phase53: expired micros must still count toward the user budget, got %', result;
  end if;

  -- 15. Platform budget caps everyone; tenant B stays untouched.
  perform pg_temp.phase53_operator();
  perform public.set_tenant_feature('phase53b', 'ai_voice_orders', true, null);
  perform public.ai_set_voice_usage_limit('platform', null, null, true, 2100000, 60, 60, 3000000);
  result := pg_temp.phase53_reserve(owner_b, tenant_b, 'e5300000-0000-4000-8000-0000000000f1', 100000);
  if result not like 'ERR:P0001:ai_budget_exhausted%' then
    raise exception 'phase53: platform budget must cap tenant B, got %', result;
  end if;
  perform pg_temp.phase53_operator();
  perform public.ai_set_voice_usage_limit('platform', null, null, true, 10000000, 60, 60, 3000000);
  result := pg_temp.phase53_reserve(owner_b, tenant_b, 'e5300000-0000-4000-8000-0000000000f2', 100000);
  if result like 'ERR:%' then
    raise exception 'phase53: tenant B reserve failed: %', result;
  end if;
  perform pg_temp.phase53_operator();
  if (select count(*) from public.ai_usage_events where tenant_id = tenant_b) <> 1 then
    raise exception 'phase53: tenant B ledger must hold only its own event';
  end if;

  -- 16. Operator function: validation and who may call it.
  perform pg_temp.phase53_operator();
  begin
    perform public.ai_set_voice_usage_limit('global', null, null, true, null, null, null, null);
    raise exception 'phase53: invalid scope accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.ai_set_voice_usage_limit('platform', 'phase53a', null, true, null, null, null, null);
    raise exception 'phase53: platform scope with tenant accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.ai_set_voice_usage_limit('user', 'phase53a', outsider, true, null, null, null, null);
    raise exception 'phase53: user row for a non-member accepted';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.ai_set_voice_usage_limit('tenant', 'phase53-missing', null, true, null, null, null, null);
    raise exception 'phase53: unknown tenant accepted';
  exception when sqlstate 'P0002' then null;
  end;
  result := pg_temp.phase53_set_limit_as('authenticated', 'tenant', 'phase53a', null, true, 999999999);
  if result <> 'ERR:42501' then
    raise exception 'phase53: authenticated must not set limits, got %', result;
  end if;
  result := pg_temp.phase53_set_limit_as('service_role', 'tenant', 'phase53b', null, true, 3000000);
  if result <> 'ok' or not exists (
    select 1 from public.ai_usage_limits
    where scope = 'tenant' and tenant_id = tenant_b and monthly_budget_micros = 3000000
  ) then
    raise exception 'phase53: service_role operator path failed, got %', result;
  end if;

  -- 17. The ledger never stores text: only the documented columns exist.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_usage_events'
      and column_name not in (
        'id', 'tenant_id', 'user_id', 'feature_code', 'operation', 'request_id',
        'provider', 'model', 'pricing_version', 'status', 'reserved_micros',
        'actual_micros', 'audio_seconds', 'input_tokens', 'output_tokens',
        'error_code', 'period_month', 'created_at', 'settled_at', 'expires_at')
  ) then
    raise exception 'phase53: ai_usage_events gained an undocumented column';
  end if;

  perform pg_temp.phase53_operator();
  raise notice 'phase53_ai_voice_budget: ok';
end;
$phase53$;
rollback;
