-- Gestcopy Pro · Acceso anticipado V1 (docs/adr/2026-10-15-pro-early-access-v1.md).
-- Catalog, resolution, tenant isolation, roles, self-grant denial, revocation
-- and billing independence through the existing tenant_has_feature and
-- set_tenant_feature. Synthetic fixtures only; everything is rolled back.
-- Run on a freshly migrated database: it asserts that no tenant is enrolled.
begin;

-- Resolve a feature as an authenticated user, the way the app session does.
create function pg_temp.phase47_has(p_user uuid, p_tenant uuid, p_code text)
  returns boolean
  language plpgsql
as $helper$
declare
  v_enabled boolean;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_enabled := public.tenant_has_feature(p_tenant, p_code);
  execute 'reset role';
  return v_enabled;
end;
$helper$;

-- Operator context: database owner without JWT claims (set_tenant_feature path).
create function pg_temp.phase47_operator()
  returns void
  language plpgsql
as $helper$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end;
$helper$;

-- Everything the program must never change: billing, plans, prices, quotas,
-- tenants and every override that is not pro_early_access (quotes included).
create function pg_temp.phase47_billing_snapshot(p_tenants uuid[])
  returns text
  language sql
as $helper$
  select md5(concat_ws('#',
    (select string_agg((to_jsonb(s) - 'updated_at')::text, '|' order by s.id)
       from public.subscriptions s where s.tenant_id = any (p_tenants)),
    (select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.plans p),
    (select string_agg(to_jsonb(pf)::text, '|' order by pf.plan_id, pf.feature_id)
       from public.plan_features pf),
    (select string_agg(to_jsonb(bp)::text, '|' order by bp.id) from public.billing_prices bp),
    (select string_agg((to_jsonb(t) - 'updated_at')::text, '|' order by t.id)
       from public.tenants t where t.id = any (p_tenants)),
    (select string_agg(to_jsonb(o)::text, '|' order by o.tenant_id, o.feature_id)
       from public.tenant_feature_overrides o
       join public.features f on f.id = o.feature_id
       where f.code <> 'pro_early_access'),
    (select string_agg(
        coalesce(public.resolve_tenant_storage_limit_bytes(t)::text, 'null')
        || ':' || public.tenant_has_feature(t, 'quotes')::text, '|' order by t)
       from unnest(p_tenants) t)
  ));
$helper$;

do $phase47$
declare
  tenant_a uuid := 'e4700000-0000-4000-8000-000000000011';
  tenant_b uuid := 'e4700000-0000-4000-8000-000000000012';
  owner_a uuid := 'e4700000-0000-4000-8000-000000000001';
  admin_a uuid := 'e4700000-0000-4000-8000-000000000002';
  manager_a uuid := 'e4700000-0000-4000-8000-000000000003';
  staff_a uuid := 'e4700000-0000-4000-8000-000000000004';
  viewer_a uuid := 'e4700000-0000-4000-8000-000000000005';
  owner_b uuid := 'e4700000-0000-4000-8000-000000000006';
  outsider uuid := 'e4700000-0000-4000-8000-000000000007';
  members_a uuid[];
  actor uuid;
  basic_plan uuid;
  pro_feature uuid;
  sub_status text;
  sub_live boolean;
  program_on boolean;
  anon_result boolean;
  err text;
  row_count integer;
  snapshot_before text;
  snapshot_after text;
