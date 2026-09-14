-- Preview + GTI01 contract for invitation direct signup.
-- Run against local Supabase after applying 20260914220000_invitation_preview_and_email_mismatch.sql.

do $phase9$
declare
  v_owner uuid := 'a9000000-0000-4000-8000-000000000001';
  v_other uuid := 'a9000000-0000-4000-8000-000000000002';
  v_tenant_a uuid := 'a9000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'a9000000-0000-4000-8000-000000000012';
  v_result jsonb;
  v_token text;
  v_token_b text;
  v_sqlstate text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase9.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'otro@phase9.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Otro"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner, 'Owner A'),
    (v_other, 'Otro');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase9', 'tenant-a-phase9', true),
    (v_tenant_b, 'Tenant B Phase9', 'tenant-b-phase9', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner, 'owner', true),
    (v_tenant_b, v_owner, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'reservas@phase9.test', 'staff', 'Reservas', true
  );
  execute 'reset role';
  v_token := v_result ->> 'token';

  v_result := public.preview_tenant_invitation(v_token);
  if (v_result ->> 'status') is distinct from 'pending'
     or (v_result ->> 'email') is distinct from 'reservas@phase9.test'
     or (v_result ->> 'account_exists') is distinct from 'false'
     or (v_result #>> '{tenant,slug}') is distinct from 'tenant-a-phase9'
     or v_result ? 'auth_user_id' then
    raise exception 'FAIL preview new user: %', v_result;
  end if;

  if public.resolve_invitation_auth_user(v_token) is not null then
    raise exception 'FAIL resolve new email should be null';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_b, 'reservas-b@phase9.test', 'viewer', null, false
  );
  execute 'reset role';
  v_token_b := v_result ->> 'token';
  v_result := public.preview_tenant_invitation(v_token_b);
  if (v_result #>> '{tenant,slug}') is distinct from 'tenant-b-phase9'
     or (v_result #>> '{tenant,slug}') = 'tenant-a-phase9' then
    raise exception 'FAIL tenant isolation: %', v_result;
  end if;

  v_result := public.preview_tenant_invitation(repeat('c', 64));
  if (v_result ->> 'status') is distinct from 'not_found' then
    raise exception 'FAIL invalid token: %', v_result;
  end if;

  perform set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.accept_tenant_invitation(v_token);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from 'GTI01' then
    raise exception 'FAIL mismatch code: %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'otro@phase9.test', 'staff', 'Otro', false
  );
  execute 'reset role';
  if public.resolve_invitation_auth_user(v_result ->> 'token') is distinct from v_other then
    raise exception 'FAIL resolve existing user';
  end if;

  execute 'set local role anon';
  v_sqlstate := null;
  begin
    perform public.resolve_invitation_auth_user(v_token);
  exception when insufficient_privilege then
    v_sqlstate := '42501';
  when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL anon must not resolve auth user: %', v_sqlstate;
  end if;

  update public.tenant_invitations
  set expires_at = now() - interval '1 minute'
  where token_hash = public.hash_invitation_token(v_token);
  v_result := public.preview_tenant_invitation(v_token);
  if (v_result ->> 'status') is distinct from 'expired'
     or v_result ? 'email' then
    raise exception 'FAIL expired preview: %', v_result;
  end if;

  raise exception 'PASS Phase 9 invitation preview + GTI01';
end;
$phase9$;
