-- Tenant feature grants V1 (Frente A1, docs/TENANT-FEATURE-GRANTS-V1.md).
-- Catalog and privileges, operator-only functions (two barriers), validation,
-- grant / change / withdrawal with their history, legacy set_tenant_feature
-- and direct SQL recorded, cascades, append-only history, atomicity, tenant
-- isolation, review_at as a pure reminder and billing independence.
-- Synthetic fixtures only; everything is rolled back.
begin;

-- Session for p_mode: owner (postgres, no JWT), service_role, authenticated
-- or anon (role switch + claims), jwt_authenticated / jwt_anon (claims only:
-- the database owner carrying a client JWT).
create function pg_temp.p54_as(p_mode text, p_sub uuid default null)
  returns void
  language plpgsql
as $helper$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role',
    case p_mode
      when 'owner' then ''
      when 'jwt_authenticated' then 'authenticated'
      when 'jwt_anon' then 'anon'
      else p_mode
    end, true);
  if p_mode in ('service_role', 'authenticated', 'anon') then
    execute format('set local role %I', p_mode);
  end if;
end;
$helper$;

-- Runs p_sql in p_mode; returns 'ok' or '<sqlstate> <message>'. Back to owner.
create function pg_temp.p54_try(p_mode text, p_sub uuid, p_sql text)
  returns text
  language plpgsql
as $helper$
declare
  v_result text := 'ok';
  v_state text;
  v_message text;
begin
  perform pg_temp.p54_as(p_mode, p_sub);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    v_result := v_state || ' ' || v_message;
  end;
  perform pg_temp.p54_as('owner');
  return v_result;
end;
$helper$;

create function pg_temp.p54_has(p_user uuid, p_tenant uuid, p_code text)
  returns boolean
  language plpgsql
as $helper$
declare
  v_enabled boolean;
begin
  perform pg_temp.p54_as('authenticated', p_user);
  v_enabled := public.tenant_has_feature(p_tenant, p_code);
  perform pg_temp.p54_as('owner');
  return v_enabled;
end;
$helper$;

-- What A1 must never change: billing, plans, prices, quotas and tenants.
create function pg_temp.p54_billing_snapshot(p_tenants uuid[])
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
    (select string_agg(to_jsonb(f)::text, '|' order by f.id)
       from public.features f where f.code not like 'phase54%'),
    (select string_agg((to_jsonb(t) - 'updated_at')::text, '|' order by t.id)
       from public.tenants t where t.id = any (p_tenants)),
    (select string_agg(coalesce(public.resolve_tenant_storage_limit_bytes(t)::text, 'null'), '|' order by t)
       from unnest(p_tenants) t)
  ));
$helper$;

do $phase54$
declare
  tenant_a uuid := 'e5400000-0000-4000-8000-000000000011';
  tenant_b uuid := 'e5400000-0000-4000-8000-000000000012';
  tenant_c uuid := 'e5400000-0000-4000-8000-000000000013';
  owner_a uuid := 'e5400000-0000-4000-8000-000000000001';
  viewer_a uuid := 'e5400000-0000-4000-8000-000000000002';
  owner_b uuid := 'e5400000-0000-4000-8000-000000000003';
  outsider uuid := 'e5400000-0000-4000-8000-000000000004';
  tmp_feature uuid := 'e5400000-0000-4000-8000-0000000000f1';
  core_plan uuid;
  import_feature uuid;
  quotes_feature uuid;
  review_1 timestamptz := now() + interval '7 days';
  review_2 timestamptz := now() + interval '14 days';
  result jsonb;
  outcome text;
  v_role text;
  v_fn regprocedure;
  v_count integer;
  v_events_before integer;
  b_row_before text;
  b_events_before integer;
  snapshot_before text;
  ev record;
  ov record;
