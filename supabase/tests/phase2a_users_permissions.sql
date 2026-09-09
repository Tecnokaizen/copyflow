-- Phase 2A local contract tests (A–S + grants/concurrency/hierarchy).
-- Run against local Supabase after applying the Phase 2A migration.
-- Intended to leave no residual rows when the outer transaction rolls back.
--
-- Expected RED before migration: missing table/functions.
-- Expected GREEN after migration: all assertions pass.

do $phase2a$
declare
  v_owner_a uuid := 'a1000000-0000-4000-8000-000000000001';
  v_admin_a uuid := 'a1000000-0000-4000-8000-000000000002';
  v_staff_a uuid := 'a1000000-0000-4000-8000-000000000003';
  v_manager_a uuid := 'a1000000-0000-4000-8000-000000000004';
  v_viewer_a uuid := 'a1000000-0000-4000-8000-000000000005';
  v_invitee_admin uuid := 'a1000000-0000-4000-8000-000000000011';
  v_invitee_staff uuid := 'a1000000-0000-4000-8000-000000000012';
  v_invitee_manager uuid := 'a1000000-0000-4000-8000-000000000013';
  v_invitee_other uuid := 'a1000000-0000-4000-8000-000000000014';
  v_invitee_reactivate uuid := 'a1000000-0000-4000-8000-000000000015';
  v_owner_b uuid := 'b1000000-0000-4000-8000-000000000001';
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_result jsonb;
  v_token text;
  v_token2 text;
  v_invitation_id uuid;
  v_invitation_id2 uuid;
  v_err text;
  v_sqlstate text;
  v_count integer;
  v_role text;
  v_active boolean;
