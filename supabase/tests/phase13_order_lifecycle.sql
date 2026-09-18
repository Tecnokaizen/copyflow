-- Order Lifecycle V1: guard, change_order_status, archive_order, audit.
-- Run after 20260917180000_order_lifecycle_v1.sql against local db reset.

begin;

do $phase13$
declare
  v_owner_a uuid := 'b1000000-0000-4000-8000-000000000001';
  v_admin_a uuid := 'b1000000-0000-4000-8000-000000000002';
  v_staff_a uuid := 'b1000000-0000-4000-8000-000000000003';
  v_viewer_a uuid := 'b1000000-0000-4000-8000-000000000004';
  v_owner_b uuid := 'b1000000-0000-4000-8000-000000000005';
  v_tenant_a uuid := 'b1000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'b1000000-0000-4000-8000-000000000012';
  v_status_initial_a uuid := 'b1000000-0000-4000-8000-000000000021';
  v_status_ready_a uuid := 'b1000000-0000-4000-8000-000000000022';
  v_status_closed_a uuid := 'b1000000-0000-4000-8000-000000000023';
  v_status_cancelled_a uuid := 'b1000000-0000-4000-8000-000000000024';
  v_status_initial_b uuid := 'b1000000-0000-4000-8000-000000000025';
  v_status_closed_b uuid := 'b1000000-0000-4000-8000-000000000026';
  v_service_a uuid := 'b1000000-0000-4000-8000-000000000031';
  v_service_b uuid := 'b1000000-0000-4000-8000-000000000032';
  v_order_active uuid := 'b1000000-0000-4000-8000-000000000041';
  v_order_to_close uuid := 'b1000000-0000-4000-8000-000000000042';
  v_order_terminal uuid := 'b1000000-0000-4000-8000-000000000043';
  v_order_cancel uuid := 'b1000000-0000-4000-8000-000000000044';
  v_order_b uuid := 'b1000000-0000-4000-8000-000000000045';
  v_order_kiosk uuid := 'b1000000-0000-4000-8000-000000000046';
  v_sqlstate text;
  v_count integer;
  v_result jsonb;
  v_ready_at timestamptz;
  v_delivered_at timestamptz;
  v_archived_at timestamptz;
  v_archived_at_2 timestamptz;
  v_status_id uuid;
  v_created_def text;
  v_kiosk_marker text;
