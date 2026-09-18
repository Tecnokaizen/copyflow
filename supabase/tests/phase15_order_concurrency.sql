-- Order Editing V1 · E2A: optimistic concurrency (row_version + *_v2 RPCs).
-- Run after 20260918140000_order_concurrency_v1.sql against local db reset.

begin;

do $phase15$
declare
  v_owner_a uuid := 'd1000000-0000-4000-8000-000000000001';
  v_staff_a uuid := 'd1000000-0000-4000-8000-000000000002';
  v_viewer_a uuid := 'd1000000-0000-4000-8000-000000000003';
  v_owner_b uuid := 'd1000000-0000-4000-8000-000000000004';
  v_tenant_a uuid := 'd1000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'd1000000-0000-4000-8000-000000000012';
  v_status_initial_a uuid := 'd1000000-0000-4000-8000-000000000021';
  v_status_ready_a uuid := 'd1000000-0000-4000-8000-000000000022';
  v_status_closed_a uuid := 'd1000000-0000-4000-8000-000000000023';
  v_status_initial_b uuid := 'd1000000-0000-4000-8000-000000000024';
  v_service_a uuid := 'd1000000-0000-4000-8000-000000000031';
  v_service_b uuid := 'd1000000-0000-4000-8000-000000000032';
  v_channel_a uuid := 'd1000000-0000-4000-8000-000000000033';
  v_member_a uuid := 'd1000000-0000-4000-8000-000000000034';
  v_file_status_a uuid := 'd1000000-0000-4000-8000-000000000041';
  v_customer_type_a uuid := 'd1000000-0000-4000-8000-000000000051';
  v_client_1 uuid := 'd1000000-0000-4000-8000-000000000052';
  v_client_2 uuid := 'd1000000-0000-4000-8000-000000000053';
  v_order_open uuid := 'd1000000-0000-4000-8000-000000000061';
  v_order_stale uuid := 'd1000000-0000-4000-8000-000000000062';
  v_order_multi uuid := 'd1000000-0000-4000-8000-000000000063';
  v_order_status uuid := 'd1000000-0000-4000-8000-000000000064';
  v_order_client uuid := 'd1000000-0000-4000-8000-000000000065';
  v_order_create uuid := 'd1000000-0000-4000-8000-000000000066';
  v_order_archived uuid := 'd1000000-0000-4000-8000-000000000067';
  v_order_terminal uuid := 'd1000000-0000-4000-8000-000000000068';
  v_order_noop uuid := 'd1000000-0000-4000-8000-000000000069';
  v_order_reject uuid := 'd1000000-0000-4000-8000-000000000070';
  v_order_v1 uuid := 'd1000000-0000-4000-8000-000000000071';
  v_order_b uuid := 'd1000000-0000-4000-8000-000000000072';
  v_order_kiosk uuid := 'd1000000-0000-4000-8000-000000000073';
  v_sqlstate text;
  v_message text;
  v_count integer;
  v_clients_before integer;
  v_clients_after integer;
  v_result jsonb;
  v_version bigint;
  v_version_2 bigint;
  v_title text;
  v_priority text;
  v_client_id uuid;
  v_status_id uuid;
  v_archived_at timestamptz;
  v_created_def text;
  v_kiosk_marker text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase15.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase15.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase15.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase15.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_staff_a, 'Staff A'),
    (v_viewer_a, 'Viewer A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase15', 'tenant-a-phase15', true),
    (v_tenant_b, 'Tenant B Phase15', 'tenant-b-phase15', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_initial_a, v_tenant_a, 'Recibido', 'received', true, 1, true, false, false, false),
    (v_status_ready_a, v_tenant_a, 'Listo', 'ready', true, 2, false, true, false, false),
    (v_status_closed_a, v_tenant_a, 'Entregado', 'delivered', true, 3, false, false, true, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_a, v_tenant_a, 'Servicio A', true, 1);

  insert into public.entry_channels (id, tenant_id, name, code, active, sort_order) values
    (v_channel_a, v_tenant_a, 'Mostrador', 'counter', true, 1);

  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values
    (v_member_a, v_tenant_a, 'Miembro A', true, true);

  insert into public.file_statuses (id, tenant_id, name, code, active, sort_order) values
    (v_file_status_a, v_tenant_a, 'Recibidos', 'received', true, 1);

  insert into public.customer_types (id, tenant_id, name, active, sort_order) values
    (v_customer_type_a, v_tenant_a, 'Particular', true, 1);

  insert into public.clients (
    id, tenant_id, customer_type_id, name, active, created_by
  ) values
    (v_client_1, v_tenant_a, v_customer_type_a, 'Cliente Uno', true, v_owner_a),
    (v_client_2, v_tenant_a, v_customer_type_a, 'Cliente Dos', true, v_owner_a);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_open, v_tenant_a, 'Abierto', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_stale, v_tenant_a, 'Stale', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_multi, v_tenant_a, 'Multi', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_status, v_tenant_a, 'Status', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_client, v_tenant_a, 'Client', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_create, v_tenant_a, 'Create', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_archived, v_tenant_a, 'Para archivar', v_service_a, v_status_closed_a, v_owner_a),
    (v_order_terminal, v_tenant_a, 'Terminal sin archivar', v_service_a, v_status_closed_a, v_owner_a),
    (v_order_noop, v_tenant_a, 'Noop', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_reject, v_tenant_a, 'Reject', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_v1, v_tenant_a, 'V1 coexist', v_service_a, v_status_initial_a, v_owner_a);

  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_initial_b, v_tenant_b, 'Recibido', 'received', true, 1, true, false, false, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_b, v_tenant_b, 'Servicio B', true, 1);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_b, v_tenant_b, 'Tenant B', v_service_b, v_status_initial_b, v_owner_b);

  execute 'reset role';

  -- 1) row_version inicial
  select row_version into v_version from public.orders where id = v_order_open;
  if v_version is distinct from 0 then
    raise exception 'FAIL 1 initial row_version expected 0 got %', v_version;
  end if;

  -- 2) write correcto V -> V+1
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.change_order_content_v2(
    v_order_open, 'title', 'Abierto v2', v_tenant_a, 0
  );
  execute 'reset role';
  if v_result->>'version' is distinct from '1' then
    raise exception 'FAIL 2 returned version expected 1 got %', v_result->>'version';
  end if;
  select row_version, title into v_version, v_title
  from public.orders where id = v_order_open;
  if v_version is distinct from 1 or v_title is distinct from 'Abierto v2' then
    raise exception 'FAIL 2 persisted version/title % / %', v_version, v_title;
  end if;

  -- 3) stale mismo campo
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content_v2(
      v_order_open, 'title', 'stale same field', v_tenant_a, 0
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'GCO01'
     or v_message is distinct from 'order has been modified since last read' then
    raise exception 'FAIL 3 stale same field: % / %', v_sqlstate, v_message;
  end if;
  select title into v_title from public.orders where id = v_order_open;
  if v_title is distinct from 'Abierto v2' then
    raise exception 'FAIL 3 first writer not preserved: %', v_title;
  end if;

  -- 4) stale distinto campo
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_details_v2(
      v_order_open, 'priority', 'urgent', v_tenant_a, 0
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'GCO01' then
    raise exception 'FAIL 4 stale other field: % / %', v_sqlstate, v_message;
  end if;

  -- 5) primer writer preservado (priority still default)
  select priority, row_version into v_priority, v_version
  from public.orders where id = v_order_open;
  if v_priority is distinct from 'normal' or v_version is distinct from 1 then
    raise exception 'FAIL 5 first writer not preserved: % / %', v_priority, v_version;
  end if;

  -- 6) multi-step encadenado
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.change_order_content_v2(
    v_order_multi, 'title', 'Multi 1', v_tenant_a, 0
  );
  v_result := public.change_order_details_v2(
    v_order_multi, 'priority', 'high', v_tenant_a, (v_result->>'version')::bigint
  );
  execute 'reset role';
  if v_result->>'version' is distinct from '2' then
    raise exception 'FAIL 6 chained version expected 2 got %', v_result->>'version';
  end if;
  select title, priority, row_version into v_title, v_priority, v_version
  from public.orders where id = v_order_multi;
  if v_title is distinct from 'Multi 1'
     or v_priority is distinct from 'high'
     or v_version is distinct from 2 then
    raise exception 'FAIL 6 chained persist % / % / %', v_title, v_priority, v_version;
  end if;

  -- 7) status v2
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.change_order_status_v2(
    v_order_status, v_status_ready_a, v_tenant_a, 0
  );
  execute 'reset role';
  if v_result->>'version' is distinct from '1' then
    raise exception 'FAIL 7 status version %', v_result->>'version';
  end if;
  select status_id, row_version into v_status_id, v_version
  from public.orders where id = v_order_status;
  if v_status_id is distinct from v_status_ready_a or v_version is distinct from 1 then
    raise exception 'FAIL 7 status persist';
  end if;

  -- 8) assign client v2
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.assign_order_client_v2(
    v_order_client, v_client_1, v_tenant_a, 0
  );
  execute 'reset role';
  if v_result->>'version' is distinct from '1' then
    raise exception 'FAIL 8 assign version %', v_result->>'version';
  end if;
  select client_id into v_client_id from public.orders where id = v_order_client;
  if v_client_id is distinct from v_client_1 then
    raise exception 'FAIL 8 assign persist';
  end if;

  -- 9) create+assign stale sin huérfano
  select count(*) into v_clients_before
  from public.clients where tenant_id = v_tenant_a;
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.change_order_content_v2(
    v_order_create, 'notes', 'bump', v_tenant_a, 0
  );
  execute 'reset role';
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.create_client_and_assign_order_v2(
      v_order_create, v_customer_type_a, 'Huérfano',
      null, null, null, 'huerfano@phase15.test', null, null,
      v_tenant_a, 0
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'GCO01' then
    raise exception 'FAIL 9 stale create expected GCO01 got %', v_sqlstate;
  end if;
  select count(*) into v_clients_after
  from public.clients where tenant_id = v_tenant_a;
  if v_clients_after is distinct from v_clients_before then
    raise exception 'FAIL 9 orphan client created (% -> %)',
      v_clients_before, v_clients_after;
  end if;

  -- 10) archived > stale
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.archive_order(v_order_archived, v_tenant_a);
  execute 'reset role';
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content_v2(
      v_order_archived, 'title', 'archived stale', v_tenant_a, 0
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501'
     or v_message is distinct from 'order is archived' then
    raise exception 'FAIL 10 archived must beat stale: % / %', v_sqlstate, v_message;
  end if;

  -- 11) viewer > stale
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content_v2(
      v_order_open, 'title', 'viewer', v_tenant_a, 0
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501'
     or v_message is distinct from 'tenant access denied' then
    raise exception 'FAIL 11 viewer must beat stale: % / %', v_sqlstate, v_message;
  end if;

  -- 12) cross-tenant > stale
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content_v2(
      v_order_open, 'title', 'cross', v_tenant_a, 0
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501'
     or v_message is distinct from 'tenant access denied' then
    raise exception 'FAIL 12 cross-tenant must beat stale: % / %', v_sqlstate, v_message;
  end if;

  -- 13) terminal no archived editable
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.change_order_content_v2(
    v_order_terminal, 'title', 'Terminal editado', v_tenant_a, 0
  );
  execute 'reset role';
  if v_result->>'version' is distinct from '1' then
    raise exception 'FAIL 13 terminal edit version %', v_result->>'version';
  end if;

  -- 14) no-op no incrementa
  select row_version into v_version from public.orders where id = v_order_noop;
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.change_order_content_v2(
    v_order_noop, 'title', 'Noop', v_tenant_a, 0
  );
  execute 'reset role';
  select row_version into v_version_2 from public.orders where id = v_order_noop;
  if v_version_2 is distinct from v_version or v_result->>'version' is distinct from '0' then
    raise exception 'FAIL 14 no-op incremented: % -> % / %',
      v_version, v_version_2, v_result->>'version';
  end if;

  -- 15) v1 y v2 coexistentes
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.change_order_content(
    v_order_v1, 'title', 'Via v1', v_tenant_a
  );
  select row_version into v_version from public.orders where id = v_order_v1;
  v_result := public.change_order_content_v2(
    v_order_v1, 'title', 'Via v2', v_tenant_a, v_version
  );
  execute 'reset role';
  if v_result->>'version' is distinct from (v_version + 1)::text then
    raise exception 'FAIL 15 v1/v2 coexistence version';
  end if;

  -- 16) archive_order sin cambio de firma
  select row_version, archived_at into v_version, v_archived_at
  from public.orders where id = v_order_archived;
  if v_archived_at is null then
    raise exception 'FAIL 16 archive did not stick from step 10';
  end if;
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.archive_order(v_order_archived, v_tenant_a);
  execute 'reset role';
  if v_result->>'replay' is distinct from 'true' then
    raise exception 'FAIL 16 archive_order replay drifted';
  end if;
  if position('p_expected_version' in pg_get_functiondef(
       'public.archive_order(uuid, uuid)'::regprocedure
     )) > 0 then
    raise exception 'FAIL 16 archive_order gained expected_version';
  end if;

  -- 17) Kiosk insert row_version=0
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('app.order_lifecycle', '', true);
  perform set_config('app.kiosk_submission', 'validated', true);
  v_kiosk_marker := current_setting('app.order_lifecycle', true);
  insert into public.orders (
    id, tenant_id, title, service_id, status_id, metadata, created_by
  ) values (
    v_order_kiosk, v_tenant_a, 'Kiosk concurrency',
    v_service_a, v_status_initial_a,
    jsonb_build_object('source', 'kiosk'), null
  );
  select row_version into v_version from public.orders where id = v_order_kiosk;
  if v_version is distinct from 0 then
    raise exception 'FAIL 17 kiosk insert row_version expected 0 got %', v_version;
  end if;

  -- 18) Kiosk regression
  if coalesce(v_kiosk_marker, '') = 'validated' then
    raise exception 'FAIL 18 test setup polluted order_lifecycle';
  end if;
  select count(*) into v_count
  from public.activity_log
  where entity_id = v_order_kiosk
    and action = 'order.created'
    and metadata ->> 'source' = 'kiosk';
  if v_count <> 1 then
    raise exception 'FAIL 18 Kiosk INSERT audit broken (count=%)', v_count;
  end if;
  select pg_get_functiondef('public.tg_activity_log_order_created()'::regprocedure)
  into v_created_def;
  if position('app.kiosk_submission' in v_created_def) = 0
     or position('source' in v_created_def) = 0 then
    raise exception 'FAIL 18 tg_activity_log_order_created Kiosk contract altered';
  end if;

  -- 19) Lifecycle regression
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_status(
      v_order_archived, v_status_initial_a, v_tenant_a
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501'
     or v_message is distinct from 'order is archived' then
    raise exception 'FAIL 19 change_order_status v1 archived drifted: % / %',
      v_sqlstate, v_message;
  end if;

  -- 20) update rechazado no consume version
  select row_version into v_version from public.orders where id = v_order_reject;
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content_v2(
      v_order_reject, 'title', '   ', v_tenant_a, 0
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'FAIL 20 expected 22023 got %', v_sqlstate;
  end if;
  select row_version, title into v_version_2, v_title
  from public.orders where id = v_order_reject;
  if v_version_2 is distinct from v_version or v_title is distinct from 'Reject' then
    raise exception 'FAIL 20 rejected write consumed version: % -> % / %',
      v_version, v_version_2, v_title;
  end if;

  raise notice 'PASS phase15_order_concurrency';
end;
$phase15$;

commit;
