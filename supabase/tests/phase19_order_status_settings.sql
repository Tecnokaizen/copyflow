-- Settings V1 · order status catalog invariants and tenant isolation.
-- Run after 20260921130000_order_status_settings_v1.sql.

begin;

do $phase19$
declare
  v_owner_a uuid := 'e1900000-0000-4000-8000-000000000001';
  v_staff_a uuid := 'e1900000-0000-4000-8000-000000000002';
  v_owner_b uuid := 'e1900000-0000-4000-8000-000000000003';
  v_tenant_a uuid := 'e1900000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e1900000-0000-4000-8000-000000000012';
  v_initial_id uuid;
  v_ready_id uuid;
  v_new_initial_id uuid;
  v_result jsonb;
  v_count integer;
  v_sqlstate text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_staff_a, 'Staff A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase19', 'tenant-a-phase19', true),
    (v_tenant_b, 'Tenant B Phase19', 'tenant-b-phase19', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  -- A) First catalog write must establish the tenant initial status.
  v_result := public.create_order_status_catalog(
    v_tenant_a, 'Recibido', 'received', 'initial', true, 1
  );
  v_initial_id := (v_result #>> '{status,id}')::uuid;

  v_result := public.create_order_status_catalog(
    v_tenant_a, 'Listo', 'ready', 'ready', true, 2
  );
  v_ready_id := (v_result #>> '{status,id}')::uuid;

  execute 'set constraints order_statuses_require_initial immediate';
  execute 'set constraints order_statuses_require_initial deferred';

  select count(*) into v_count
  from public.order_statuses
  where tenant_id = v_tenant_a and is_initial = true and active = true;

  if v_count <> 1 then
    raise exception 'FAIL A expected exactly one active initial, got %', v_count;
  end if;

  -- B) Switching the initial status through the RPC is atomic.
  v_result := public.update_order_status_catalog(
    v_tenant_a, v_ready_id, 'Listo', 'initial', true, 2
  );
  v_new_initial_id := (v_result #>> '{status,id}')::uuid;

  if v_new_initial_id is distinct from v_ready_id then
    raise exception 'FAIL B wrong new initial id';
  end if;

  select count(*) into v_count
  from public.order_statuses
  where tenant_id = v_tenant_a and is_initial = true and active = true;

  if v_count <> 1 then
    raise exception 'FAIL B expected exactly one active initial, got %', v_count;
  end if;

  if exists (
    select 1 from public.order_statuses
    where id = v_initial_id and is_initial = true
  ) then
    raise exception 'FAIL B previous initial flag was not cleared';
  end if;

  -- C) Directly removing the only initial is rejected at transaction check.
  v_sqlstate := null;
  begin
    update public.order_statuses
    set is_initial = false
    where id = v_ready_id and tenant_id = v_tenant_a;

    execute 'set constraints order_statuses_require_initial immediate';
  exception when others then
    v_sqlstate := sqlstate;
  end;

  execute 'set constraints order_statuses_require_initial deferred';

  if v_sqlstate is distinct from '23514' then
    raise exception 'FAIL C expected 23514, got %', v_sqlstate;
  end if;

  -- D) Internal identity is immutable to tenant users.
  v_sqlstate := null;
  begin
    update public.order_statuses
    set code = 'forged_code'
    where id = v_ready_id and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL D expected 42501, got %', v_sqlstate;
  end if;

  -- E) Invalid semantic flag combinations are rejected by DB constraint.
  v_sqlstate := null;
  begin
    update public.order_statuses
    set is_initial = false, is_ready = true, is_closed = true
    where id = v_initial_id and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '23514' then
    raise exception 'FAIL E expected 23514, got %', v_sqlstate;
  end if;

  -- F) Staff cannot manage status catalogs.
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_sqlstate := null;
  begin
    perform public.create_order_status_catalog(
      v_tenant_a, 'Diseño', 'design', 'in_progress', true, 3
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL F expected staff denial 42501, got %', v_sqlstate;
  end if;

  -- G) Cross-tenant catalog management is denied.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_sqlstate := null;
  begin
    perform public.create_order_status_catalog(
      v_tenant_b, 'Recibido', 'received', 'initial', true, 1
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL G expected cross-tenant denial 42501, got %', v_sqlstate;
  end if;

  execute 'reset role';
end;
$phase19$;

rollback;
