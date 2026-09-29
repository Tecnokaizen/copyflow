-- Ownership transfer V1. Fixture data only. Does not mutate DEMO or SUR4.
begin;

do $phase38$
declare
  v_owner uuid := 'a3800000-0000-4000-8000-000000000001';
  v_admin uuid := 'a3800000-0000-4000-8000-000000000002';
  v_manager uuid := 'a3800000-0000-4000-8000-000000000003';
  v_staff uuid := 'a3800000-0000-4000-8000-000000000004';
  v_viewer uuid := 'a3800000-0000-4000-8000-000000000005';
  v_other_owner uuid := 'a3800000-0000-4000-8000-000000000006';
  v_extra_owner uuid := 'a3800000-0000-4000-8000-000000000007';
  v_inactive uuid := 'a3800000-0000-4000-8000-000000000008';
  v_missing uuid := 'a3800000-0000-4000-8000-000000000009';
  v_foreign uuid := 'a3800000-0000-4000-8000-00000000000a';
  v_tenant uuid := 'a3800000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'a3800000-0000-4000-8000-000000000012';
  v_sqlstate text;
  v_role text;
  v_active boolean;
  v_count integer;
  v_def text;
  v_signature text;
  v_meta jsonb;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', t.slug,
    'user_id', m.user_id,
    'role', m.role,
    'active', m.active
  ) order by t.slug, m.user_id), '[]'::jsonb)
  into v_before
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where t.slug in ('demo', 'sur4');

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  )
  select
    u.id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    u.email,
    crypt('pw', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', u.full_name),
    now(), now(), '', '', '', ''
  from (
    values
      (v_owner, 'owner-a@phase38.test', 'Owner A'),
      (v_admin, 'admin-a@phase38.test', 'Admin A'),
      (v_manager, 'manager-a@phase38.test', 'Manager A'),
      (v_staff, 'staff-a@phase38.test', 'Staff A'),
      (v_viewer, 'viewer-a@phase38.test', 'Viewer A'),
      (v_other_owner, 'owner-b@phase38.test', 'Owner B'),
      (v_extra_owner, 'extra-owner@phase38.test', 'Extra Owner'),
      (v_inactive, 'inactive@phase38.test', 'Inactive'),
      (v_foreign, 'foreign@phase38.test', 'Foreign')
  ) as u(id, email, full_name);

  insert into public.profiles (id, full_name)
  select u.id, u.full_name
  from (
    values
      (v_owner, 'Owner A'),
      (v_admin, 'Admin A'),
      (v_manager, 'Manager A'),
      (v_staff, 'Staff A'),
      (v_viewer, 'Viewer A'),
      (v_other_owner, 'Owner B'),
      (v_extra_owner, 'Extra Owner'),
      (v_inactive, 'Inactive'),
      (v_foreign, 'Foreign')
  ) as u(id, full_name);

  insert into public.tenants (id, name, slug, active) values
    (v_tenant, 'Phase38 A', 'phase38-tenant-a', true),
    (v_tenant_b, 'Phase38 B', 'phase38-tenant-b', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant, v_owner, 'owner', true),
    (v_tenant, v_admin, 'admin', true),
    (v_tenant, v_manager, 'manager', true),
    (v_tenant, v_staff, 'staff', true),
    (v_tenant, v_viewer, 'viewer', true),
    (v_tenant, v_other_owner, 'admin', true),
    (v_tenant, v_extra_owner, 'owner', true),
    (v_tenant, v_inactive, 'admin', false),
    (v_tenant_b, v_other_owner, 'owner', true),
    (v_tenant_b, v_foreign, 'staff', true);

  if public.actor_can_assign_membership_role('owner', 'owner') then
    raise exception 'phase38: assign role still allows owner';
  end if;
  if public.is_invitable_membership_role('owner') then
    raise exception 'phase38: owner became invitable';
  end if;

  foreach v_signature in array array[
    'public.transfer_tenant_ownership(uuid,uuid)',
    'public.update_tenant_membership_role(uuid,uuid,text)',
    'public.set_tenant_membership_active(uuid,uuid,boolean)'
  ]
  loop
    select pg_get_functiondef(v_signature::regprocedure) into v_def;
    if v_def is null
       or position('gestcopy.membership.tenant:' in v_def) = 0
       or position('gestcopy.ownership.tenant:' in v_def) > 0
       or position('gestcopy.membership.tenant:' in v_def)
          > position('for update' in v_def) then
      raise exception 'phase38: % missing shared membership lock before row locks', v_signature;
    end if;
  end loop;

  select pg_get_functiondef('public.transfer_tenant_ownership(uuid,uuid)'::regprocedure)
  into v_def;
  if v_def not like '%hashtextextended(p_target_user_id::text, 0)%' then
    raise exception 'phase38: transfer lost the target-user advisory lock';
  end if;

  if has_function_privilege('anon', 'public.transfer_tenant_ownership(uuid,uuid)', 'EXECUTE') then
    raise exception 'phase38: anon can execute transfer';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'transfer_tenant_ownership'
      and (
        p.proacl is null
        or exists (
          select 1
          from aclexplode(p.proacl) acl
          where acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception 'phase38: PUBLIC can execute transfer';
  end if;
  if not has_function_privilege('authenticated', 'public.transfer_tenant_ownership(uuid,uuid)', 'EXECUTE') then
    raise exception 'phase38: authenticated cannot execute transfer';
  end if;

  v_sqlstate := null;
  begin
    perform public.transfer_tenant_ownership(v_tenant, v_admin);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '28000' then
    raise exception 'phase38: anonymous expected 28000 got %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';

  v_sqlstate := null;
  begin
    perform public.transfer_tenant_ownership(v_tenant, v_owner);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase38: self transfer expected 42501 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform public.transfer_tenant_ownership(v_tenant, v_foreign);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase38: cross-tenant expected 42501 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform public.transfer_tenant_ownership(v_tenant, v_missing);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase38: missing target expected 42501 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform public.transfer_tenant_ownership(v_tenant, v_inactive);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase38: inactive target expected 42501 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform public.transfer_tenant_ownership(v_tenant, v_extra_owner);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase38: existing same-tenant owner expected 42501 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform public.transfer_tenant_ownership(v_tenant, v_other_owner);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '54000' then
    raise exception 'phase38: owner elsewhere expected 54000 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform public.update_tenant_membership_role(v_tenant, v_admin, 'owner');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'phase38: role rpc expected 22023 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform public.create_tenant_invitation(v_tenant, 'new@phase38.test', 'owner');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'phase38: invitation expected 22023 got %', v_sqlstate;
  end if;

  execute 'reset role';

  foreach v_role in array array['admin', 'manager', 'staff', 'viewer']
  loop
    v_sqlstate := null;
    perform set_config(
      'request.jwt.claim.sub',
      case v_role
        when 'admin' then v_admin
        when 'manager' then v_manager
        when 'staff' then v_staff
        else v_viewer
      end::text,
      true
    );
    execute 'set local role authenticated';
    begin
      perform public.transfer_tenant_ownership(
        v_tenant,
        case when v_role = 'viewer' then v_staff else v_viewer end
      );
    exception when others then
      v_sqlstate := sqlstate;
    end;
    execute 'reset role';
    if v_sqlstate is distinct from '42501' then
      raise exception 'phase38: % transfer expected 42501 got %', v_role, v_sqlstate;
    end if;
  end loop;

  -- A failure after the RPC must not leave the swap committed.
  begin
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant, v_admin);
    raise exception 'phase38 forced failure';
  exception when others then
    execute 'reset role';
    if sqlerrm not like '%phase38 forced failure%' then
      raise;
    end if;
  end;

  select m.role into v_role
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = v_owner;
  if v_role is distinct from 'owner' then
    raise exception 'phase38: partial failure changed actor to %', v_role;
  end if;
  select m.role, m.active into v_role, v_active
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = v_admin;
  if v_role is distinct from 'admin' or v_active is distinct from true then
    raise exception 'phase38: partial failure changed target role=% active=%', v_role, v_active;
  end if;

  -- Failure between promotion and demotion rolls back both updates.
  -- The trigger exists only inside this subtransaction.
  begin
    create function public.phase38_fail_owner_demotion()
    returns trigger
    language plpgsql
    as $fail$
    begin
      if old.role = 'owner' and new.role = 'admin' then
        raise exception 'phase38 injected demotion failure';
      end if;
      return new;
    end;
    $fail$;

    create trigger phase38_fail_owner_demotion
    before update on public.memberships
    for each row
    execute function public.phase38_fail_owner_demotion();

    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant, v_staff);
  exception when others then
    execute 'reset role';
    if sqlerrm not like '%phase38 injected demotion failure%' then
      raise;
    end if;
  end;

  select m.role into v_role
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = v_owner;
  if v_role is distinct from 'owner' then
    raise exception 'phase38: injected demotion committed actor as %', v_role;
  end if;
  select m.role into v_role
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = v_staff;
  if v_role is distinct from 'staff' then
    raise exception 'phase38: injected demotion committed target as %', v_role;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'set local role authenticated';
  v_result := public.transfer_tenant_ownership(v_tenant, v_admin);
  execute 'reset role';

  if (v_result -> 'previous_owner' ->> 'role') is distinct from 'admin'
     or (v_result -> 'new_owner' ->> 'role') is distinct from 'owner'
     or (v_result -> 'new_owner' ->> 'user_id')::uuid is distinct from v_admin
     or (v_result -> 'previous_owner' ->> 'user_id')::uuid is distinct from v_owner then
    raise exception 'phase38: unexpected result %', v_result;
  end if;

  select m.role, m.active into v_role, v_active
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = v_admin;
  if v_role is distinct from 'owner' or v_active is distinct from true then
    raise exception 'phase38: target role=% active=%', v_role, v_active;
  end if;

  select m.role, m.active into v_role, v_active
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = v_owner;
  if v_role is distinct from 'admin' or v_active is distinct from true then
    raise exception 'phase38: actor role=% active=%', v_role, v_active;
  end if;

  select m.role into v_role
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = v_extra_owner;
  if v_role is distinct from 'owner' then
    raise exception 'phase38: extra owner was mutated to %', v_role;
  end if;

  select count(*) into v_count
  from public.activity_log
  where tenant_id = v_tenant
    and action = 'membership.ownership_transferred'
    and entity_id = v_admin;
  if v_count <> 1 then
    raise exception 'phase38: activity rows=%', v_count;
  end if;

  select metadata into v_meta
  from public.activity_log
  where tenant_id = v_tenant
    and action = 'membership.ownership_transferred'
    and entity_id = v_admin;
  if v_meta ->> 'previous_owner_role' is distinct from 'owner'
     or v_meta ->> 'previous_owner_role_after' is distinct from 'admin'
     or v_meta ->> 'target_previous_role' is distinct from 'admin'
     or (v_meta ->> 'previous_owner_user_id')::uuid is distinct from v_owner
     or (v_meta ->> 'new_owner_user_id')::uuid is distinct from v_admin then
    raise exception 'phase38: activity metadata %', v_meta;
  end if;

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    execute 'set local role authenticated';
    perform public.transfer_tenant_ownership(v_tenant, v_viewer);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase38: replay expected 42501 got %', v_sqlstate;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', t.slug,
    'user_id', m.user_id,
    'role', m.role,
    'active', m.active
  ) order by t.slug, m.user_id), '[]'::jsonb)
  into v_after
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where t.slug in ('demo', 'sur4');

  if v_before is distinct from v_after then
    raise exception 'phase38: DEMO or SUR4 memberships changed';
  end if;

  raise notice 'phase38 ownership transfer OK';
end;
$phase38$;

rollback;
