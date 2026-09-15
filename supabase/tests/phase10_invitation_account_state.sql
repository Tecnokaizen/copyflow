-- Account state for invitation preview: membership, not auth.users existence.
-- Run after 20260915130000_invitation_account_state.sql.

do $phase10$
declare
  v_owner uuid := 'aa000000-0000-4000-8000-000000000001';
  v_member uuid := 'aa000000-0000-4000-8000-000000000002';
  v_orphan_confirmed uuid := 'aa000000-0000-4000-8000-000000000003';
  v_orphan_unconfirmed uuid := 'aa000000-0000-4000-8000-000000000004';
  v_tenant_a uuid := 'aa000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'aa000000-0000-4000-8000-000000000012';
  v_result jsonb;
  v_token_new text;
  v_token_orphan_c text;
  v_token_orphan_u text;
  v_token_member text;
  v_sqlstate text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase10.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_member, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'miembro@phase10.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Miembro"}'::jsonb, now(), now(), '', '', '', ''),
    (v_orphan_confirmed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'reservas@phase10.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Reservas"}'::jsonb, now(), now(), '', '', '', ''),
    (v_orphan_unconfirmed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'huerfano@phase10.test', crypt('pw', gen_salt('bf')), null,
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Huerfano"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner, 'Owner A'),
    (v_member, 'Miembro'),
    (v_orphan_confirmed, 'Reservas'),
    (v_orphan_unconfirmed, 'Huerfano');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase10', 'tenant-a-phase10', true),
    (v_tenant_b, 'Tenant B Phase10', 'tenant-b-phase10', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner, 'owner', true),
    (v_tenant_b, v_owner, 'owner', true),
    (v_tenant_b, v_member, 'staff', true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'nuevo@phase10.test', 'staff', 'Nuevo', true
  );
  execute 'reset role';
  v_token_new := v_result ->> 'token';

  v_result := public.preview_tenant_invitation(v_token_new);
  if (v_result ->> 'status') is distinct from 'pending'
     or (v_result ->> 'email') is distinct from 'nuevo@phase10.test'
     or (v_result ->> 'requires_login') is distinct from 'false'
     or v_result ? 'auth_user_id'
     or v_result ? 'account_exists'
     or v_result ? 'email_confirmed' then
    raise exception 'FAIL preview new user: %', v_result;
  end if;

  if public.resolve_invitation_auth_user(v_token_new) is not null then
    raise exception 'FAIL resolve new email should be null';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'reservas@phase10.test', 'staff', 'Reservas', true
  );
  execute 'reset role';
  v_token_orphan_c := v_result ->> 'token';

  v_result := public.preview_tenant_invitation(v_token_orphan_c);
  if (v_result ->> 'requires_login') is distinct from 'false'
     or (v_result ->> 'email') is distinct from 'reservas@phase10.test'
     or v_result ? 'auth_user_id' then
    raise exception 'FAIL confirmed orphan must activate: %', v_result;
  end if;

  if public.resolve_invitation_auth_user(v_token_orphan_c) is distinct from v_orphan_confirmed then
    raise exception 'FAIL resolve confirmed orphan';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'huerfano@phase10.test', 'viewer', 'Huerfano', false
  );
  execute 'reset role';
  v_token_orphan_u := v_result ->> 'token';

  v_result := public.preview_tenant_invitation(v_token_orphan_u);
  if (v_result ->> 'requires_login') is distinct from 'false'
     or v_result ? 'auth_user_id' then
    raise exception 'FAIL unconfirmed orphan must activate: %', v_result;
  end if;

  if public.resolve_invitation_auth_user(v_token_orphan_u) is distinct from v_orphan_unconfirmed then
    raise exception 'FAIL resolve unconfirmed orphan';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant_a, 'miembro@phase10.test', 'manager', 'Miembro', false
  );
  execute 'reset role';
  v_token_member := v_result ->> 'token';

  v_result := public.preview_tenant_invitation(v_token_member);
  if (v_result ->> 'requires_login') is distinct from 'true'
     or (v_result ->> 'email') is distinct from 'miembro@phase10.test'
     or v_result ? 'auth_user_id'
     or v_result ? 'account_exists' then
    raise exception 'FAIL confirmed member must login: %', v_result;
  end if;

  execute 'set local role anon';
  v_result := public.preview_tenant_invitation(v_token_orphan_c);
  execute 'reset role';
  if (v_result ->> 'requires_login') is distinct from 'false'
     or v_result ? 'auth_user_id' then
    raise exception 'FAIL anon preview must not leak auth_user_id: %', v_result;
  end if;

  execute 'set local role anon';
  v_sqlstate := null;
  begin
    perform public.resolve_invitation_auth_user(v_token_orphan_c);
  exception when insufficient_privilege then
    v_sqlstate := '42501';
  when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL anon must not resolve auth user: %', v_sqlstate;
  end if;

  raise exception 'PASS Phase 10 invitation account state';
end;
$phase10$;
