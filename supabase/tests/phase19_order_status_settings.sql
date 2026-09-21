-- Settings V1 · order status catalog invariants (set-initial RPC).
-- Run after 20260921140000_order_status_set_initial_v1.sql.

begin;

do $phase19$
declare
  v_owner_a uuid := 'e1900000-0000-4000-8000-000000000001';
  v_admin_a uuid := 'e1900000-0000-4000-8000-000000000004';
  v_manager_a uuid := 'e1900000-0000-4000-8000-000000000005';
  v_staff_a uuid := 'e1900000-0000-4000-8000-000000000002';
  v_viewer_a uuid := 'e1900000-0000-4000-8000-000000000006';
  v_owner_b uuid := 'e1900000-0000-4000-8000-000000000003';
  v_tenant_a uuid := 'e1900000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e1900000-0000-4000-8000-000000000012';
  v_initial_id uuid;
  v_ready_id uuid;
  v_progress_id uuid;
  v_inactive_id uuid;
  v_foreign_id uuid;
  v_result jsonb;
  v_count integer;
  v_sqlstate text;
  v_message text;
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
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_manager_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager-a@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase19.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_admin_a, 'Admin A'),
    (v_manager_a, 'Manager A'),
    (v_staff_a, 'Staff A'),
    (v_viewer_a, 'Viewer A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase19', 'tenant-a-phase19', true),
    (v_tenant_b, 'Tenant B Phase19', 'tenant-b-phase19', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_manager_a, 'manager', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  -- Seed each tenant with exactly one active initial (organization bootstrap style).
  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    (gen_random_uuid(), v_tenant_a, 'Recibido', 'received', true, false, false, false, true, 1),
    (gen_random_uuid(), v_tenant_b, 'Recibido', 'received', true, false, false, false, true, 1);

  select id into v_initial_id
  from public.order_statuses
  where tenant_id = v_tenant_a and is_initial = true;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  -- A) Create non-initial statuses.
  v_result := public.create_order_status_catalog(
    v_tenant_a, 'Listo', 'ready', 'ready', true, 2
  );
  v_ready_id := (v_result #>> '{status,id}')::uuid;

  v_result := public.create_order_status_catalog(
    v_tenant_a, 'En proceso', 'in_progress', 'in_progress', true, 3
  );
  v_progress_id := (v_result #>> '{status,id}')::uuid;

  select count(*) into v_count
  from public.order_statuses
  where tenant_id = v_tenant_a and is_initial = true and active = true;

  if v_count <> 1 then
    raise exception 'FAIL A expected exactly one active initial, got %', v_count;
  end if;

  -- A2) Creating with kind=initial is rejected.
  v_sqlstate := null;
  v_message := null;
  begin
    perform public.create_order_status_catalog(
      v_tenant_a, 'Otro inicial', 'other_initial', 'initial', true, 0
    );
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;

  if v_sqlstate is distinct from '22023'
     or position('initial_status_must_use_set_initial' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL A2 expected create initial rejection, got % / %', v_sqlstate, v_message;
  end if;

  -- B) Atomic set-initial A → B.
  v_result := public.set_order_status_initial(v_tenant_a, v_ready_id);

  if (v_result #>> '{status,id}')::uuid is distinct from v_ready_id then
    raise exception 'FAIL B wrong new initial id';
  end if;

  if (v_result #>> '{status,is_initial}')::boolean is not true
     or (v_result #>> '{status,active}')::boolean is not true then
    raise exception 'FAIL B new initial must be active initial';
  end if;

  if exists (
    select 1 from public.order_statuses
    where id = v_initial_id and is_initial = true
  ) then
    raise exception 'FAIL B previous initial flag was not cleared';
  end if;

  select count(*) into v_count
  from public.order_statuses
  where tenant_id = v_tenant_a and is_initial = true and active = true;

  if v_count <> 1 then
    raise exception 'FAIL B expected exactly one active initial, got %', v_count;
  end if;

  -- C) Cannot deactivate the current initial via update RPC.
  v_sqlstate := null;
  v_message := null;
  begin
    perform public.update_order_status_catalog(
      v_tenant_a, v_ready_id, 'Listo', 'ready', false, 2
    );
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;

  if v_sqlstate is distinct from '23514'
     or position('initial_status_cannot_be_deactivated' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL C expected deactivate denial, got % / %', v_sqlstate, v_message;
  end if;

  -- D) PATCH kind=initial on non-initial must use set-initial.
  v_sqlstate := null;
  v_message := null;
  begin
    perform public.update_order_status_catalog(
      v_tenant_a, v_progress_id, 'En proceso', 'initial', true, 3
    );
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;

  if v_sqlstate is distinct from '22023'
     or position('initial_status_must_use_set_initial' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL D expected set-initial required, got % / %', v_sqlstate, v_message;
  end if;

  -- E) Inactive cannot become initial.
  v_result := public.create_order_status_catalog(
    v_tenant_a, 'Pausa', 'paused', 'in_progress', false, 4
  );
  v_inactive_id := (v_result #>> '{status,id}')::uuid;

  v_sqlstate := null;
  v_message := null;
  begin
    perform public.set_order_status_initial(v_tenant_a, v_inactive_id);
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;

  if v_sqlstate is distinct from '23514'
     or position('inactive_status_cannot_be_initial' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL E expected inactive denial, got % / %', v_sqlstate, v_message;
  end if;

  -- F) CHECK: initial must stay active (constraint + index still hold).
  v_sqlstate := null;
  begin
    update public.order_statuses
    set active = false
    where id = v_ready_id and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '23514' then
    raise exception 'FAIL F expected CHECK 23514, got %', v_sqlstate;
  end if;

  -- G) Partial unique index still rejects a second initial.
  v_sqlstate := null;
  begin
    update public.order_statuses
    set is_initial = true, active = true, is_ready = false, is_closed = false, is_cancelled = false
    where id = v_progress_id and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '23505' then
    raise exception 'FAIL G expected unique initial index 23505, got %', v_sqlstate;
  end if;

  -- H) Deferred trigger rejects clearing the only initial.
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
    raise exception 'FAIL H expected 23514, got %', v_sqlstate;
  end if;

  -- I) Identity immutability.
  v_sqlstate := null;
  begin
    update public.order_statuses
    set code = 'forged_code'
    where id = v_ready_id and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL I expected 42501, got %', v_sqlstate;
  end if;

  -- J) Inactive status remains readable for tenant members (historical refs).
  if not exists (
    select 1 from public.order_statuses
    where id = v_inactive_id and tenant_id = v_tenant_a and active = false
  ) then
    raise exception 'FAIL J inactive status must remain selectable';
  end if;

  -- K) Staff denied.
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_sqlstate := null;
  begin
    perform public.create_order_status_catalog(
      v_tenant_a, 'Diseño', 'design', 'in_progress', true, 5
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL K expected staff denial 42501, got %', v_sqlstate;
  end if;

  -- L) Viewer denied.
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  v_sqlstate := null;
  begin
    perform public.set_order_status_initial(v_tenant_a, v_progress_id);
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL L expected viewer denial 42501, got %', v_sqlstate;
  end if;

  -- M) Admin can manage.
  perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
  v_result := public.update_order_status_catalog(
    v_tenant_a, v_progress_id, 'En proceso OK', 'in_progress', true, 3
  );
  if (v_result #>> '{status,name}') is distinct from 'En proceso OK' then
    raise exception 'FAIL M admin update failed';
  end if;

  -- N) Manager can set initial.
  perform set_config('request.jwt.claim.sub', v_manager_a::text, true);
  v_result := public.set_order_status_initial(v_tenant_a, v_progress_id);
  if (v_result #>> '{status,id}')::uuid is distinct from v_progress_id then
    raise exception 'FAIL N manager set-initial failed';
  end if;

  select count(*) into v_count
  from public.order_statuses
  where tenant_id = v_tenant_a and is_initial = true and active = true;

  if v_count <> 1 then
    raise exception 'FAIL N expected one active initial after manager switch, got %', v_count;
  end if;

  -- Capture tenant B status id outside RLS before cross-tenant probes.
  execute 'reset role';
  select id into v_foreign_id
  from public.order_statuses
  where tenant_id = v_tenant_b
  limit 1;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  -- O) Cross-tenant management denied (same error class).
  v_sqlstate := null;
  begin
    perform public.set_order_status_initial(v_tenant_b, v_foreign_id);
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL O expected cross-tenant denial 42501, got %', v_sqlstate;
  end if;

  -- P) Foreign status_id under own tenant context → not found (no leak).
  v_sqlstate := null;
  begin
    perform public.set_order_status_initial(v_tenant_a, v_foreign_id);
  exception when others then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from 'P0002' then
    raise exception 'FAIL P expected not found P0002, got %', v_sqlstate;
  end if;

  -- Q) List isolation: owner A cannot see tenant B rows via RLS.
  if exists (
    select 1 from public.order_statuses where tenant_id = v_tenant_b
  ) then
    raise exception 'FAIL Q owner A must not see tenant B statuses via RLS';
  end if;

  execute 'reset role';
end;
$phase19$;

rollback;
