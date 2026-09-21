-- Settings V1 · services catalog integrity (tenant immutable + category FK).
-- Run after 20260921170000_services_catalog_harden_v1.sql.

begin;

do $phase21$
declare
  v_owner_a uuid := 'e2100000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'e2100000-0000-4000-8000-000000000002';
  v_admin_a uuid := 'e2100000-0000-4000-8000-000000000003';
  v_manager_a uuid := 'e2100000-0000-4000-8000-000000000004';
  v_staff_a uuid := 'e2100000-0000-4000-8000-000000000005';
  v_viewer_a uuid := 'e2100000-0000-4000-8000-000000000006';
  v_dual uuid := 'e2100000-0000-4000-8000-000000000007';
  v_tenant_a uuid := 'e2100000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e2100000-0000-4000-8000-000000000012';
  v_cat_a uuid;
  v_cat_b uuid;
  v_cat_inactive uuid;
  v_service_a uuid;
  v_service_b uuid;
  v_status_a uuid;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
  v_count integer;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase21.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase21.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase21.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_manager_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager-a@phase21.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase21.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase21.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_dual, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dual@phase21.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_owner_b, 'Owner B'),
    (v_admin_a, 'Admin A'),
    (v_manager_a, 'Manager A'),
    (v_staff_a, 'Staff A'),
    (v_viewer_a, 'Viewer A'),
    (v_dual, 'Dual Manager');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase21', 'tenant-a-phase21', true),
    (v_tenant_b, 'Tenant B Phase21', 'tenant-b-phase21', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_b, v_owner_b, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_manager_a, 'manager', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_a, v_dual, 'manager', true),
    (v_tenant_b, v_dual, 'manager', true);

  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, active, sort_order
  ) values
    (gen_random_uuid(), v_tenant_a, 'Recibido', 'received', true, true, 1),
    (gen_random_uuid(), v_tenant_b, 'Recibido', 'received', true, true, 1);

  select id into v_status_a
  from public.order_statuses
  where tenant_id = v_tenant_a and is_initial = true;

  insert into public.service_categories (id, tenant_id, name, active, sort_order)
  values
    (gen_random_uuid(), v_tenant_a, 'Impresión', true, 1),
    (gen_random_uuid(), v_tenant_a, 'Archivo', false, 2),
    (gen_random_uuid(), v_tenant_b, 'Impresión', true, 1);

  select id into v_cat_a from public.service_categories
    where tenant_id = v_tenant_a and name = 'Impresión';
  select id into v_cat_inactive from public.service_categories
    where tenant_id = v_tenant_a and name = 'Archivo';
  select id into v_cat_b from public.service_categories
    where tenant_id = v_tenant_b and name = 'Impresión';

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  -- A) Owner creates service with category and without category.
  v_result := public.create_service(
    v_cat_a, 'Copias A4', 'B/N', 30,
    false, false, false, true, 1, v_tenant_a
  );
  v_service_a := (v_result #>> '{service,id}')::uuid;

  v_result := public.create_service(
    null, 'Sin categoría', null, null,
    false, false, false, true, 2, v_tenant_a
  );

  -- B) Admin can create.
  perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
  v_result := public.create_service(
    v_cat_a, 'Admin svc', null, 10,
    true, false, false, true, 3, v_tenant_a
  );

  -- C) Manager can update.
  perform set_config('request.jwt.claim.sub', v_manager_a::text, true);
  v_result := public.update_service(
    v_service_a, v_cat_a, 'Copias A4+', 'B/N+', 45,
    false, false, false, true, 1, v_tenant_a
  );
  if (v_result #>> '{service,name}') is distinct from 'Copias A4+' then
    raise exception 'FAIL C manager update failed';
  end if;

  -- D) Staff cannot write.
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_sqlstate := null;
  begin
    perform public.create_service(
      null, 'Staff svc', null, null,
      false, false, false, true, 9, v_tenant_a
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL D expected staff denial 42501, got %', v_sqlstate;
  end if;

  -- E) Viewer cannot write but can list.
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  v_result := public.list_services(v_tenant_a, null, null, null);
  if coalesce((v_result ->> 'total')::integer, 0) < 1 then
    raise exception 'FAIL E viewer should list services';
  end if;

  v_sqlstate := null;
  begin
    perform public.update_service(
      v_service_a, v_cat_a, 'Hack', null, 1,
      false, false, false, true, 1, v_tenant_a
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL E expected viewer denial 42501, got %', v_sqlstate;
  end if;

  -- F) Dual-tenant manager cannot move service A → tenant B.
  perform set_config('request.jwt.claim.sub', v_dual::text, true);
  v_sqlstate := null;
  v_message := null;
  begin
    update public.services
    set tenant_id = v_tenant_b
    where id = v_service_a;
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501'
     or position('service_tenant_immutable' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL F expected service_tenant_immutable, got % / %', v_sqlstate, v_message;
  end if;

  -- G) Cross-tenant category_id rejected by FK.
  v_sqlstate := null;
  begin
    update public.services
    set category_id = v_cat_b
    where id = v_service_a and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'FAIL G expected FK 23503 for foreign category, got %', v_sqlstate;
  end if;

  -- H) Nonexistent category rejected.
  v_sqlstate := null;
  begin
    update public.services
    set category_id = 'e2100000-0000-4000-8000-000000000099'
    where id = v_service_a and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'FAIL H expected FK 23503 for missing category, got %', v_sqlstate;
  end if;

  -- I) Inactive category of same tenant remains historically attachable.
  update public.services
  set category_id = v_cat_inactive
  where id = v_service_a and tenant_id = v_tenant_a;

  if not exists (
    select 1 from public.services
    where id = v_service_a and category_id = v_cat_inactive
  ) then
    raise exception 'FAIL I inactive category association failed';
  end if;

  -- J) Unique (tenant_id, name).
  v_sqlstate := null;
  begin
    perform public.create_service(
      null, 'Copias A4+', null, null,
      false, false, false, true, 8, v_tenant_a
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'FAIL J expected unique name 23505, got %', v_sqlstate;
  end if;

  -- K) Negative lead time rejected by RPC.
  v_sqlstate := null;
  begin
    perform public.create_service(
      null, 'Negativo', null, -5,
      false, false, false, true, 7, v_tenant_a
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL K expected 22023 for negative lead time, got %', v_sqlstate;
  end if;

  -- L) Deactivate service; historical order remains readable.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_result := public.update_service(
    v_service_a, v_cat_inactive, 'Copias A4+', 'B/N+', 45,
    false, false, false, false, 1, v_tenant_a
  );

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values (
    gen_random_uuid(), v_tenant_a, 'Pedido histórico', v_service_a, v_status_a, v_owner_a
  );

  select count(*) into v_count
  from public.orders o
  join public.services s on s.id = o.service_id and s.tenant_id = o.tenant_id
  where o.tenant_id = v_tenant_a
    and s.active = false
    and s.id = v_service_a;

  if v_count < 1 then
    raise exception 'FAIL L inactive service historical order not readable';
  end if;

  -- M) Cross-tenant read isolation via RLS.
  if exists (
    select 1 from public.services where tenant_id = v_tenant_b
  ) then
    raise exception 'FAIL M owner A must not see tenant B services';
  end if;

  -- N) Owner B service for isolation of update by A.
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  v_result := public.create_service(
    v_cat_b, 'Servicio B', null, null,
    false, false, false, true, 1, v_tenant_b
  );
  v_service_b := (v_result #>> '{service,id}')::uuid;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  update public.services
  set name = 'Leak'
  where id = v_service_b;
  if found then
    raise exception 'FAIL N cross-tenant update must match zero rows';
  end if;

  execute 'reset role';
end;
$phase21$;

rollback;