begin
  members_a := array[owner_a, admin_a, manager_a, staff_a, viewer_a];

  -- 1. Catalog: both codes exist, no plan inherits them, nobody is enrolled.
  select id into pro_feature from public.features where code = 'pro_early_access';
  if pro_feature is null
     or not exists (select 1 from public.features where code = 'ai_voice_orders') then
    raise exception 'phase47: pro_early_access / ai_voice_orders missing from catalog';
  end if;
  if exists (
    select 1 from public.plan_features pf
    join public.features f on f.id = pf.feature_id
    where f.code in ('pro_early_access', 'ai_voice_orders')
  ) then
    raise exception 'phase47: a plan inherits pro_early_access or ai_voice_orders';
  end if;
  if exists (
    select 1 from public.tenant_feature_overrides o
    join public.features f on f.id = o.feature_id
    where f.code in ('pro_early_access', 'ai_voice_orders')
  ) then
    raise exception 'phase47: a tenant is enrolled before any operator grant';
  end if;

  -- 2. Fixtures: tenant A with every role, tenant B, a user without membership.
  insert into auth.users (id, email, raw_user_meta_data) values
    (owner_a, 'owner-a@phase47.test', '{}'::jsonb),
    (admin_a, 'admin-a@phase47.test', '{}'::jsonb),
    (manager_a, 'manager-a@phase47.test', '{}'::jsonb),
    (staff_a, 'staff-a@phase47.test', '{}'::jsonb),
    (viewer_a, 'viewer-a@phase47.test', '{}'::jsonb),
    (owner_b, 'owner-b@phase47.test', '{}'::jsonb),
    (outsider, 'outsider@phase47.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values
    (owner_a, 'Owner A'), (admin_a, 'Admin A'), (manager_a, 'Manager A'),
    (staff_a, 'Staff A'), (viewer_a, 'Viewer A'), (owner_b, 'Owner B'),
    (outsider, 'Outsider');
  insert into public.tenants (id, name, slug, active) values
    (tenant_a, 'Phase47 A', 'phase47a', true),
    (tenant_b, 'Phase47 B', 'phase47b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (tenant_a, owner_a, 'owner', true),
    (tenant_a, admin_a, 'admin', true),
    (tenant_a, manager_a, 'manager', true),
    (tenant_a, staff_a, 'staff', true),
    (tenant_a, viewer_a, 'viewer', true),
    (tenant_b, owner_b, 'owner', true);

  select id into basic_plan from public.plans where code = 'basic';
  if basic_plan is null then
    raise exception 'phase47: basic plan missing';
  end if;
  insert into public.subscriptions (tenant_id, plan_id, provider, status, livemode)
  values
    (tenant_a, basic_plan, 'stripe', 'active', false),
    (tenant_b, basic_plan, 'stripe', 'active', false);
  -- Unrelated overrides that must survive every program change.
  perform public.set_tenant_feature('phase47a', 'quotes', true, null);
  perform public.set_tenant_feature('phase47b', 'quotes', false, null);

  -- 3. Billing never grants the program: every status and mode, program OFF and ON.
  foreach program_on in array array[false, true] loop
    if program_on then
      perform pg_temp.phase47_operator();
      snapshot_before := pg_temp.phase47_billing_snapshot(array[tenant_a, tenant_b]);
      perform public.set_tenant_feature('phase47a', 'pro_early_access', true, null);
      snapshot_after := pg_temp.phase47_billing_snapshot(array[tenant_a, tenant_b]);
      if snapshot_after is distinct from snapshot_before then
        raise exception 'phase47: enabling the program changed billing, quotas, tenants or quotes';
      end if;
    end if;

    foreach sub_status in array array['active', 'trialing', 'past_due', 'canceled'] loop
      foreach sub_live in array array[false, true] loop
        perform pg_temp.phase47_operator();
        update public.subscriptions
          set status = sub_status, livemode = sub_live
          where tenant_id = tenant_a;

        if pg_temp.phase47_has(owner_a, tenant_a, 'pro_early_access') is distinct from program_on then
          raise exception 'phase47: program % resolved % for subscription %/livemode %',
            program_on, not program_on, sub_status, sub_live;
        end if;
        if pg_temp.phase47_has(owner_a, tenant_a, 'ai_voice_orders') is distinct from false then
          raise exception 'phase47: ai_voice_orders resolved true for subscription %/livemode %',
            sub_status, sub_live;
        end if;
        -- Control: the plan fallback itself is live for Basic features.
        if pg_temp.phase47_has(owner_a, tenant_a, 'core_orders')
           is distinct from (sub_status in ('active', 'trialing')) then
          raise exception 'phase47: unexpected core_orders fallback for %', sub_status;
        end if;
      end loop;
    end loop;

    perform pg_temp.phase47_operator();
    update public.subscriptions set status = 'active', livemode = false
      where tenant_id = tenant_a;
  end loop;

  -- 4. Enrolled tenant: every active role reads the program; nothing else changes.
  foreach actor in array members_a loop
    if pg_temp.phase47_has(actor, tenant_a, 'pro_early_access') is distinct from true then
      raise exception 'phase47: member % of the enrolled tenant cannot resolve the program', actor;
    end if;
    if pg_temp.phase47_has(actor, tenant_a, 'ai_voice_orders') is distinct from false then
      raise exception 'phase47: the program granted ai_voice_orders to %', actor;
    end if;
    if pg_temp.phase47_has(actor, tenant_a, 'quotes') is distinct from true then
      raise exception 'phase47: the program changed quotes for %', actor;
    end if;
    -- Membership in A never reveals tenant B.
    if pg_temp.phase47_has(actor, tenant_b, 'pro_early_access') is distinct from false then
      raise exception 'phase47: member of A resolved tenant B';
    end if;
  end loop;

  -- 5. Isolation: tenant B, a user without membership and anon see nothing.
  if pg_temp.phase47_has(owner_b, tenant_b, 'pro_early_access') is distinct from false
     or pg_temp.phase47_has(owner_b, tenant_a, 'pro_early_access') is distinct from false then
    raise exception 'phase47: tenant B member resolved the program';
  end if;
  if pg_temp.phase47_has(outsider, tenant_a, 'pro_early_access') is distinct from false
     or pg_temp.phase47_has(null, tenant_a, 'pro_early_access') is distinct from false then
    raise exception 'phase47: a user without membership resolved the program';
  end if;
  perform pg_temp.phase47_operator();
  if has_function_privilege('anon', 'public.tenant_has_feature(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_tenant_feature(text,text,boolean,bigint)', 'EXECUTE') then
    raise exception 'phase47: anon can execute feature RPCs';
  end if;
  execute 'set local role anon';
  err := null;
  begin
    anon_result := public.tenant_has_feature(tenant_a, 'pro_early_access');
  exception when insufficient_privilege then
    err := sqlstate;
  end;
  execute 'reset role';
  if err is distinct from '42501' then
    raise exception 'phase47: anon resolved the program (%)', anon_result;
  end if;

  -- 6. No self-grant: no role (any tenant) can write the catalog or an override.
  foreach actor in array members_a || array[owner_b, outsider] loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';

    err := null;
    begin
      perform public.set_tenant_feature('phase47a', 'pro_early_access', true, null);
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then
      raise exception 'phase47: % executed set_tenant_feature', actor;
    end if;

    err := null;
    begin
      insert into public.tenant_feature_overrides (tenant_id, feature_id, enabled)
      values (tenant_b, pro_feature, true);
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then
      raise exception 'phase47: % inserted an override', actor;
    end if;

    err := null;
    begin
      update public.tenant_feature_overrides set enabled = false where tenant_id = tenant_a;
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then
      raise exception 'phase47: % updated an override', actor;
    end if;

    err := null;
    begin
      delete from public.tenant_feature_overrides where tenant_id = tenant_a;
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then
      raise exception 'phase47: % deleted an override', actor;
    end if;

    err := null;
    begin
      perform 1 from public.tenant_feature_overrides;
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then
      raise exception 'phase47: % can read overrides', actor;
    end if;

    err := null;
    begin
      insert into public.plan_features (plan_id, feature_id, enabled)
      values (basic_plan, pro_feature, true);
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then
      raise exception 'phase47: % attached the program to a plan', actor;
    end if;

    err := null;
    begin
      update public.features set name = 'Hijacked' where id = pro_feature;
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then
      raise exception 'phase47: % updated the feature catalog', actor;
    end if;

    execute 'reset role';
  end loop;

  perform pg_temp.phase47_operator();
  if not exists (
    select 1 from public.tenant_feature_overrides
    where tenant_id = tenant_a and feature_id = pro_feature and enabled is true
  ) or exists (
    select 1 from public.tenant_feature_overrides
    where tenant_id = tenant_b and feature_id = pro_feature
  ) then
    raise exception 'phase47: self-grant attempts changed overrides';
  end if;

  -- 7. Inactive membership and inactive tenant fail closed.
  update public.memberships set active = false where tenant_id = tenant_a and user_id = staff_a;
  if pg_temp.phase47_has(staff_a, tenant_a, 'pro_early_access') is distinct from false then
    raise exception 'phase47: inactive membership resolved the program';
  end if;
  update public.memberships set active = true where tenant_id = tenant_a and user_id = staff_a;

  -- tenant_has_feature only checks the membership (audit). The app context
  -- denies an inactive tenant because getCurrentTenant reads it with active=true.
  perform pg_temp.phase47_operator();
  update public.tenants set active = false where id = tenant_a;
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if exists (select 1 from public.tenants where slug = 'phase47a' and active = true) then
    raise exception 'phase47: inactive tenant still resolves as app context';
  end if;
  execute 'reset role';
  perform pg_temp.phase47_operator();
  update public.tenants set active = true where id = tenant_a;

  -- 8. ai_voice_orders is independent: granting it neither enrols nor extends Pro.
  perform public.set_tenant_feature('phase47b', 'ai_voice_orders', true, null);
  if pg_temp.phase47_has(owner_b, tenant_b, 'pro_early_access') is distinct from false then
    raise exception 'phase47: ai_voice_orders enrolled tenant B in the program';
  end if;
  if pg_temp.phase47_has(owner_a, tenant_a, 'ai_voice_orders') is distinct from false then
    raise exception 'phase47: tenant B voice flag leaked to tenant A';
  end if;
  perform pg_temp.phase47_operator();
  perform public.set_tenant_feature('phase47b', 'ai_voice_orders', false, null);

  -- 9. Revocation: an explicit false wins over any plan fallback; billing intact.
  snapshot_before := pg_temp.phase47_billing_snapshot(array[tenant_a, tenant_b]);
  perform public.set_tenant_feature('phase47a', 'pro_early_access', false, null);
  snapshot_after := pg_temp.phase47_billing_snapshot(array[tenant_a, tenant_b]);
  if snapshot_after is distinct from snapshot_before then
    raise exception 'phase47: revoking the program changed billing, quotas, tenants or quotes';
  end if;
  foreach actor in array members_a loop
    if pg_temp.phase47_has(actor, tenant_a, 'pro_early_access') is distinct from false then
      raise exception 'phase47: revoked program still resolves for %', actor;
    end if;
    if pg_temp.phase47_has(actor, tenant_a, 'quotes') is distinct from true then
      raise exception 'phase47: revoking the program changed quotes for %', actor;
    end if;
  end loop;

  -- Misconfiguration drill: a plan row would enrol every subscriber (why step 1
  -- forbids it), but tenant A's explicit false still prevails.
  perform pg_temp.phase47_operator();
  insert into public.plan_features (plan_id, feature_id, enabled)
  values (basic_plan, pro_feature, true);
  if pg_temp.phase47_has(owner_a, tenant_a, 'pro_early_access') is distinct from false then
    raise exception 'phase47: plan fallback overrode an explicit revocation';
  end if;
  if pg_temp.phase47_has(owner_b, tenant_b, 'pro_early_access') is distinct from true then
    raise exception 'phase47: plan fallback control did not resolve';
  end if;
  perform pg_temp.phase47_operator();
  delete from public.plan_features where plan_id = basic_plan and feature_id = pro_feature;

  -- Restoring the exact previous absence is a separate operator action.
  delete from public.tenant_feature_overrides
    where tenant_id = tenant_a and feature_id = pro_feature;
  get diagnostics row_count = row_count;
  if row_count <> 1
     or pg_temp.phase47_has(owner_a, tenant_a, 'pro_early_access') is distinct from false
     or pg_temp.phase47_has(owner_a, tenant_a, 'quotes') is distinct from true then
    raise exception 'phase47: restoring the absence of the override failed';
  end if;

  -- 10. service_role keeps the operator path (used for staging/pilot grants).
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
  perform public.set_tenant_feature('phase47b', 'pro_early_access', true, null);
  if public.tenant_has_feature(tenant_b, 'pro_early_access') is distinct from true then
    raise exception 'phase47: service_role could not enrol tenant B';
  end if;
  execute 'reset role';
  if pg_temp.phase47_has(owner_a, tenant_a, 'pro_early_access') is distinct from false then
    raise exception 'phase47: enrolling tenant B enrolled tenant A';
  end if;
  perform pg_temp.phase47_operator();
end;
$phase47$;
rollback;
