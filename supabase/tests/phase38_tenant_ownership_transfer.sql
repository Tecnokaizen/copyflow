-- Transferencia de propiedad: autorización, aislamiento, atomicidad y auditoría.
-- Ejecutar tras aplicar 20260930120000_transfer_tenant_ownership.sql.

begin;

do $phase38$
declare
  v_owner_a uuid := 'a3800000-0000-4000-8000-000000000001';
  v_target_a uuid := 'a3800000-0000-4000-8000-000000000002';
  v_owner_b uuid := 'b3800000-0000-4000-8000-000000000001';
  v_admin_b uuid := 'b3800000-0000-4000-8000-000000000002';
  v_staff_b uuid := 'b3800000-0000-4000-8000-000000000003';
  v_inactive_b uuid := 'b3800000-0000-4000-8000-000000000004';
  v_tenant_a uuid := 'a3900000-0000-4000-8000-000000000001';
  v_tenant_b uuid := 'b3900000-0000-4000-8000-000000000001';
  v_result jsonb;
  v_sqlstate text;
  v_role text;
  v_count integer;
  v_audit_before integer;
  v_definition text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase38.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_target_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'target-a@phase38.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Tamara A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase38.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', ''),
    (v_admin_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-b@phase38.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Admin B"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-b@phase38.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff B"}'::jsonb, now(), now(), '', '', '', ''),
    (v_inactive_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'inactive-b@phase38.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Inactive B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_target_a, 'Tamara A'),
    (v_owner_b, 'Owner B'),
    (v_admin_b, 'Admin B'),
    (v_staff_b, 'Staff B'),
    (v_inactive_b, 'Inactive B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase38', 'tenant-a-phase38', true),
    (v_tenant_b, 'Tenant B Phase38', 'tenant-b-phase38', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_target_a, 'staff', true),
    (v_tenant_b, v_owner_b, 'owner', true),
    (v_tenant_b, v_admin_b, 'admin', true),
    (v_tenant_b, v_staff_b, 'staff', true),
    (v_tenant_b, v_inactive_b, 'staff', false);

  -- Privileges: only authenticated callers and postgres can execute directly.
  if has_function_privilege(
    'anon',
    'public.transfer_tenant_ownership(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FAIL grants: anon can execute transfer';
  end if;

  if has_function_privilege(
    'service_role',
    'public.transfer_tenant_ownership(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FAIL grants: service_role can execute transfer';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.transfer_tenant_ownership(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FAIL grants: authenticated cannot execute transfer';
  end if;

  -- Successful transfer: both role changes and both audit events are atomic.
  select count(*)::integer into v_audit_before
  from public.activity_log
  where tenant_id = v_tenant_a;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.transfer_tenant_ownership(v_tenant_a, v_target_a);
  execute 'reset role';

  if (v_result #>> '{previous_owner,user_id}')::uuid is distinct from v_owner_a
     or (v_result #>> '{previous_owner,role}') is distinct from 'admin'
     or (v_result #>> '{new_owner,user_id}')::uuid is distinct from v_target_a
     or (v_result #>> '{new_owner,role}') is distinct from 'owner' then
    raise exception 'FAIL success payload: %', v_result;
  end if;

  select role into v_role
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_owner_a;
  if v_role is distinct from 'admin' then
    raise exception 'FAIL previous owner role: %', v_role;
  end if;

  select role into v_role
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_target_a;
  if v_role is distinct from 'owner' then
    raise exception 'FAIL new owner role: %', v_role;
  end if;

  select count(*)::integer into v_count
  from public.memberships
  where tenant_id = v_tenant_a and role = 'owner' and active = true;
  if v_count < 1 then
    raise exception 'FAIL tenant left without active owner';
  end if;

  select count(*)::integer into v_count
  from public.activity_log al
  where al.tenant_id = v_tenant_a
    and al.user_id = v_owner_a
    and al.entity_type = 'membership'
    and al.entity_id in (v_owner_a, v_target_a)
    and al.action = 'membership.role_changed'
    and al.metadata ->> 'operation' = 'ownership_transfer'
    and al.metadata ->> 'previous_owner_user_id' = v_owner_a::text
    and al.metadata ->> 'new_owner_user_id' = v_target_a::text;
  if v_count <> 2 then
    raise exception 'FAIL audit event count: %', v_count;
  end if;

  select count(*)::integer into v_count
  from public.activity_log
  where tenant_id = v_tenant_a;
  if v_count <> v_audit_before + 2 then
    raise exception 'FAIL duplicate membership audit: before %, after %',
      v_audit_before,
      v_count;
  end if;

  -- The former owner cannot race/retry after losing owner authority.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant_a, v_target_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL former owner retry: expected 42501 got %', v_sqlstate;
  end if;

  -- An admin can never initiate a transfer.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_admin_b::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant_b, v_staff_b);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL admin transfer: expected 42501 got %', v_sqlstate;
  end if;

  -- Inactive target: fail before any role is changed.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant_b, v_inactive_b);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'GTO02' then
    raise exception 'FAIL inactive target: expected GTO02 got %', v_sqlstate;
  end if;

  select role into v_role
  from public.memberships
  where tenant_id = v_tenant_b and user_id = v_owner_b;
  if v_role is distinct from 'owner' then
    raise exception 'FAIL inactive target changed current owner: %', v_role;
  end if;

  -- Cross-tenant destination is not resolved through a global user lookup.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant_b, v_target_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'P0002' then
    raise exception 'FAIL cross tenant: expected P0002 got %', v_sqlstate;
  end if;

  select role into v_role
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_target_a;
  if v_role is distinct from 'owner' then
    raise exception 'FAIL cross tenant changed tenant A owner: %', v_role;
  end if;

  -- A transfer must point to a different active membership.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant_b, v_owner_b);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL self transfer: expected 22023 got %', v_sqlstate;
  end if;

  -- Owner remains unavailable to the ordinary invitation/role path.
  if public.is_invitable_membership_role('owner') then
    raise exception 'FAIL owner became invitable';
  end if;

  select pg_get_functiondef(
    'public.transfer_tenant_ownership(uuid,uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.lower(v_definition) not like '%pg_advisory_xact_lock%'
     or pg_catalog.lower(v_definition) not like '%for update%' then
    raise exception 'FAIL concurrency locks missing';
  end if;

  raise notice 'PASS Phase 38 tenant ownership transfer';
end;
$phase38$;

rollback;