begin
  -- Fixtures ------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase13.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase13.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Admin A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase13.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase13.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase13.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_admin_a, 'Admin A'),
    (v_staff_a, 'Staff A'),
    (v_viewer_a, 'Viewer A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase13', 'tenant-a-phase13', true),
    (v_tenant_b, 'Tenant B Phase13', 'tenant-b-phase13', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  -- Catalog/order fixtures require authenticated actor for audit triggers.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_initial_a, v_tenant_a, 'Recibido', 'received', true, 1, true, false, false, false),
    (v_status_ready_a, v_tenant_a, 'Listo', 'ready', true, 2, false, true, false, false),
    (v_status_closed_a, v_tenant_a, 'Entregado', 'delivered', true, 3, false, false, true, false),
    (v_status_cancelled_a, v_tenant_a, 'Cancelado', 'cancelled', true, 4, false, false, false, true);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_a, v_tenant_a, 'Servicio A', true, 1);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_active, v_tenant_a, 'Activo', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_to_close, v_tenant_a, 'A cerrar', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_terminal, v_tenant_a, 'Terminal cerrado', v_service_a, v_status_closed_a, v_owner_a),
    (v_order_cancel, v_tenant_a, 'Terminal cancelado', v_service_a, v_status_cancelled_a, v_owner_a);

  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_initial_b, v_tenant_b, 'Recibido', 'received', true, 1, true, false, false, false),
    (v_status_closed_b, v_tenant_b, 'Entregado', 'delivered', true, 2, false, false, true, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_b, v_tenant_b, 'Servicio B', true, 1);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_b, v_tenant_b, 'Tenant B', v_service_b, v_status_closed_b, v_owner_b);

  execute 'reset role';

  -- Snapshot Kiosk created-trigger contract (must remain intact).
  select pg_get_functiondef('public.tg_activity_log_order_created()'::regprocedure)
  into v_created_def;
  if position('app.kiosk_submission' in v_created_def) = 0 then
    raise exception 'FAIL Kiosk created trigger missing app.kiosk_submission branch';
  end if;

  -- 1) Direct status_id bypass blocked (staff) --------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    update public.orders
    set status_id = v_status_ready_a
    where id = v_order_active and tenant_id = v_tenant_a;
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL direct status bypass: expected 42501 got %', v_sqlstate;
  end if;

  -- 2) Direct delivered_at blocked (staff) -----------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    update public.orders
    set delivered_at = now()
    where id = v_order_active and tenant_id = v_tenant_a;
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL direct delivered_at: expected 42501 got %', v_sqlstate;
  end if;

  -- 3) Direct archived_at blocked (admin) ------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    update public.orders
    set archived_at = now()
    where id = v_order_terminal and tenant_id = v_tenant_a;
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL direct archived_at: expected 42501 got %', v_sqlstate;
  end if;

  -- 4) change_order_status works + status_changed audit + sticky ready/delivered
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.change_order_status_v2(v_order_to_close, v_status_ready_a, v_tenant_a,
    (SELECT row_version FROM public.orders WHERE id = v_order_to_close));
  execute 'reset role';

  if v_result #>> '{order,status_id}' is distinct from v_status_ready_a::text then
    raise exception 'FAIL change_order_status ready status_id';
  end if;
  if v_result #>> '{order,ready_at}' is null then
    raise exception 'FAIL change_order_status ready_at not sticky-set';
  end if;

  select ready_at into v_ready_at
  from public.orders where id = v_order_to_close;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.change_order_status_v2(v_order_to_close, v_status_closed_a, v_tenant_a,
    (SELECT row_version FROM public.orders WHERE id = v_order_to_close));
  execute 'reset role';

  select ready_at, delivered_at, status_id
  into v_ready_at, v_delivered_at, v_status_id
  from public.orders where id = v_order_to_close;

  if v_status_id is distinct from v_status_closed_a then
    raise exception 'FAIL change_order_status closed status';
  end if;
  if v_delivered_at is null then
    raise exception 'FAIL change_order_status delivered_at not set';
  end if;
  if v_ready_at is null then
    raise exception 'FAIL ready_at lost on close';
  end if;

  select count(*) into v_count
  from public.activity_log
  where entity_id = v_order_to_close
    and action = 'order.status_changed';
  if v_count < 2 then
    raise exception 'FAIL order.status_changed not generated (% rows)', v_count;
  end if;

  -- 5) archive only terminal + order.archived audit --------------------------
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.archive_order(v_order_active, v_tenant_a);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL archive non-terminal: expected 42501 got %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.archive_order(v_order_terminal, v_tenant_a);
  execute 'reset role';

  if coalesce((v_result ->> 'replay')::boolean, true) is not false then
    raise exception 'FAIL archive_order first call should not be replay';
  end if;

  select archived_at, status_id into v_archived_at, v_status_id
  from public.orders where id = v_order_terminal;
  if v_archived_at is null then
    raise exception 'FAIL archive_order did not set archived_at';
  end if;
  if v_status_id is distinct from v_status_closed_a then
    raise exception 'FAIL archive_order changed status_id';
  end if;

  select count(*) into v_count
  from public.activity_log
  where entity_id = v_order_terminal
    and action = 'order.archived';
  if v_count <> 1 then
    raise exception 'FAIL order.archived expected 1 got %', v_count;
  end if;

  -- cancelled terminal also archivable
  perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.archive_order(v_order_cancel, v_tenant_a);
  execute 'reset role';
  if (select archived_at from public.orders where id = v_order_cancel) is null then
    raise exception 'FAIL archive cancelled terminal';
  end if;

  -- 6) archive idempotent ----------------------------------------------------
  select archived_at into v_archived_at
  from public.orders where id = v_order_terminal;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.archive_order(v_order_terminal, v_tenant_a);
  execute 'reset role';

  if coalesce((v_result ->> 'replay')::boolean, false) is not true then
    raise exception 'FAIL archive_order idempotent replay flag';
  end if;

  select archived_at into v_archived_at_2
  from public.orders where id = v_order_terminal;
  if v_archived_at_2 is distinct from v_archived_at then
    raise exception 'FAIL archive_order idempotent changed archived_at';
  end if;

  select count(*) into v_count
  from public.activity_log
  where entity_id = v_order_terminal
    and action = 'order.archived';
  if v_count <> 1 then
    raise exception 'FAIL archive idempotent duplicated audit (% rows)', v_count;
  end if;

  -- 7) archived order cannot change status -----------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_status_v2(v_order_terminal, v_status_ready_a, v_tenant_a, 0);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL archived status change: expected 42501 got %', v_sqlstate;
  end if;

  -- 8) viewer cannot archive -------------------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    -- use a fresh closed order for viewer attempt
    -- v_order_to_close is already closed; archive it first as staff if needed
    perform public.archive_order(v_order_to_close, v_tenant_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL viewer archive: expected 42501 got %', v_sqlstate;
  end if;

  -- Ensure viewer was the actor that failed (order may still be unarchived).
  -- Re-check: if somehow archived, that is a hard fail already via sqlstate.

  -- 9) tenant A cannot archive tenant B --------------------------------------
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.archive_order(v_order_b, v_tenant_b);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL cross-tenant archive: expected 42501 got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.archive_order(v_order_b, v_tenant_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'P0002' then
    raise exception 'FAIL cross-tenant wrong tenant_id: expected P0002 got %', v_sqlstate;
  end if;

  if (select archived_at from public.orders where id = v_order_b) is not null then
    raise exception 'FAIL tenant B order was archived by A';
  end if;

  -- 10) Kiosk INSERT still works without app.order_lifecycle ------------------
  -- Mimic signed private submit marker only; no order_lifecycle GUC.
  -- Clear any leftover JWT so auth.uid() is null (Kiosk actor-less path).
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('app.order_lifecycle', '', true);
  perform set_config('app.kiosk_submission', 'validated', true);
  v_kiosk_marker := current_setting('app.order_lifecycle', true);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, metadata, created_by
  ) values (
    v_order_kiosk,
    v_tenant_a,
    'Kiosk lifecycle compatibility',
    v_service_a,
    v_status_initial_a,
    jsonb_build_object('source', 'kiosk'),
    null
  );

  select count(*) into v_count
  from public.activity_log
  where entity_id = v_order_kiosk
    and action = 'order.created'
    and metadata ->> 'source' = 'kiosk';
  if v_count <> 1 then
    raise exception 'FAIL Kiosk INSERT audit without order_lifecycle (count=%)', v_count;
  end if;

  if coalesce(v_kiosk_marker, '') = 'validated' then
    raise exception 'FAIL test setup polluted order_lifecycle during Kiosk insert';
  end if;

  -- Re-assert created trigger still contains Kiosk branch after exercise.
  select pg_get_functiondef('public.tg_activity_log_order_created()'::regprocedure)
  into v_created_def;
  if position('app.kiosk_submission' in v_created_def) = 0
     or position('source' in v_created_def) = 0 then
    raise exception 'FAIL tg_activity_log_order_created Kiosk contract altered';
  end if;

  raise notice 'PASS phase13_order_lifecycle';
end;
$phase13$;

commit;
