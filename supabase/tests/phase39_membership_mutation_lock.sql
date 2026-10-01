-- Lock compartido de memberships y owner en dos tenants.
-- phase38_tenant_ownership_transfer.sql sigue cubriendo el resto de la
-- transferencia: self, inactivo, cross-tenant, admin, auditoría y grants base.

begin;

do $phase39$
declare
  v_owner_a uuid := 'a3940000-0000-4000-8000-000000000001';
  v_user_b uuid := 'a3940000-0000-4000-8000-000000000002';
  v_manager uuid := 'a3940000-0000-4000-8000-000000000003';
  v_staff uuid := 'a3940000-0000-4000-8000-000000000004';
  v_viewer uuid := 'a3940000-0000-4000-8000-000000000005';
  v_tenant_a uuid := 'a3940000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'a3940000-0000-4000-8000-000000000012';
  v_role text;
  v_active boolean;
  v_count integer;
  v_sqlstate text;
  v_definition text;
  v_signature text;
  v_actor uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase39.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'user-b@phase39.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"User B"}'::jsonb, now(), now(), '', '', '', ''),
    (v_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager@phase39.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Manager"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff@phase39.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer@phase39.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_user_b, 'User B'),
    (v_manager, 'Manager'),
    (v_staff, 'Staff'),
    (v_viewer, 'Viewer');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Phase39 A', 'phase39-a', true),
    (v_tenant_b, 'Phase39 B', 'phase39-b', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_user_b, 'admin', true),
    (v_tenant_a, v_manager, 'manager', true),
    (v_tenant_a, v_staff, 'staff', true),
    (v_tenant_a, v_viewer, 'viewer', true),
    (v_tenant_b, v_user_b, 'owner', true);

  foreach v_signature in array array[
    'public.transfer_tenant_ownership(uuid,uuid)',
    'public.update_tenant_membership_role(uuid,uuid,text)',
    'public.set_tenant_membership_active(uuid,uuid,boolean)'
  ]
  loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if position('gestcopy.membership.tenant:' in v_definition) = 0
       or position('for update' in pg_catalog.lower(v_definition))
          < position('gestcopy.membership.tenant:' in v_definition) then
      raise exception 'FAIL lock order %', v_signature;
    end if;
    if position('tenant-ownership:' in v_definition) > 0 then
      raise exception 'FAIL divergent ownership lock still present in %', v_signature;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.transfer_tenant_ownership(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.transfer_tenant_ownership(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.transfer_tenant_ownership(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_tenant_membership_role(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_tenant_membership_role(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_tenant_membership_active(uuid,uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_tenant_membership_active(uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'FAIL grants changed';
  end if;

  foreach v_actor in array array[v_manager, v_staff, v_viewer]
  loop
    v_sqlstate := null;
    begin
      perform set_config('request.jwt.claim.sub', v_actor::text, true);
      execute 'set local role authenticated';
      perform public.transfer_tenant_ownership(v_tenant_a, v_user_b);
      execute 'reset role';
    exception when others then
      v_sqlstate := sqlstate;
      execute 'reset role';
    end;
    if v_sqlstate is distinct from '42501' then
      raise exception 'FAIL non-owner transfer expected 42501 got %', v_sqlstate;
    end if;
  end loop;

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.update_tenant_membership_role(v_tenant_a, v_staff, 'owner');
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL change_role owner expected 22023 got %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  perform public.transfer_tenant_ownership(v_tenant_a, v_user_b);
  execute 'reset role';

  select role, active into v_role, v_active
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_user_b;
  if v_role is distinct from 'owner' or v_active is distinct from true then
    raise exception 'FAIL tenant A new owner role=% active=%', v_role, v_active;
  end if;

  select role into v_role
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_owner_a;
  if v_role is distinct from 'admin' then
    raise exception 'FAIL previous owner role %', v_role;
  end if;

  select role, active into v_role, v_active
  from public.memberships
  where tenant_id = v_tenant_b and user_id = v_user_b;
  if v_role is distinct from 'owner' or v_active is distinct from true then
    raise exception 'FAIL tenant B ownership changed role=% active=%', v_role, v_active;
  end if;

  select count(*)::integer into v_count
  from public.memberships
  where user_id = v_user_b and role = 'owner' and active = true;
  if v_count <> 2 then
    raise exception 'FAIL user B should own both tenants, count=%', v_count;
  end if;

  select count(*)::integer into v_count
  from public.memberships
  where tenant_id = v_tenant_a and role = 'owner' and active = true;
  if v_count <> 1 then
    raise exception 'FAIL tenant A owner count %', v_count;
  end if;

  select count(*)::integer into v_count
  from public.activity_log
  where tenant_id = v_tenant_a
    and action = 'membership.role_changed'
    and metadata ->> 'operation' = 'ownership_transfer';
  if v_count <> 2 then
    raise exception 'FAIL ownership audit count %', v_count;
  end if;

  select count(*)::integer into v_count
  from public.activity_log
  where tenant_id = v_tenant_b;
  if v_count <> 0 then
    raise exception 'FAIL tenant B activity changed %', v_count;
  end if;

  raise notice 'PASS Phase 39 membership mutation lock';
end;
$phase39$;

rollback;
