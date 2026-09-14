-- Last owner + independent operative profile contract.
-- Run against local Supabase after applying 20260914190000_team_roles_operative_coherence.sql.

do $phase7$
declare
  v_owner_a uuid := 'a7000000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'a7000000-0000-4000-8000-000000000002';
  v_staff uuid := 'a7000000-0000-4000-8000-000000000003';
  v_owner_other uuid := 'b7000000-0000-4000-8000-000000000001';
  v_tenant_a uuid := 'a7000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'b7000000-0000-4000-8000-000000000011';
  v_sqlstate text;
  v_role text;
  v_count integer;
  v_member_id uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase7.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase7.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase7.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b-tenant@phase7.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner Other"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_owner_b, 'Owner B'),
    (v_staff, 'Staff A'),
    (v_owner_other, 'Owner Other');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase7', 'tenant-a-phase7', true),
    (v_tenant_b, 'Tenant B Phase7', 'tenant-b-phase7', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_staff, 'staff', true),
    (v_tenant_b, v_owner_other, 'owner', true);

  -- Last owner cannot demote themselves.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.update_tenant_membership_role(v_tenant_a, v_owner_a, 'admin');
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'GTO01' then
    raise exception 'FAIL last owner demote: expected GTO01 got %', v_sqlstate;
  end if;

  -- With two owners, one can be demoted. Role change must not touch team_members.
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant_a, v_owner_b, 'owner', true);

  insert into public.team_members (
    tenant_id, user_id, name, job_title, department, active, can_receive_orders
  )
  values (
    v_tenant_a, v_owner_b, 'Rubén', 'Administrador', 'Gestión', true, true
  )
  returning id into v_member_id;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  perform public.update_tenant_membership_role(v_tenant_a, v_owner_b, 'admin');
  execute 'reset role';

  select role into v_role
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_owner_b;
  if v_role is distinct from 'admin' then
    raise exception 'FAIL multi owner demote: role=%', v_role;
  end if;

  select count(*) into v_count
  from public.team_members
  where id = v_member_id
    and name = 'Rubén'
    and job_title = 'Administrador'
    and department = 'Gestión'
    and user_id = v_owner_b;
  if v_count <> 1 then
    raise exception 'FAIL role change mutated team_member';
  end if;

  -- Cross-tenant user_id association is rejected by FK / UNIQUE tenant scope.
  v_sqlstate := null;
  begin
    update public.team_members
    set user_id = v_owner_other
    where id = v_member_id;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'FAIL cross-tenant association: expected 23503 got %', v_sqlstate;
  end if;

  -- Directory is available to managers of the tenant.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  perform public.list_tenant_user_directory(v_tenant_a);
  execute 'reset role';

  raise notice 'phase7 team roles operative OK';
end;
$phase7$;
