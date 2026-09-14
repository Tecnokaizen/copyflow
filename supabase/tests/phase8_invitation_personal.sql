-- Invitation name + add_to_personal contract.
-- Run against local Supabase after applying 20260914194305_invitation_add_to_personal.sql.
-- Do not apply that migration remotely until review.

do $phase8$
declare
  v_owner uuid := 'a8000000-0000-4000-8000-000000000001';
  v_invitee uuid := 'a8000000-0000-4000-8000-000000000002';
  v_invitee_off uuid := 'a8000000-0000-4000-8000-000000000003';
  v_tenant uuid := 'a8000000-0000-4000-8000-000000000011';
  v_result jsonb;
  v_token text;
  v_count integer;
  v_name text;
  v_role text;
  v_sqlstate text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase8.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'jesus@phase8.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"jesus"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee_off, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'consultor@phase8.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Consultor"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner, 'Owner A'),
    (v_invitee, 'jesus'),
    (v_invitee_off, 'Consultor');

  insert into public.tenants (id, name, slug, active)
  values (v_tenant, 'Tenant A Phase8', 'tenant-a-phase8', true);

  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant, v_owner, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.create_tenant_invitation(
      v_tenant, 'owner-invite@phase8.test', 'owner', 'Dueño', true
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL owner still invitable: %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant, 'jesus@phase8.test', 'staff', 'Jesús', true
  );
  execute 'reset role';
  v_token := v_result ->> 'token';
  if (v_result ->> 'name') is distinct from 'Jesús'
     or (v_result ->> 'add_to_personal') is distinct from 'true'
     or (v_result ->> 'role') is distinct from 'staff' then
    raise exception 'FAIL invite payload %', v_result;
  end if;

  perform set_config('request.jwt.claim.sub', v_invitee::text, true);
  execute 'set local role authenticated';
  v_result := public.accept_tenant_invitation(v_token);
  execute 'reset role';

  if (v_result #>> '{membership,role}') is distinct from 'staff' then
    raise exception 'FAIL accept role %', v_result;
  end if;

  select count(*), min(tm.name)
  into v_count, v_name
  from public.team_members tm
  where tm.tenant_id = v_tenant
    and tm.user_id = v_invitee;
  if v_count <> 1 or v_name is distinct from 'Jesús' then
    raise exception 'FAIL personal card count=% name=%', v_count, v_name;
  end if;

  perform set_config('request.jwt.claim.sub', v_invitee::text, true);
  execute 'set local role authenticated';
  begin
    perform public.accept_tenant_invitation(v_token);
    execute 'reset role';
    raise exception 'FAIL duplicate accept should fail';
  exception when others then
    execute 'reset role';
  end;

  select count(*) into v_count
  from public.team_members tm
  where tm.tenant_id = v_tenant
    and tm.user_id = v_invitee;
  if v_count <> 1 then
    raise exception 'FAIL duplicated team_member %', v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.create_tenant_invitation(
    v_tenant, 'consultor@phase8.test', 'viewer', 'Consultor', false
  );
  execute 'reset role';
  v_token := v_result ->> 'token';

  perform set_config('request.jwt.claim.sub', v_invitee_off::text, true);
  execute 'set local role authenticated';
  v_result := public.accept_tenant_invitation(v_token);
  execute 'reset role';

  select role into v_role
  from public.memberships
  where tenant_id = v_tenant and user_id = v_invitee_off;
  if v_role is distinct from 'viewer' then
    raise exception 'FAIL access-only role %', v_role;
  end if;

  select count(*) into v_count
  from public.team_members tm
  where tm.tenant_id = v_tenant
    and tm.user_id = v_invitee_off;
  if v_count <> 0 then
    raise exception 'FAIL checkbox false created team_member';
  end if;

  raise notice 'phase8 invitation personal OK';
end;
$phase8$;