begin
  -- Fixtures ---------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Admin A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_manager_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager-a@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Manager A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'invitee-admin@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Invitee Admin"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'invitee-staff@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Invitee Staff"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'invitee-manager@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Invitee Manager"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'invitee-other@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Invitee Other"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee_reactivate, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'invitee-reactivate@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Invitee Reactivate"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase2a.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_admin_a, 'Admin A'),
    (v_staff_a, 'Staff A'),
    (v_manager_a, 'Manager A'),
    (v_viewer_a, 'Viewer A'),
    (v_invitee_reactivate, 'Invitee Reactivate'),
    (v_owner_b, 'Owner B');

  v_tenant_a := 'a2000000-0000-4000-8000-000000000001';
  v_tenant_b := 'b2000000-0000-4000-8000-000000000001';

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase2A', 'tenant-a-phase2a', true),
    (v_tenant_b, 'Tenant B Phase2A', 'tenant-b-phase2a', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_manager_a, 'manager', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_a, v_invitee_reactivate, 'staff', false),
    (v_tenant_b, v_owner_b, 'owner', true);

  -- Grants / RLS closed for tenant_invitations --------------------------------
  if has_table_privilege('authenticated', 'public.tenant_invitations', 'SELECT')
     or has_table_privilege('authenticated', 'public.tenant_invitations', 'INSERT')
     or has_table_privilege('authenticated', 'public.tenant_invitations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.tenant_invitations', 'DELETE')
     or has_table_privilege('authenticated', 'public.tenant_invitations', 'TRUNCATE') then
    raise exception 'FAIL grants: authenticated must not have direct privileges on tenant_invitations';
  end if;

  if has_table_privilege('anon', 'public.tenant_invitations', 'SELECT')
     or has_table_privilege('anon', 'public.tenant_invitations', 'INSERT') then
    raise exception 'FAIL grants: anon must not access tenant_invitations';
  end if;

  -- Dead DML policies removed; SELECT remains ---------------------------------
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'memberships'
      and policyname in ('memberships_insert_owner_admin', 'memberships_update_owner_admin')
  ) then
    raise exception 'FAIL policies: dead memberships DML policies still present';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'memberships'
      and policyname = 'memberships_select_same_tenant'
  ) then
    raise exception 'FAIL policies: memberships_select_same_tenant missing';
  end if;

  -- A. owner invita admin -----------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, '  Invitee-Admin@Phase2A.TEST ', 'admin'
  );
  execute 'reset role';
  v_token := v_result ->> 'token';
  v_invitation_id := (v_result ->> 'invitation_id')::uuid;
  if v_token is null or length(v_token) <> 64 then
    raise exception 'FAIL A: token missing or wrong length';
  end if;
  if (v_result ->> 'role') <> 'admin'
     or (v_result ->> 'email') <> 'invitee-admin@phase2a.test' then
    raise exception 'FAIL A: unexpected invitation payload %', v_result;
  end if;
  if v_result ? 'token_hash' then
    raise exception 'FAIL A: token_hash leaked';
  end if;

  -- B. owner invita staff -----------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-staff@phase2a.test', 'staff'
  );
  execute 'reset role';
  if (v_result ->> 'role') <> 'staff' then
    raise exception 'FAIL B';
  end if;
  v_token2 := v_result ->> 'token';

  -- C. admin invita manager ---------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-manager@phase2a.test', 'manager'
  );
  execute 'reset role';
  if (v_result ->> 'role') <> 'manager' then
    raise exception 'FAIL C';
  end if;

  -- D. admin intenta invitar admin --------------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    execute 'set local role authenticated';
    perform public.create_tenant_invitation(
      v_tenant_a, 'blocked-admin@phase2a.test', 'admin'
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL D: expected 42501 got %', v_sqlstate;
  end if;

  -- E. staff intenta invitar --------------------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    execute 'set local role authenticated';
    perform public.create_tenant_invitation(
      v_tenant_a, 'blocked-staff@phase2a.test', 'viewer'
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL E: expected 42501 got %', v_sqlstate;
  end if;

  -- F. invitación owner -------------------------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.create_tenant_invitation(
      v_tenant_a, 'blocked-owner@phase2a.test', 'owner'
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL F: expected 22023 got %', v_sqlstate;
  end if;

  -- G. email ya miembro activo ------------------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.create_tenant_invitation(
      v_tenant_a, 'staff-a@phase2a.test', 'viewer'
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'FAIL G: expected 23505 got %', v_sqlstate;
  end if;

  -- H. pending duplicada -> supersede ----------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-staff@phase2a.test', 'viewer'
  );
  execute 'reset role';
  if (v_result ->> 'role') <> 'viewer' then
    raise exception 'FAIL H: supersede role not applied';
  end if;
  select count(*) into v_count
  from public.tenant_invitations
  where tenant_id = v_tenant_a
    and email_normalized = 'invitee-staff@phase2a.test'
    and status = 'pending';
  if v_count <> 1 then
    raise exception 'FAIL H: expected exactly one pending, got %', v_count;
  end if;
  select count(*) into v_count
  from public.tenant_invitations
  where tenant_id = v_tenant_a
    and email_normalized = 'invitee-staff@phase2a.test'
    and status = 'superseded';
  if v_count < 1 then
    raise exception 'FAIL H: previous invitation not superseded';
  end if;
  v_token2 := v_result ->> 'token';
  v_invitation_id2 := (v_result ->> 'invitation_id')::uuid;

  -- I. aceptación token correcto + mismo email --------------------------------
  -- recreate clean staff invite for accept path
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-admin@phase2a.test', 'admin'
  );
  execute 'reset role';
  v_token := v_result ->> 'token';

  perform set_config('request.jwt.claim.sub', v_invitee_admin::text, true);
  execute 'set local role authenticated';
  v_result := public.accept_tenant_invitation(v_token);
  execute 'reset role';
  if (v_result #>> '{tenant,slug}') <> 'tenant-a-phase2a'
     or (v_result #>> '{membership,role}') <> 'admin' then
    raise exception 'FAIL I: %', v_result;
  end if;
  if not exists (
    select 1 from public.profiles where id = v_invitee_admin
  ) then
    raise exception 'FAIL I: profile not created';
  end if;

  -- J. token correcto + otro email --------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-manager@phase2a.test', 'manager'
  );
  execute 'reset role';
  v_token := v_result ->> 'token';

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_invitee_other::text, true);
    execute 'set local role authenticated';
    perform public.accept_tenant_invitation(v_token);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL J: expected 42501 got %', v_sqlstate;
  end if;

  -- K. token expirado ---------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-other@phase2a.test', 'staff'
  );
  execute 'reset role';
  v_token := v_result ->> 'token';
  v_invitation_id := (v_result ->> 'invitation_id')::uuid;
  update public.tenant_invitations
  set expires_at = now() - interval '1 minute'
  where id = v_invitation_id;

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_invitee_other::text, true);
    execute 'set local role authenticated';
    perform public.accept_tenant_invitation(v_token);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL K: expected 22023 got %', v_sqlstate;
  end if;

  -- L. token revocado ---------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-other@phase2a.test', 'viewer'
  );
  v_invitation_id := (v_result ->> 'invitation_id')::uuid;
  v_token := v_result ->> 'token';
  perform public.revoke_tenant_invitation(v_invitation_id);
  execute 'reset role';

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_invitee_other::text, true);
    execute 'set local role authenticated';
    perform public.accept_tenant_invitation(v_token);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate not in ('P0002', '22023', '42501') then
    raise exception 'FAIL L: expected blocked accept got %', v_sqlstate;
  end if;

  -- M. doble aceptación no duplica --------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-staff@phase2a.test', 'staff'
  );
  execute 'reset role';
  v_token := v_result ->> 'token';

  perform set_config('request.jwt.claim.sub', v_invitee_staff::text, true);
  execute 'set local role authenticated';
  perform public.accept_tenant_invitation(v_token);
  v_sqlstate := null;
  begin
    perform public.accept_tenant_invitation(v_token);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '23505' then
    raise exception 'FAIL M: expected 23505 on double accept got %', v_sqlstate;
  end if;
  select count(*) into v_count
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_invitee_staff;
  if v_count <> 1 then
    raise exception 'FAIL M: duplicated membership count=%', v_count;
  end if;

  -- N. usuario ya miembro de OTRO tenant --------------------------------------
  -- invitee-staff is member of A; invite to B as viewer
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_b, 'invitee-staff@phase2a.test', 'viewer'
  );
  v_token := v_result ->> 'token';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_invitee_staff::text, true);
  execute 'set local role authenticated';
  v_result := public.accept_tenant_invitation(v_token);
  execute 'reset role';
  if (v_result #>> '{tenant,id}') <> v_tenant_b::text
     or (v_result #>> '{membership,role}') <> 'viewer' then
    raise exception 'FAIL N: %', v_result;
  end if;

  -- O. membership inactive -> reactivación ------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'invitee-reactivate@phase2a.test', 'manager'
  );
  v_token := v_result ->> 'token';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_invitee_reactivate::text, true);
  execute 'set local role authenticated';
  v_result := public.accept_tenant_invitation(v_token);
  execute 'reset role';
  select role, active into v_role, v_active
  from public.memberships
  where tenant_id = v_tenant_a and user_id = v_invitee_reactivate;
  if v_role <> 'manager' or v_active is not true then
    raise exception 'FAIL O: role=% active=%', v_role, v_active;
  end if;

  -- P. owner cambia staff -> manager ------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.update_tenant_membership_role(
    v_tenant_a, v_staff_a, 'manager'
  );
  execute 'reset role';
  if (v_result #>> '{membership,role}') <> 'manager' then
    raise exception 'FAIL P: %', v_result;
  end if;

  -- Q. admin intenta modificar admin ------------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    execute 'set local role authenticated';
    perform public.update_tenant_membership_role(
      v_tenant_a, v_invitee_admin, 'staff'
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL Q: expected 42501 got %', v_sqlstate;
  end if;

  -- R. nadie puede crear/promover owner ---------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.update_tenant_membership_role(
      v_tenant_a, v_staff_a, 'owner'
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL R role: expected 22023 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.set_tenant_membership_active(
      v_tenant_a, v_owner_a, false
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL R self-owner: expected 42501 got %', v_sqlstate;
  end if;

  -- S. tenant A no gestiona tenant B ------------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.create_tenant_invitation(
      v_tenant_b, 'cross-tenant@phase2a.test', 'staff'
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL S create: expected 42501 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    execute 'set local role authenticated';
    perform public.list_tenant_access(v_tenant_b);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL S list: expected 42501 got %', v_sqlstate;
  end if;

  -- list_tenant_access shape + no token leak ----------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.list_tenant_access(v_tenant_a);
  execute 'reset role';
  if jsonb_typeof(v_result -> 'memberships') <> 'array'
     or jsonb_typeof(v_result -> 'invitations') <> 'array' then
    raise exception 'FAIL list shape: %', v_result;
  end if;
  if v_result::text ilike '%token_hash%' or v_result::text ilike '%"token"%' then
    raise exception 'FAIL list leaked token material';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(v_result -> 'memberships') m
    where m ->> 'email' = 'owner-a@phase2a.test'
  ) then
    raise exception 'FAIL list missing auth email';
  end if;

  -- resend rotates token ------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'resend-target@phase2a.test', 'viewer'
  );
  v_invitation_id := (v_result ->> 'invitation_id')::uuid;
  v_token := v_result ->> 'token';
  v_result := public.resend_tenant_invitation(v_invitation_id);
  execute 'reset role';
  v_token2 := v_result ->> 'token';
  if v_token2 is null or v_token2 = v_token then
    raise exception 'FAIL resend: token not rotated';
  end if;
  if (v_result ->> 'send_attempts')::int < 2 then
    raise exception 'FAIL resend: send_attempts not incremented';
  end if;

  v_sqlstate := null;
  begin
    -- old token must fail; no user with that email, but expired/invalid hash
    perform set_config('request.jwt.claim.sub', v_invitee_other::text, true);
    execute 'set local role authenticated';
    perform public.accept_tenant_invitation(v_token);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is null then
    raise exception 'FAIL resend: old token still accepted';
  end if;

  -- unique pending constraint race (same session sequential proof) ------------
  insert into public.tenant_invitations (
    tenant_id, email, email_normalized, role, token_hash, status,
    invited_by_user_id, expires_at, send_attempts, last_sent_at
  ) values (
    v_tenant_a,
    'race@phase2a.test',
    'race@phase2a.test',
    'staff',
    extensions.digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'sha256'),
    'pending',
    v_owner_a,
    now() + interval '7 days',
    1,
    now()
  );

  begin
    insert into public.tenant_invitations (
      tenant_id, email, email_normalized, role, token_hash, status,
      invited_by_user_id, expires_at, send_attempts, last_sent_at
    ) values (
      v_tenant_a,
      'race@phase2a.test',
      'race@phase2a.test',
      'viewer',
      extensions.digest('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'sha256'),
      'pending',
      v_owner_a,
      now() + interval '7 days',
      1,
      now()
    );
    raise exception 'FAIL unique pending: second insert should have failed';
  exception
    when unique_violation then
      null;
  end;

  select count(*) into v_count
  from public.tenant_invitations
  where tenant_id = v_tenant_a
    and email_normalized = 'race@phase2a.test'
    and status = 'pending';
  if v_count <> 1 then
    raise exception 'FAIL unique pending count=%', v_count;
  end if;

  -- onboarding still works after dropping dead policies -----------------------
  perform set_config('request.jwt.claim.sub', v_invitee_other::text, true);
  execute 'set local role authenticated';
  v_result := public.create_organization(
    'Phase2A Onboarding Org',
    'phase2a-onboarding-org',
    'Europe/Madrid'
  );
  execute 'reset role';
  if (v_result ->> 'slug') is distinct from 'phase2a-onboarding-org' then
    raise exception 'FAIL onboarding: %', v_result;
  end if;

  raise exception 'PASS Phase 2A scenarios A–S + grants/unique/onboarding';
end;
$phase2a$;
