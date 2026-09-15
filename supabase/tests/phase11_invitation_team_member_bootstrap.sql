-- Invitation Personal self-bootstrap vs RLS and trigger UPDATE rules.
-- Run after 20260915143000_invitation_team_member_bootstrap.sql.

do $phase11$
declare
  v_owner uuid := 'ab000000-0000-4000-8000-000000000001';
  v_admin uuid := 'ab000000-0000-4000-8000-000000000002';
  v_manager uuid := 'ab000000-0000-4000-8000-000000000003';
  v_staff uuid := 'ab000000-0000-4000-8000-000000000004';
  v_viewer uuid := 'ab000000-0000-4000-8000-000000000005';
  v_other uuid := 'ab000000-0000-4000-8000-000000000006';
  v_owner_b uuid := 'ab000000-0000-4000-8000-000000000007';
  v_tenant_a uuid := 'ab000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'ab000000-0000-4000-8000-000000000012';
  v_result jsonb;
  v_token text;
  v_member_id uuid;
  v_count integer;
  v_role text;
  v_status text;
  v_sqlstate text;
  v_actor uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase11.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase11.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Admin A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager-a@phase11.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Manager A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase11.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase11.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'other-a@phase11.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Other A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase11.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner, 'Owner A'),
    (v_admin, 'Admin A'),
    (v_manager, 'Manager A'),
    (v_staff, 'Staff A'),
    (v_viewer, 'Viewer A'),
    (v_other, 'Other A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase11', 'tenant-a-phase11', true),
    (v_tenant_b, 'Tenant B Phase11', 'tenant-b-phase11', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner, 'owner', true),
    (v_tenant_a, v_admin, 'admin', true),
    (v_tenant_a, v_manager, 'manager', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'staff-a@phase11.test', 'staff', 'Staff A', true
  );
  execute 'reset role';
  v_token := v_result ->> 'token';

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  execute 'set local role authenticated';
  v_result := public.accept_tenant_invitation(v_token);
  execute 'reset role';

  if (v_result #>> '{membership,role}') is distinct from 'staff'
     or (v_result ->> 'team_member_id') is null then
    raise exception 'FAIL 1 accept staff personal: %', v_result;
  end if;

  select m.role into v_role
  from public.memberships m
  where m.tenant_id = v_tenant_a and m.user_id = v_staff and m.active = true;
  if v_role is distinct from 'staff' then
    raise exception 'FAIL 2 membership staff: %', v_role;
  end if;

  select tm.id into v_member_id
  from public.team_members tm
  where tm.tenant_id = v_tenant_a and tm.user_id = v_staff;
  if v_member_id is null then
    raise exception 'FAIL 3 team_member not linked';
  end if;
  if (v_result ->> 'team_member_id') is distinct from v_member_id::text then
    raise exception 'FAIL 3 team_member_id mismatch';
  end if;

  select i.status into v_status
  from public.tenant_invitations i
  where i.token_hash = public.hash_invitation_token(v_token);
  if v_status is distinct from 'accepted' then
    raise exception 'FAIL 4 invitation status: %', v_status;
  end if;

  select count(*), min(al.user_id)
  into v_count, v_actor
  from public.activity_log al
  where al.tenant_id = v_tenant_a
    and al.action = 'team_member.created'
    and al.entity_id = v_member_id;
  if v_count <> 1 or v_actor is distinct from v_staff then
    raise exception 'FAIL 5 activity_log actor=% count=%', v_actor, v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    insert into public.team_members (
      tenant_id, name, email, active, can_receive_orders
    ) values (
      v_tenant_a, 'Staff extra', 'staff-extra@phase11.test', true, true
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL 6 staff direct insert RLS: %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  v_sqlstate := null;
  begin
    insert into public.team_members (
      tenant_id, user_id, name, email, active, can_receive_orders
    ) values (
      v_tenant_a, v_other, 'Otro bootstrap', 'other-a@phase11.test', true, true
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL 7 staff bootstrap other user: %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  insert into public.team_members (
    tenant_id, name, active, can_receive_orders
  ) values (
    v_tenant_a, 'Ficha owner', true, true
  );
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  insert into public.team_members (
    tenant_id, name, active, can_receive_orders
  ) values (
    v_tenant_a, 'Ficha admin', true, true
  );
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  execute 'set local role authenticated';
  insert into public.team_members (
    tenant_id, name, active, can_receive_orders
  ) values (
    v_tenant_a, 'Ficha manager', true, true
  );
  execute 'reset role';

  select count(*) into v_count
  from public.team_members tm
  where tm.tenant_id = v_tenant_a
    and tm.name in ('Ficha owner', 'Ficha admin', 'Ficha manager');
  if v_count <> 3 then
    raise exception 'FAIL 8 management create Personal: %', v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  execute 'set local role authenticated';
  update public.team_members
  set name = 'Staff hack'
  where id = v_member_id;
  get diagnostics v_count = row_count;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FAIL 9 staff update RLS row_count=%', v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  v_sqlstate := null;
  begin
    update public.team_members
    set name = 'Staff trigger hack'
    where id = v_member_id;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL 9 staff update trigger: %', v_sqlstate;
  end if;

  select tm.name into v_status
  from public.team_members tm
  where tm.id = v_member_id;
  if v_status is distinct from 'Staff A' then
    raise exception 'FAIL 9 name mutated: %', v_status;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    insert into public.team_members (
      tenant_id, name, active, can_receive_orders
    ) values (
      v_tenant_a, 'Cross tenant', true, true
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL 10 tenant isolation insert: %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'viewer-a@phase11.test', 'viewer', 'Viewer A', true
  );
  execute 'reset role';
  v_token := v_result ->> 'token';

  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  execute 'set local role authenticated';
  v_result := public.accept_tenant_invitation(v_token);
  execute 'reset role';

  if (v_result #>> '{membership,role}') is distinct from 'viewer'
     or (v_result ->> 'team_member_id') is null then
    raise exception 'FAIL viewer self-bootstrap: %', v_result;
  end if;

  select count(*) into v_count
  from public.team_members tm
  where tm.tenant_id = v_tenant_a and tm.user_id = v_viewer;
  if v_count <> 1 then
    raise exception 'FAIL viewer team_member count %', v_count;
  end if;

  select pg_get_expr(pol.polwithcheck, pol.polrelid)
  into v_status
  from pg_policy pol
  join pg_class rel on rel.oid = pol.polrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'team_members'
    and pol.polname = 'team_members_insert_management';
  if v_status is null
     or v_status not like '%owner%'
     or v_status not like '%admin%'
     or v_status not like '%manager%'
     or v_status like '%staff%'
     or v_status like '%viewer%' then
    raise exception 'FAIL RLS insert policy relaxed: %', v_status;
  end if;

  raise exception 'PASS Phase 11 invitation team_member bootstrap';
end;
$phase11$;
