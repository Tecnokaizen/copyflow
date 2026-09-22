-- Order status deferred invariant under inactive commercial onboarding · phase30
-- Proves SECURITY DEFINER trigger sees physical rows while RLS stays enforced.

begin;

do $phase30$
declare
  v_owner uuid := 'e3000000-0000-4000-8000-000000000099';
  v_owner2 uuid := 'e3000000-0000-4000-8000-000000000098';
  v_tenant uuid;
  v_internal uuid;
  v_result jsonb;
  v_active boolean;
  v_count integer;
  v_initial_id uuid;
  v_other_id uuid;
  v_sqlstate text;
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
    'owner@phase30.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ), (
    v_owner2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner2@phase30.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values
    (v_owner, 'Phase30 Owner'),
    (v_owner2, 'Phase30 Owner2');

  -- A: authenticated commercial create_organization succeeds, including deferred
  --    constraint check under authenticated (PostgREST commit simulation).
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  v_result := public.create_organization(
    'Phase30 Pending',
    'phase30-pending',
    'Europe/Madrid'
  );
  v_tenant := (v_result ->> 'tenant_id')::uuid;
  if v_tenant is null then
    raise exception 'phase30 A: create_organization returned no tenant_id';
  end if;

  -- Force deferred invariant while still authenticated (the failing E2E path).
  execute 'set constraints order_statuses_require_initial immediate';
  execute 'set constraints order_statuses_require_initial deferred';

  -- B: resulting tenant active=false
  if coalesce((v_result ->> 'active')::boolean, true) is not false then
    raise exception 'phase30 B: commercial create payload must report active=false';
  end if;

  select t.active into v_active from public.tenants t where t.id = v_tenant;
  if v_active is not false then
    raise exception 'phase30 B: tenant row must be active=false';
  end if;

  -- D: authenticated pending owner still cannot SELECT operational order_statuses
  select count(*) into v_count
  from public.order_statuses
  where tenant_id = v_tenant;
  if v_count <> 0 then
    raise exception 'phase30 D: pending owner must not SELECT order_statuses via RLS, got %', v_count;
  end if;

  -- C: exactly one active initial exists physically (bypass RLS as postgres)
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_count
  from public.order_statuses s
  where s.tenant_id = v_tenant
    and s.is_initial = true
    and s.active = true;
  if v_count <> 1 then
    raise exception 'phase30 C: expected exactly one active initial, got %', v_count;
  end if;

  select s.id into v_initial_id
  from public.order_statuses s
  where s.tenant_id = v_tenant
    and s.is_initial = true
    and s.active = true
  limit 1;

  select s.id into v_other_id
  from public.order_statuses s
  where s.tenant_id = v_tenant
    and s.id <> v_initial_id
  limit 1;

  if v_other_id is null then
    raise exception 'phase30: need a non-initial status for invariant probes';
  end if;

  -- E: invariant still rejects zero active initial
  v_sqlstate := null;
  begin
    update public.order_statuses
    set is_initial = false
    where id = v_initial_id
      and tenant_id = v_tenant;

    execute 'set constraints order_statuses_require_initial immediate';
  exception
    when others then
      v_sqlstate := sqlstate;
  end;

  execute 'set constraints order_statuses_require_initial deferred';

  if v_sqlstate is distinct from '23514' then
    raise exception 'phase30 E: expected 23514 for zero initial, got %', v_sqlstate;
  end if;

  -- Restore valid state after failed immediate check rolled back the subtransaction?
  -- In PL/pgSQL, exception handlers abort the failed subtransaction, so the
  -- UPDATE that cleared is_initial was rolled back. Confirm still one initial.
  select count(*) into v_count
  from public.order_statuses s
  where s.tenant_id = v_tenant
    and s.is_initial = true
    and s.active = true;
  if v_count <> 1 then
    raise exception 'phase30 E restore: expected one initial after failed check, got %', v_count;
  end if;

  -- F: multiple-initial still rejected by unique/index rules (23505)
  v_sqlstate := null;
  begin
    update public.order_statuses
    set is_initial = true, active = true, is_ready = false, is_closed = false, is_cancelled = false
    where id = v_other_id
      and tenant_id = v_tenant;
  exception
    when others then
      v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '23505' then
    raise exception 'phase30 F: expected unique initial 23505, got %', v_sqlstate;
  end if;

  -- G: internal active tenant provisioning still succeeds
  v_result := public.create_internal_organization_v1(
    v_owner2,
    'Phase30 Internal',
    'phase30-internal',
    'Europe/Madrid'
  );
  v_internal := (v_result ->> 'tenant_id')::uuid;
  if v_internal is null then
    raise exception 'phase30 G: internal create returned no tenant_id';
  end if;
  if coalesce((v_result ->> 'active')::boolean, false) is not true then
    raise exception 'phase30 G: internal tenant must be active=true, got %', v_result;
  end if;

  select count(*) into v_count
  from public.order_statuses s
  where s.tenant_id = v_internal
    and s.is_initial = true
    and s.active = true;
  if v_count <> 1 then
    raise exception 'phase30 G: internal tenant must have one active initial, got %', v_count;
  end if;

  -- H: DEMO/SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase30: DEMO mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase30: SUR4 mutated';
  end if;

  -- Trigger function must not be executable by anon/authenticated
  if has_function_privilege(
    'anon',
    'public.tg_order_statuses_require_initial()',
    'execute'
  ) then
    raise exception 'phase30: anon must not execute tg_order_statuses_require_initial';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.tg_order_statuses_require_initial()',
    'execute'
  ) then
    raise exception 'phase30: authenticated must not execute tg_order_statuses_require_initial';
  end if;

  raise notice 'phase30_order_statuses_require_initial_security_definer_ok';
end;
$phase30$;

rollback;
