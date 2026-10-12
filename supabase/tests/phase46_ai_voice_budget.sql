-- phase46: AI voice orders budget ledger (internal cost control).
\set ON_ERROR_STOP on

do $$
declare
  v_owner_a uuid := 'e4610000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'e4610000-0000-4000-8000-000000000002';
  v_viewer uuid := 'e4610000-0000-4000-8000-000000000003';
  v_tenant_a uuid := 'e4610000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e4610000-0000-4000-8000-000000000012';
  v_feature uuid;
  v_request uuid := 'e4610000-0000-4000-8000-000000000021';
  v_request_2 uuid := 'e4610000-0000-4000-8000-000000000022';
  v_event uuid;
  v_event_2 uuid;
  v_status jsonb;
  v_sqlstate text;
  v_count integer;
begin
  delete from public.ai_usage_events where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.ai_usage_limits where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenant_feature_overrides where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.memberships where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenant_settings where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenants where id in (v_tenant_a, v_tenant_b);
  delete from public.profiles where id in (v_owner_a, v_owner_b, v_viewer);
  delete from auth.users where id in (v_owner_a, v_owner_b, v_viewer);

  select id into v_feature from public.features where code = 'voice_orders';
  if v_feature is null then
    raise exception 'phase46: voice_orders feature missing';
  end if;

  if exists (
    select 1 from public.plan_features pf
    where pf.feature_id = v_feature
  ) then
    raise exception 'phase46: voice_orders must not be on plan_features';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase46.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase46.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_viewer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer@phase46.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_owner_b, 'Owner B'),
    (v_viewer, 'Viewer');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase46', 'phase46a', true),
    (v_tenant_b, 'Tenant B Phase46', 'phase46b', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_viewer, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  insert into public.tenant_settings (tenant_id, preferences) values
    (v_tenant_a, '{}'::jsonb),
    (v_tenant_b, '{}'::jsonb);

  if public.tenant_has_feature(v_tenant_a, 'voice_orders') then
    raise exception 'phase46: feature must start disabled';
  end if;

  update public.ai_usage_limits
  set enabled = true, monthly_budget_micros = 10000
  where scope = 'platform' and feature_code = 'voice_orders';

  perform public.set_tenant_feature('phase46a', 'voice_orders', true, null);

  insert into public.ai_usage_limits (
    scope, tenant_id, feature_code, enabled, monthly_budget_micros, daily_request_limit
  ) values (
    'tenant', v_tenant_a, 'voice_orders', true, 5000, 10
  );

  -- Viewer cannot reserve
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.ai_reserve_usage(
      v_tenant_a, 'voice_orders', 'transcription', v_request, 1000, 'fake', 'fake', 'v1'
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase46: viewer reserve expected 42501, got %', v_sqlstate;
  end if;
  execute 'reset role';

  -- Cross-tenant reserve rejected
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.ai_reserve_usage(
      v_tenant_b, 'voice_orders', 'transcription', v_request, 1000, 'fake', 'fake', 'v1'
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase46: cross-tenant reserve expected 42501, got %', v_sqlstate;
  end if;

  v_event := public.ai_reserve_usage(
    v_tenant_a, 'voice_orders', 'transcription', v_request, 1000, 'fake', 'fake', 'v1'
  );
  v_event_2 := public.ai_reserve_usage(
    v_tenant_a, 'voice_orders', 'transcription', v_request, 1000, 'fake', 'fake', 'v1'
  );
  if v_event is distinct from v_event_2 then
    raise exception 'phase46: reserve must be idempotent by request_id';
  end if;

  perform public.ai_settle_usage(v_event, 'committed', 800, 12, null, null, null);

  -- Ledger inspection is operator-only (postgres). authenticated has no table
  -- privileges on ai_usage_events; do not GRANT SELECT to pass this check.
  execute 'reset role';

  select count(*) into v_count
  from public.ai_usage_events
  where id = v_event and status = 'committed' and actual_micros = 800;
  if v_count <> 1 then
    raise exception 'phase46: settle committed failed';
  end if;

  -- Confirm authenticated cannot read the ledger directly.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform 1 from public.ai_usage_events where id = v_event;
  exception when insufficient_privilege then
    v_sqlstate := '42501';
  when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase46: authenticated must not select ai_usage_events, got %', v_sqlstate;
  end if;

  -- settle idempotent (still as authenticated via RPC)
  perform public.ai_settle_usage(v_event, 'released', 0, null, null, null, null);
  execute 'reset role';
  select count(*) into v_count
  from public.ai_usage_events
  where id = v_event and status = 'committed';
  if v_count <> 1 then
    raise exception 'phase46: settle must stay committed';
  end if;

  -- budget exhaustion at tenant scope (5000)
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.ai_reserve_usage(
      v_tenant_a, 'voice_orders', 'extraction', v_request_2, 5000, 'fake', 'fake', 'v1'
    );
  exception when others then
    v_sqlstate := sqlstate;
    if sqlerrm not like '%ai_budget_exhausted%' then
      raise exception 'phase46: expected ai_budget_exhausted, got %', sqlerrm;
    end if;
  end;
  if v_sqlstate is null then
    raise exception 'phase46: over-budget reserve should fail';
  end if;

  -- platform kill switch
  execute 'reset role';
  update public.ai_usage_limits
  set enabled = false
  where scope = 'platform' and feature_code = 'voice_orders';

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.ai_reserve_usage(
      v_tenant_a, 'voice_orders', 'extraction',
      'e4610000-0000-4000-8000-000000000023'::uuid,
      100, 'fake', 'fake', 'v1'
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is null then
    raise exception 'phase46: platform disabled must block';
  end if;

  v_status := public.ai_voice_status(v_tenant_a);
  if (v_status->>'budget_enabled')::boolean is not false then
    raise exception 'phase46: status should report budget disabled';
  end if;

  execute 'reset role';

  -- restore platform defaults for other suites
  update public.ai_usage_limits
  set enabled = false, monthly_budget_micros = 10000000
  where scope = 'platform' and feature_code = 'voice_orders';

  delete from public.ai_usage_events where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.ai_usage_limits where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenant_feature_overrides where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.memberships where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenant_settings where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenants where id in (v_tenant_a, v_tenant_b);
  delete from public.profiles where id in (v_owner_a, v_owner_b, v_viewer);
  delete from auth.users where id in (v_owner_a, v_owner_b, v_viewer);

  raise notice 'phase46_ai_voice_budget: ok';
end;
$$;