begin
  -- 1. Catalog and privileges ----------------------------------------------
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_feature_overrides'
        and column_name in ('reason', 'granted_by', 'granted_at', 'review_at')) <> 4 then
    raise exception 'phase54: override terms columns missing';
  end if;
  if not (select c.relrowsecurity from pg_class c
          where c.oid = 'public.tenant_feature_override_events'::regclass) then
    raise exception 'phase54: history without RLS';
  end if;
  if exists (select 1 from pg_policies
             where schemaname = 'public'
               and tablename in ('tenant_feature_override_events', 'tenant_feature_overrides')) then
    raise exception 'phase54: unexpected policy on overrides or history';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.tenant_feature_override_events',
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
       or has_sequence_privilege(v_role, 'public.tenant_feature_override_events_id_seq',
         'USAGE, SELECT, UPDATE') then
      raise exception 'phase54: % holds a privilege on the history', v_role;
    end if;
    if has_table_privilege(v_role, 'public.tenant_feature_overrides', 'INSERT, UPDATE, DELETE, TRUNCATE')
       or (v_role <> 'service_role'
           and has_table_privilege(v_role, 'public.tenant_feature_overrides', 'SELECT')) then
      raise exception 'phase54: % can write, truncate or (client) read overrides directly', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
             where c.oid in ('public.tenant_feature_override_events'::regclass,
                             'public.tenant_feature_overrides'::regclass)
               and a.grantee = 0) then
    raise exception 'phase54: PUBLIC holds a privilege on overrides or history';
  end if;

  foreach v_fn in array array[
    'public.set_tenant_feature_v2(text,text,boolean,bigint,text,timestamptz,text)'::regprocedure,
    'public.clear_tenant_feature_override(text,text,text,text)'::regprocedure,
    'public.list_tenant_feature_reviews_due(timestamptz)'::regprocedure
  ] loop
    if not (select p.prosecdef and p.proconfig @> array['search_path=""']
            from pg_proc p where p.oid = v_fn) then
      raise exception 'phase54: % must be SECURITY DEFINER with an empty search_path', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = v_fn and a.grantee = 0) then
      raise exception 'phase54: EXECUTE on % must be service_role only', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.tg_tenant_feature_overrides_audit_v1()'::regprocedure,
    'public.tg_tenant_feature_audit_refuse_v1()'::regprocedure
  ] loop
    if has_function_privilege('service_role', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = v_fn and a.grantee = 0) then
      raise exception 'phase54: an API role can execute trigger function %', v_fn;
    end if;
  end loop;

  select count(*) into v_count
  from pg_trigger t
  where not t.tgisinternal and t.tgenabled = 'O'
    and (t.tgrelid, t.tgname, t.tgfoid) in (
      ('public.tenant_feature_overrides'::regclass, 'trg_tenant_feature_overrides_terms',
        'public.tg_tenant_feature_overrides_audit_v1()'::regprocedure),
      ('public.tenant_feature_overrides'::regclass, 'trg_tenant_feature_overrides_audit',
        'public.tg_tenant_feature_overrides_audit_v1()'::regprocedure),
      ('public.tenant_feature_overrides'::regclass, 'trg_tenant_feature_overrides_no_truncate',
        'public.tg_tenant_feature_audit_refuse_v1()'::regprocedure),
      ('public.tenant_feature_override_events'::regclass, 'trg_tenant_feature_override_events_append_only',
        'public.tg_tenant_feature_audit_refuse_v1()'::regprocedure),
      ('public.tenant_feature_override_events'::regclass, 'trg_tenant_feature_override_events_no_truncate',
        'public.tg_tenant_feature_audit_refuse_v1()'::regprocedure)
    );
  if v_count <> 5 then
    raise exception 'phase54: expected 5 enabled audit triggers, found %', v_count;
  end if;

  -- Legacy functions keep their signature, grants and logic.
  v_fn := 'public.set_tenant_feature(text,text,boolean,bigint)'::regprocedure;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'phase54: set_tenant_feature grants changed';
  end if;
  v_fn := 'public.tenant_has_feature(uuid,text)'::regprocedure;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'phase54: tenant_has_feature grants changed';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.set_tenant_feature(text,text,boolean,bigint)'::regprocedure,
                    'public.tenant_has_feature(uuid,text)'::regprocedure)
      and (p.prosrc ~ '(review_at|granted_|reason|tenant_feature_override_events)')
  ) then
    raise exception 'phase54: legacy feature functions now depend on A1 terms (review_at must never revoke)';
  end if;

  -- 2. Fixtures -----------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (owner_a, 'owner-a@phase54.test', '{}'::jsonb),
    (viewer_a, 'viewer-a@phase54.test', '{}'::jsonb),
    (owner_b, 'owner-b@phase54.test', '{}'::jsonb),
    (outsider, 'outsider@phase54.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values
    (owner_a, 'Owner A'), (viewer_a, 'Viewer A'), (owner_b, 'Owner B'), (outsider, 'Outsider');
  insert into public.tenants (id, name, slug, active) values
    (tenant_a, 'Phase54 A', 'phase54a', true),
    (tenant_b, 'Phase54 B', 'phase54b', true),
    (tenant_c, 'Phase54 C', 'phase54c', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (tenant_a, owner_a, 'owner', true),
    (tenant_a, viewer_a, 'viewer', true),
    (tenant_b, owner_b, 'owner', true);

  -- A core-only plan (no quotes, no clients_import), so a grant is the only
  -- way to get them. Basic includes both since 20261028090000; mvp does not.
  select id into core_plan from public.plans where code = 'mvp';
  select id into import_feature from public.features where code = 'clients_import';
  select id into quotes_feature from public.features where code = 'quotes';
  if core_plan is null or import_feature is null or quotes_feature is null then
    raise exception 'phase54: mvp plan, clients_import or quotes missing';
  end if;
  if exists (
    select 1 from public.plan_features pf
    where pf.plan_id = core_plan
      and pf.feature_id in (import_feature, quotes_feature)
      and pf.enabled
  ) then
    raise exception 'phase54: the fixture plan must not include clients_import or quotes';
  end if;
  insert into public.subscriptions (tenant_id, plan_id, provider, status, livemode) values
    (tenant_a, core_plan, 'internal', 'trialing', false),
    (tenant_b, core_plan, 'internal', 'active', false);

  -- Tenant B holds its own grant; nothing done to A may touch it.
  perform public.set_tenant_feature_v2('phase54b', 'quotes', true, 3,
    'Phase54 B control grant', null, 'phase54-operator');
  select (to_jsonb(o) - 'updated_at')::text into b_row_before
  from public.tenant_feature_overrides o where o.tenant_id = tenant_b;
  select count(*) into b_events_before
  from public.tenant_feature_override_events where tenant_id = tenant_b;
  if b_events_before <> 1 then
    raise exception 'phase54: control grant should write one event, got %', b_events_before;
  end if;

  snapshot_before := pg_temp.p54_billing_snapshot(array[tenant_a, tenant_b]);

  -- 3. Only a trusted operator can use the functions or touch the tables -----
  foreach v_role in array array['authenticated', 'anon'] loop
    outcome := pg_temp.p54_try(v_role, owner_a,
      $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'self grant', null, 'me')$$);
    if outcome not like '42501 permission denied%' then
      raise exception 'phase54: % ran set_tenant_feature_v2: %', v_role, outcome;
    end if;
    outcome := pg_temp.p54_try(v_role, owner_a,
      $$select public.clear_tenant_feature_override('phase54b', 'quotes', 'sabotage', 'me')$$);
    if outcome not like '42501 permission denied%' then
      raise exception 'phase54: % ran clear_tenant_feature_override: %', v_role, outcome;
    end if;
    outcome := pg_temp.p54_try(v_role, owner_a,
      $$select * from public.list_tenant_feature_reviews_due('infinity')$$);
    if outcome not like '42501 permission denied%' then
      raise exception 'phase54: % ran list_tenant_feature_reviews_due: %', v_role, outcome;
    end if;
    outcome := pg_temp.p54_try(v_role, owner_a,
      $$select public.set_tenant_feature('phase54a', 'clients_import', true, null)$$);
    if outcome not like '42501 permission denied%' then
      raise exception 'phase54: % ran set_tenant_feature: %', v_role, outcome;
    end if;
  end loop;

  -- Second barrier: the database owner carrying a client JWT is not an operator.
  foreach v_role in array array['jwt_authenticated', 'jwt_anon'] loop
    outcome := pg_temp.p54_try(v_role, owner_a,
      $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'self grant', null, 'me')$$);
    if outcome <> '42501 forbidden' then
      raise exception 'phase54: % passed the set_tenant_feature_v2 check: %', v_role, outcome;
    end if;
    outcome := pg_temp.p54_try(v_role, owner_a,
      $$select public.clear_tenant_feature_override('phase54b', 'quotes', 'sabotage', 'me')$$);
    if outcome <> '42501 forbidden' then
      raise exception 'phase54: % passed the clear check: %', v_role, outcome;
    end if;
    outcome := pg_temp.p54_try(v_role, owner_a,
      $$select * from public.list_tenant_feature_reviews_due('infinity')$$);
    if outcome <> '42501 forbidden' then
      raise exception 'phase54: % passed the review report check: %', v_role, outcome;
    end if;
  end loop;

  foreach v_role in array array['authenticated', 'anon', 'service_role'] loop
    foreach outcome in array array[
      $$select count(*) from public.tenant_feature_override_events$$,
      $$insert into public.tenant_feature_override_events (tenant_id, feature_id, action, source, new_enabled, actor_db_user)
          values ('e5400000-0000-4000-8000-000000000011', '31000000-0000-4000-8000-000000000006', 'created', 'direct_sql', true, 'forged')$$,
      $$update public.tenant_feature_override_events set reason = 'forged'$$,
      $$delete from public.tenant_feature_override_events$$,
      $$truncate public.tenant_feature_override_events$$,
      $$insert into public.tenant_feature_overrides (tenant_id, feature_id, enabled)
          values ('e5400000-0000-4000-8000-000000000011', '31000000-0000-4000-8000-000000000006', true)$$,
      $$update public.tenant_feature_overrides set enabled = false$$,
      $$delete from public.tenant_feature_overrides$$,
      $$truncate public.tenant_feature_overrides$$
    ] loop
      if pg_temp.p54_try(v_role, owner_a, outcome) not like '42501 permission denied%' then
        raise exception 'phase54: % was not denied: %', v_role, outcome;
      end if;
    end loop;
    if v_role <> 'service_role'
       and pg_temp.p54_try(v_role, owner_a, $$select count(*) from public.tenant_feature_overrides$$)
           not like '42501 permission denied%' then
      raise exception 'phase54: % can read overrides', v_role;
    end if;
  end loop;

  if exists (select 1 from public.tenant_feature_overrides where tenant_id = tenant_a)
     or exists (select 1 from public.tenant_feature_override_events where tenant_id = tenant_a) then
    raise exception 'phase54: a denied call wrote an override or an event';
  end if;

  -- 4. Validation: nothing is written on invalid input ------------------------
  foreach outcome in array array[
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, null, null, 'op')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, '   ', null, 'op')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, repeat('r', 501), null, 'op')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'why', null, null)$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'why', null, '')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'why', null, repeat('o', 201))$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'why', now(), 'op')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'why', now() - interval '1 hour', 'op')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', true, -1, 'why', null, 'op')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'clients_import', null, null, 'why', null, 'op')$$,
    $$select public.clear_tenant_feature_override('phase54b', 'quotes', ' ', 'op')$$,
    $$select public.clear_tenant_feature_override('phase54b', 'quotes', 'why', null)$$
  ] loop
    if pg_temp.p54_try('owner', null, outcome) not like '22023 %' then
      raise exception 'phase54: invalid input accepted: % -> %', outcome, pg_temp.p54_try('owner', null, outcome);
    end if;
  end loop;
  foreach outcome in array array[
    $$select public.set_tenant_feature_v2('phase54-missing', 'clients_import', true, null, 'why', null, 'op')$$,
    $$select public.set_tenant_feature_v2(null, 'clients_import', true, null, 'why', null, 'op')$$,
    $$select public.set_tenant_feature_v2('phase54a', 'phase54-missing', true, null, 'why', null, 'op')$$,
    $$select public.clear_tenant_feature_override('phase54-missing', 'quotes', 'why', 'op')$$,
    $$select public.clear_tenant_feature_override('phase54a', 'phase54-missing', 'why', 'op')$$
  ] loop
    if pg_temp.p54_try('owner', null, outcome) not like 'P0002 %' then
      raise exception 'phase54: unknown tenant or feature accepted: %', outcome;
    end if;
  end loop;
  if exists (select 1 from public.tenant_feature_overrides where tenant_id = tenant_a)
     or exists (select 1 from public.tenant_feature_override_events where tenant_id = tenant_a)
     or (select count(*) from public.tenant_feature_override_events where tenant_id = tenant_b) <> b_events_before then
    raise exception 'phase54: rejected input wrote an override or an event';
  end if;

  -- 5. Grant through service_role ----------------------------------------------
  perform pg_temp.p54_as('service_role');
  result := public.set_tenant_feature_v2('phase54a', 'clients_import', true, null,
    '  Pilot import, agreed by phone  ', review_1, '  ops@phase54.test ');
  perform pg_temp.p54_as('owner');

  if result ->> 'action' <> 'created' or result -> 'previous' <> 'null'::jsonb
     or (result ->> 'tenant_id')::uuid <> tenant_a
     or result ->> 'feature_code' <> 'clients_import'
     or result -> 'current' ->> 'reason' <> 'Pilot import, agreed by phone'
     or result -> 'current' ->> 'granted_by' <> 'ops@phase54.test'
     or (result -> 'current' ->> 'review_at')::timestamptz <> review_1 then
    raise exception 'phase54: unexpected grant result %', result;
  end if;

  select * into ov from public.tenant_feature_overrides
  where tenant_id = tenant_a and feature_id = import_feature;
  if ov.enabled is not true or ov.limit_value is not null
     or ov.reason <> 'Pilot import, agreed by phone' or ov.granted_by <> 'ops@phase54.test'
     or ov.granted_at <> now() or ov.review_at <> review_1 then
    raise exception 'phase54: grant terms not stored: %', to_jsonb(ov);
  end if;

  select * into ev from public.tenant_feature_override_events
  where id = (result ->> 'event_id')::bigint;
  if ev.tenant_id <> tenant_a or ev.tenant_slug <> 'phase54a' or ev.feature_code <> 'clients_import'
     or ev.action <> 'created' or ev.source <> 'set_tenant_feature_v2'
     or ev.reason <> 'Pilot import, agreed by phone' or ev.operator <> 'ops@phase54.test'
     or ev.old_enabled is not null or ev.new_enabled is not true or ev.new_review_at <> review_1
     or ev.actor_jwt_role <> 'service_role' or ev.actor_db_user <> session_user::text
     or ev.actor_user_id is not null or ev.occurred_at <> now() then
    raise exception 'phase54: unexpected grant event %', to_jsonb(ev);
  end if;

  if not pg_temp.p54_has(owner_a, tenant_a, 'clients_import')
     or not pg_temp.p54_has(viewer_a, tenant_a, 'clients_import') then
    raise exception 'phase54: members of A do not resolve the grant';
  end if;
  if pg_temp.p54_has(owner_b, tenant_a, 'clients_import')
     or pg_temp.p54_has(outsider, tenant_a, 'clients_import')
     or pg_temp.p54_has(owner_b, tenant_b, 'clients_import') then
    raise exception 'phase54: the grant leaked outside tenant A';
  end if;

  -- 6. Change and explicit denial (owner session, no JWT) ---------------------
  result := public.set_tenant_feature_v2('phase54a', 'clients_import', true, 100,
    'Larger pilot file', review_2, 'lead@phase54.test');
  if result ->> 'action' <> 'updated'
     or result -> 'previous' <> jsonb_build_object('enabled', true, 'limit_value', null, 'review_at', review_1) then
    raise exception 'phase54: unexpected change result %', result;
  end if;
  select * into ev from public.tenant_feature_override_events where id = (result ->> 'event_id')::bigint;
  if ev.action <> 'updated' or ev.old_limit_value is not null or ev.new_limit_value <> 100
     or ev.old_review_at <> review_1 or ev.new_review_at <> review_2
     or ev.operator <> 'lead@phase54.test' or ev.actor_jwt_role is not null
     or ev.actor_db_user <> session_user::text then
    raise exception 'phase54: unexpected change event %', to_jsonb(ev);
  end if;

  perform public.set_tenant_feature_v2('phase54a', 'clients_import', false, null,
    'Paused while the file is reviewed', null, 'lead@phase54.test');
  if pg_temp.p54_has(owner_a, tenant_a, 'clients_import') then
    raise exception 'phase54: an explicit false override still resolves';
  end if;
  if (select review_at from public.tenant_feature_overrides
      where tenant_id = tenant_a and feature_id = import_feature) is not null then
    raise exception 'phase54: v2 must store exactly the review_at it receives';
  end if;

  -- Override precedence is unchanged: false beats the plan, clear restores it.
  if not pg_temp.p54_has(owner_a, tenant_a, 'core_orders') then
    raise exception 'phase54: the core plan should grant core_orders';
  end if;
  perform public.set_tenant_feature_v2('phase54a', 'core_orders', false, null,
    'Precedence check', null, 'phase54-operator');
  if pg_temp.p54_has(owner_a, tenant_a, 'core_orders') then
    raise exception 'phase54: a false override must beat the plan';
  end if;
  result := public.clear_tenant_feature_override('phase54a', 'core_orders',
    'Precedence check done', 'phase54-operator');
  if not pg_temp.p54_has(owner_a, tenant_a, 'core_orders') or (result ->> 'removed')::boolean is not true then
    raise exception 'phase54: clearing must restore the plan resolution: %', result;
  end if;

  -- 7. review_at is a reminder only -----------------------------------------
  perform public.set_tenant_feature_v2('phase54a', 'clients_import', true, null,
    'Pilot import resumed', review_1, 'ops@phase54.test');
  select count(*) into v_events_before from public.tenant_feature_override_events;
  if exists (select 1 from public.list_tenant_feature_reviews_due() r where r.tenant_id = tenant_a) then
    raise exception 'phase54: a future review is reported as due';
  end if;
  select count(*) into v_count
  from public.list_tenant_feature_reviews_due(review_1 + interval '1 day') r
  where r.tenant_id = tenant_a and r.tenant_slug = 'phase54a' and r.feature_code = 'clients_import'
    and r.enabled and r.reason = 'Pilot import resumed' and r.granted_by = 'ops@phase54.test'
    and r.granted_at = now() and r.review_at = review_1;
  if v_count <> 1 then
    raise exception 'phase54: due review not reported';
  end if;
  perform pg_temp.p54_as('service_role');
  select count(*) into v_count
  from public.list_tenant_feature_reviews_due('infinity') r where r.tenant_id = tenant_a;
  perform pg_temp.p54_as('owner');
  if v_count <> 1 then
    raise exception 'phase54: service_role cannot read the review report';
  end if;
  if (select count(*) from public.tenant_feature_override_events) <> v_events_before
     or not pg_temp.p54_has(owner_a, tenant_a, 'clients_import') then
    raise exception 'phase54: the review report changed something';
  end if;

  -- 8. Withdrawal restores the absence of override ------------------------
  perform pg_temp.p54_as('service_role');
  result := public.clear_tenant_feature_override('phase54a', 'clients_import',
    ' Pilot finished ', ' ops@phase54.test ');
  perform pg_temp.p54_as('owner');
  if (result ->> 'removed')::boolean is not true
     or result -> 'previous' <> jsonb_build_object('enabled', true, 'limit_value', null, 'review_at', review_1) then
    raise exception 'phase54: unexpected clear result %', result;
  end if;
  if exists (select 1 from public.tenant_feature_overrides
             where tenant_id = tenant_a and feature_id = import_feature)
     or pg_temp.p54_has(owner_a, tenant_a, 'clients_import') then
    raise exception 'phase54: clear left the override or the feature on';
  end if;
  select * into ev from public.tenant_feature_override_events where id = (result ->> 'event_id')::bigint;
  if ev.action <> 'cleared' or ev.source <> 'clear_tenant_feature_override'
     or ev.reason <> 'Pilot finished' or ev.operator <> 'ops@phase54.test'
     or ev.old_enabled is not true or ev.old_review_at <> review_1
     or ev.new_enabled is not null or ev.actor_jwt_role <> 'service_role' then
    raise exception 'phase54: unexpected clear event %', to_jsonb(ev);
  end if;
  if coalesce(current_setting('app.tenant_feature_override_clear', true), '') <> '' then
    raise exception 'phase54: the clear context outlived the call';
  end if;

  select count(*) into v_events_before from public.tenant_feature_override_events;
  result := public.clear_tenant_feature_override('phase54a', 'clients_import', 'Again', 'ops@phase54.test');
  if (result ->> 'removed')::boolean is not false or result -> 'event_id' <> 'null'::jsonb
     or (select count(*) from public.tenant_feature_override_events) <> v_events_before then
    raise exception 'phase54: clearing a missing override must be a no-op: %', result;
  end if;

  -- 9. Legacy set_tenant_feature calls are recorded, unchanged ----------------
  perform public.set_tenant_feature('phase54a', 'quotes', true, null);
  select * into ev from public.tenant_feature_override_events
  where tenant_id = tenant_a and feature_id = quotes_feature order by id desc limit 1;
  if ev.action <> 'created' or ev.source <> 'set_tenant_feature'
     or ev.reason is not null or ev.operator is not null or ev.new_enabled is not true then
    raise exception 'phase54: v1 grant not recorded as such: %', to_jsonb(ev);
  end if;

  perform public.set_tenant_feature_v2('phase54a', 'quotes', true, null,
    'Quotes pilot', review_1, 'ops@phase54.test');
  perform public.set_tenant_feature('phase54a', 'quotes', true, null);
  select * into ov from public.tenant_feature_overrides where tenant_id = tenant_a and feature_id = quotes_feature;
  select * into ev from public.tenant_feature_override_events
  where tenant_id = tenant_a and feature_id = quotes_feature order by id desc limit 1;
  if ov.reason <> 'Quotes pilot' or ov.granted_by <> 'ops@phase54.test' or ov.review_at <> review_1
     or ev.source <> 'set_tenant_feature' or ev.action <> 'updated'
     or ev.old_enabled is distinct from ev.new_enabled or ev.old_limit_value is distinct from ev.new_limit_value then
    raise exception 'phase54: a no-op v1 call must keep the terms and still be recorded';
  end if;

  perform pg_temp.p54_as('service_role');
  perform public.set_tenant_feature('phase54a', 'quotes', false, 7);
  perform pg_temp.p54_as('owner');
  select * into ov from public.tenant_feature_overrides where tenant_id = tenant_a and feature_id = quotes_feature;
  select * into ev from public.tenant_feature_override_events
  where tenant_id = tenant_a and feature_id = quotes_feature order by id desc limit 1;
  if ov.enabled is not false or ov.limit_value <> 7
     or ov.reason is not null or ov.granted_by is not null or ov.granted_at is not null
     or ov.review_at <> review_1 then
    raise exception 'phase54: a v1 change must clear reason/operator and keep review_at: %', to_jsonb(ov);
  end if;
  if ev.source <> 'set_tenant_feature' or ev.old_enabled is not true or ev.new_enabled is not false
     or ev.new_limit_value <> 7 or ev.actor_jwt_role <> 'service_role' then
    raise exception 'phase54: v1 change not recorded: %', to_jsonb(ev);
  end if;
  if pg_temp.p54_try('owner', null, $$select public.set_tenant_feature('phase54-missing', 'quotes', true, null)$$)
     not like 'P0002 %' then
    raise exception 'phase54: v1 behaviour changed for an unknown tenant';
  end if;

  -- 10. Direct SQL by the owner is recorded and cannot forge terms ----------
  insert into public.tenant_feature_overrides (tenant_id, feature_id, enabled, reason, granted_by, granted_at, review_at)
  values (tenant_a, import_feature, true, 'forged', 'forger', now(), review_2);
  select * into ov from public.tenant_feature_overrides where tenant_id = tenant_a and feature_id = import_feature;
  select * into ev from public.tenant_feature_override_events
  where tenant_id = tenant_a and feature_id = import_feature order by id desc limit 1;
  if ov.reason is not null or ov.granted_by is not null or ov.granted_at is not null or ov.review_at is not null
     or ev.source <> 'direct_sql' or ev.action <> 'created' or ev.reason is not null then
    raise exception 'phase54: direct insert forged terms or was not recorded';
  end if;
  update public.tenant_feature_overrides
  set reason = 'forged', granted_by = 'forger', granted_at = now(), review_at = review_2
  where tenant_id = tenant_a and feature_id = import_feature;
  if (select reason is not null or review_at is not null from public.tenant_feature_overrides
      where tenant_id = tenant_a and feature_id = import_feature) then
    raise exception 'phase54: direct update forged terms';
  end if;
  outcome := pg_temp.p54_try('owner', null,
    format($$update public.tenant_feature_overrides set tenant_id = %L
             where tenant_id = %L and feature_id = %L$$, tenant_c, tenant_a, import_feature));
  if outcome <> '42501 tenant_feature_overrides key is immutable' then
    raise exception 'phase54: override key change not refused: %', outcome;
  end if;
  delete from public.tenant_feature_overrides where tenant_id = tenant_a and feature_id = import_feature;
  select * into ev from public.tenant_feature_override_events
  where tenant_id = tenant_a and feature_id = import_feature order by id desc limit 1;
  if ev.source <> 'direct_sql' or ev.action <> 'cleared' or ev.old_enabled is not true then
    raise exception 'phase54: direct delete not recorded';
  end if;

  -- 11. Cascades: the history outlives the tenant and the feature ------------
  insert into public.features (id, code, name, description)
  values (tmp_feature, 'phase54_tmp', 'Phase54 temporary', 'Synthetic feature');
  perform public.set_tenant_feature_v2('phase54a', 'phase54_tmp', true, null, 'Temporary', null, 'phase54-operator');
  perform public.set_tenant_feature_v2('phase54c', 'quotes', true, null, 'Doomed tenant', null, 'phase54-operator');
  delete from public.features where id = tmp_feature;
  delete from public.tenants where id = tenant_c;
  select * into ev from public.tenant_feature_override_events
  where feature_id = tmp_feature order by id desc limit 1;
  if ev.action <> 'cleared' or ev.source <> 'feature_deleted' or ev.feature_code is not null
     or ev.tenant_id <> tenant_a then
    raise exception 'phase54: feature cascade not recorded: %', to_jsonb(ev);
  end if;
  select * into ev from public.tenant_feature_override_events
  where tenant_id = tenant_c order by id desc limit 1;
  if ev.action <> 'cleared' or ev.source <> 'tenant_deleted' or ev.tenant_slug is not null then
    raise exception 'phase54: tenant cascade not recorded: %', to_jsonb(ev);
  end if;
  if (select count(*) from public.tenant_feature_override_events where tenant_id = tenant_c) <> 2 then
    raise exception 'phase54: history of a deleted tenant was lost';
  end if;

  -- 12. Append-only, even for the database owner ---------------------------
  foreach outcome in array array[
    $$update public.tenant_feature_override_events set reason = 'rewritten'$$,
    $$delete from public.tenant_feature_override_events where tenant_id = 'e5400000-0000-4000-8000-000000000011'$$,
    $$truncate public.tenant_feature_override_events$$,
    $$truncate public.tenant_feature_overrides$$
  ] loop
    if pg_temp.p54_try('owner', null, outcome) not like '42501 % is not allowed: the tenant feature history must stay complete' then
      raise exception 'phase54: history not protected against: %', outcome;
    end if;
  end loop;

  -- 13. Atomicity: the override and its event commit or roll back together ---
  select count(*) into v_events_before from public.tenant_feature_override_events;
  begin
    perform public.set_tenant_feature_v2('phase54a', 'clients_import', true, null, 'Doomed', null, 'phase54-operator');
    perform public.clear_tenant_feature_override('phase54b', 'quotes', 'Doomed', 'phase54-operator');
    perform 1 / 0;
  exception when division_by_zero then
    null;
  end;
  if exists (select 1 from public.tenant_feature_overrides where tenant_id = tenant_a and feature_id = import_feature)
     or not exists (select 1 from public.tenant_feature_overrides where tenant_id = tenant_b)
     or (select count(*) from public.tenant_feature_override_events) <> v_events_before then
    raise exception 'phase54: a failed transaction left an override change or an event';
  end if;

  -- 14. History is a consistent chain per override --------------------------
  -- Each event starts from the values the previous one left (a new override
  -- starts from nothing) and the current row equals the last event.
  if exists (
    select 1
    from (
      select e.*,
        lag(e.action) over w as prev_action,
        lag(e.new_enabled) over w as prev_enabled,
        lag(e.new_limit_value) over w as prev_limit,
        lag(e.new_review_at) over w as prev_review
      from public.tenant_feature_override_events e
      where e.tenant_id in (tenant_a, tenant_b, tenant_c)
      window w as (partition by e.tenant_id, e.feature_id order by e.id)
    ) c
    where (c.prev_action is null or c.prev_action = 'cleared') <> (c.action = 'created')
       or (c.action <> 'created' and (
             c.old_enabled is distinct from c.prev_enabled
             or c.old_limit_value is distinct from c.prev_limit
             or c.old_review_at is distinct from c.prev_review))
  ) then
    raise exception 'phase54: broken event chain';
  end if;
  if exists (
    select 1
    from public.tenant_feature_overrides o
    left join lateral (
      select e.* from public.tenant_feature_override_events e
      where e.tenant_id = o.tenant_id and e.feature_id = o.feature_id
      order by e.id desc limit 1
    ) last on true
    where o.tenant_id in (tenant_a, tenant_b)
      and (last.id is null
        or last.action = 'cleared'
        or o.enabled is distinct from last.new_enabled
        or o.limit_value is distinct from last.new_limit_value
        or o.review_at is distinct from last.new_review_at
        or (o.reason is not null and (last.source <> 'set_tenant_feature_v2'
              or o.reason <> last.reason or o.granted_by <> last.operator)))
  ) then
    raise exception 'phase54: an override does not match its last event';
  end if;

  -- 15. Tenant isolation and billing independence ----------------------------
  if (select (to_jsonb(o) - 'updated_at')::text from public.tenant_feature_overrides o
      where o.tenant_id = tenant_b) is distinct from b_row_before
     or (select count(*) from public.tenant_feature_override_events where tenant_id = tenant_b) <> b_events_before then
    raise exception 'phase54: operations on A touched tenant B';
  end if;
  if not pg_temp.p54_has(owner_b, tenant_b, 'quotes') or pg_temp.p54_has(owner_a, tenant_b, 'quotes') then
    raise exception 'phase54: tenant B resolution changed';
  end if;
  if pg_temp.p54_billing_snapshot(array[tenant_a, tenant_b]) <> snapshot_before then
    raise exception 'phase54: billing, plans, prices, quotas or tenants changed';
  end if;

  raise notice 'phase54 tenant feature grants PASS';
end;
$phase54$;

rollback;
