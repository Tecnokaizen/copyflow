-- Order Editing V1 · E2B: cleanup verification.
-- Confirms v1 RPCs are gone, v2 RPCs intact, and all behaviour preserved.
-- Run after 20260918200000_drop_legacy_order_edit_rpcs.sql against local db reset.

begin;

do $phase16$
declare
  -- Fixture IDs (prefix d1700000 to avoid collisions with other phase tests)
  v_owner_a  uuid := 'd1700000-0000-4000-8000-000000000001';
  v_staff_a  uuid := 'd1700000-0000-4000-8000-000000000002';
  v_viewer_a uuid := 'd1700000-0000-4000-8000-000000000003';
  v_tenant_a uuid := 'd1700000-0000-4000-8000-000000000011';
  v_status_initial_a uuid := 'd1700000-0000-4000-8000-000000000021';
  v_status_closed_a  uuid := 'd1700000-0000-4000-8000-000000000022';
  v_customer_type_a  uuid := 'd1700000-0000-4000-8000-000000000051';
  v_client_1 uuid := 'd1700000-0000-4000-8000-000000000052';

  -- Orders
  v_order_main     uuid := 'd1700000-0000-4000-8000-000000000061';
  v_order_stale    uuid := 'd1700000-0000-4000-8000-000000000062';
  v_order_archived uuid := 'd1700000-0000-4000-8000-000000000063';
  v_order_terminal uuid := 'd1700000-0000-4000-8000-000000000064';
  v_order_noop     uuid := 'd1700000-0000-4000-8000-000000000065';
  v_order_status   uuid := 'd1700000-0000-4000-8000-000000000066';
  v_order_client   uuid := 'd1700000-0000-4000-8000-000000000067';
  v_order_create   uuid := 'd1700000-0000-4000-8000-000000000068';
  v_order_kiosk    uuid := 'd1700000-0000-4000-8000-000000000069';
  v_order_kiosk_new uuid;
  v_kiosk_row_version bigint;

  v_fn_count integer;
  v_col_count integer;
  v_result jsonb;
  v_version bigint;
  v_sqlstate text;
  v_message text;
  v_exists boolean;
  v_clients_before integer;
  v_clients_after integer;
  v_log_count_before integer;
  v_log_count_after integer;
  v_kiosk_order_id uuid;

begin
  -- =========================================================================
  -- SETUP FIXTURES
  -- =========================================================================

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase16.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A P16"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase16.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A P16"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase16.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer A P16"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A P16'),
    (v_staff_a, 'Staff A P16'),
    (v_viewer_a, 'Viewer A P16');

  insert into public.tenants (id, name, slug) values
    (v_tenant_a, 'Tenant Phase16', 'phase16-tenant-a');

  insert into public.memberships (user_id, tenant_id, role, active) values
    (v_owner_a, v_tenant_a, 'owner', true),
    (v_staff_a, v_tenant_a, 'staff', true),
    (v_viewer_a, v_tenant_a, 'viewer', true);

  insert into public.order_statuses (id, tenant_id, code, name, active, is_ready, is_closed, is_cancelled) values
    (v_status_initial_a, v_tenant_a, 'P16_INIT', 'Pendiente P16', true, false, false, false),
    (v_status_closed_a,  v_tenant_a, 'P16_DONE', 'Cerrado P16',   true, false, true,  false);

  insert into public.customer_types (id, tenant_id, name, active) values
    (v_customer_type_a, v_tenant_a, 'Estándar P16', true);

  -- Need auth context for client trigger (tg_activity_log_client checks auth.uid())
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.clients (id, tenant_id, customer_type_id, name, active) values
    (v_client_1, v_tenant_a, v_customer_type_a, 'Cliente P16 Uno', true);
  execute 'reset role';

  -- Orders with different row_version values for concurrency tests
  insert into public.orders (id, tenant_id, reference, title, status_id, row_version) values
    (v_order_main,     v_tenant_a, 'P16-MAIN',     'Main order',     v_status_initial_a, 1),
    (v_order_stale,    v_tenant_a, 'P16-STALE',    'Stale order',    v_status_initial_a, 5),
    (v_order_archived, v_tenant_a, 'P16-ARCH',     'Archived order', v_status_initial_a, 2),
    (v_order_terminal, v_tenant_a, 'P16-TERM',     'Terminal order', v_status_closed_a,  1),
    (v_order_noop,     v_tenant_a, 'P16-NOOP',     'Noop order',     v_status_initial_a, 3),
    (v_order_status,   v_tenant_a, 'P16-STATUS',   'Status order',   v_status_initial_a, 1),
    (v_order_client,   v_tenant_a, 'P16-CLIENT',   'Client order',   v_status_initial_a, 1),
    (v_order_create,   v_tenant_a, 'P16-CREATE',   'Create+Assign',  v_status_initial_a, 1),
    (v_order_kiosk,    v_tenant_a, 'P16-KIOSK',    'Kiosk order',    v_status_initial_a, 0);

  -- Archive v_order_archived
  UPDATE public.orders SET archived_at = now() - interval '1 day' WHERE id = v_order_archived;


  -- =========================================================================
  -- TEST 1: v1 RPCs no longer exist
  -- =========================================================================
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'change_order_content',
      'change_order_details',
      'change_order_management',
      'change_order_notification_status',
      'assign_order_client',
      'create_client_and_assign_order',
      'change_order_status'
    )
    AND NOT (p.proname LIKE '%_v2');

  ASSERT v_fn_count = 0,
    format('[TEST 1] FAIL: se encontraron %s RPCs v1 — deberían ser 0', v_fn_count);

  -- =========================================================================
  -- TEST 2: v2 RPCs exist
  -- =========================================================================
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'change_order_content_v2',
      'change_order_details_v2',
      'change_order_management_v2',
      'change_order_notification_status_v2',
      'assign_order_client_v2',
      'create_client_and_assign_order_v2',
      'change_order_status_v2'
    );

  ASSERT v_fn_count = 7,
    format('[TEST 2] FAIL: se encontraron %s RPCs v2 — deberían ser 7', v_fn_count);

  -- =========================================================================
  -- TEST 3: archive_order exists
  -- =========================================================================
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'archive_order';

  ASSERT v_fn_count >= 1,
    '[TEST 3] FAIL: archive_order no existe';

  -- =========================================================================
  -- TEST 4: row_version column exists on public.orders
  -- =========================================================================
  SELECT COUNT(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'orders'
    AND column_name = 'row_version';

  ASSERT v_col_count = 1,
    '[TEST 4] FAIL: columna row_version no existe en public.orders';

  -- =========================================================================
  -- TEST 5: trigger orders_bump_row_version exists
  -- =========================================================================
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'orders'
      AND t.tgname = 'orders_bump_row_version'
  ), '[TEST 5] FAIL: trigger orders_bump_row_version no existe';

  -- =========================================================================
  -- TEST 6: v2 RPCs are SECURITY INVOKER (prosecdef = false)
  -- =========================================================================
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'change_order_content_v2',
      'change_order_details_v2',
      'change_order_management_v2',
      'change_order_notification_status_v2',
      'assign_order_client_v2',
      'create_client_and_assign_order_v2',
      'change_order_status_v2'
    )
    AND p.prosecdef = true;  -- SECURITY DEFINER = true → should be 0

  ASSERT v_fn_count = 0,
    format('[TEST 6] FAIL: %s RPCs v2 tienen SECURITY DEFINER — deben ser INVOKER', v_fn_count);

  -- =========================================================================
  -- TEST 7: authenticated EXECUTE on all v2 RPCs
  -- =========================================================================
  ASSERT has_function_privilege('authenticated', 'public.change_order_content_v2(uuid,text,text,uuid,bigint)', 'execute'),
    '[TEST 7a] FAIL: authenticated no tiene EXECUTE en change_order_content_v2';
  ASSERT has_function_privilege('authenticated', 'public.change_order_details_v2(uuid,text,text,uuid,bigint)', 'execute'),
    '[TEST 7b] FAIL: authenticated no tiene EXECUTE en change_order_details_v2';
  ASSERT has_function_privilege('authenticated', 'public.change_order_management_v2(uuid,text,uuid,uuid,bigint)', 'execute'),
    '[TEST 7c] FAIL: authenticated no tiene EXECUTE en change_order_management_v2';
  ASSERT has_function_privilege('authenticated', 'public.change_order_notification_status_v2(uuid,text,uuid,bigint)', 'execute'),
    '[TEST 7d] FAIL: authenticated no tiene EXECUTE en change_order_notification_status_v2';
  ASSERT has_function_privilege('authenticated', 'public.assign_order_client_v2(uuid,uuid,uuid,bigint)', 'execute'),
    '[TEST 7e] FAIL: authenticated no tiene EXECUTE en assign_order_client_v2';
  ASSERT has_function_privilege('authenticated', 'public.create_client_and_assign_order_v2(uuid,uuid,text,text,text,text,text,text,text,uuid,bigint)', 'execute'),
    '[TEST 7f] FAIL: authenticated no tiene EXECUTE en create_client_and_assign_order_v2';
  ASSERT has_function_privilege('authenticated', 'public.change_order_status_v2(uuid,uuid,uuid,bigint)', 'execute'),
    '[TEST 7g] FAIL: authenticated no tiene EXECUTE en change_order_status_v2';

  -- =========================================================================
  -- TEST 8: anon does NOT have EXECUTE on any v2 RPC
  -- =========================================================================
  ASSERT NOT has_function_privilege('anon', 'public.change_order_content_v2(uuid,text,text,uuid,bigint)', 'execute'),
    '[TEST 8a] FAIL: anon tiene EXECUTE en change_order_content_v2';
  ASSERT NOT has_function_privilege('anon', 'public.change_order_details_v2(uuid,text,text,uuid,bigint)', 'execute'),
    '[TEST 8b] FAIL: anon tiene EXECUTE en change_order_details_v2';
  ASSERT NOT has_function_privilege('anon', 'public.change_order_management_v2(uuid,text,uuid,uuid,bigint)', 'execute'),
    '[TEST 8c] FAIL: anon tiene EXECUTE en change_order_management_v2';
  ASSERT NOT has_function_privilege('anon', 'public.change_order_notification_status_v2(uuid,text,uuid,bigint)', 'execute'),
    '[TEST 8d] FAIL: anon tiene EXECUTE en change_order_notification_status_v2';
  ASSERT NOT has_function_privilege('anon', 'public.assign_order_client_v2(uuid,uuid,uuid,bigint)', 'execute'),
    '[TEST 8e] FAIL: anon tiene EXECUTE en assign_order_client_v2';
  ASSERT NOT has_function_privilege('anon', 'public.create_client_and_assign_order_v2(uuid,uuid,text,text,text,text,text,text,text,uuid,bigint)', 'execute'),
    '[TEST 8f] FAIL: anon tiene EXECUTE en create_client_and_assign_order_v2';
  ASSERT NOT has_function_privilege('anon', 'public.change_order_status_v2(uuid,uuid,uuid,bigint)', 'execute'),
    '[TEST 8g] FAIL: anon tiene EXECUTE en change_order_status_v2';

  -- =========================================================================
  -- TEST 9: stale version raises GCO01
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    v_result := public.change_order_content_v2(
      v_order_stale, 'title', 'Titulo stale test', v_tenant_a,
      0  -- stale: actual row_version = 5
    );
    execute 'reset role';
    ASSERT false, '[TEST 9] FAIL: debería haber lanzado excepción por versión obsoleta';
  exception when others then
    execute 'reset role';
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    ASSERT v_sqlstate = 'GCO01',
      format('[TEST 9] FAIL: SQLSTATE esperado GCO01, obtenido %s (msg: %s)', v_sqlstate, v_message);
  end;

  -- =========================================================================
  -- TEST 10: archived > stale (archived check fires before concurrency)
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    v_result := public.change_order_content_v2(
      v_order_archived, 'title', 'Titulo archived stale', v_tenant_a,
      0  -- archived guard fires before concurrency check
    );
    execute 'reset role';
    ASSERT false, '[TEST 10] FAIL: debería haber rechazado por archived';
  exception when others then
    execute 'reset role';
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    ASSERT v_sqlstate = '42501' AND v_message = 'order is archived',
      format('[TEST 10] FAIL: esperado 42501/order is archived, obtenido %s/%s', v_sqlstate, v_message);
  end;

  -- =========================================================================
  -- TEST 11: terminal non-archived order is editable via change_order_status_v2
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  SELECT row_version INTO v_version FROM public.orders WHERE id = v_order_terminal;
  v_result := public.change_order_status_v2(
    v_order_terminal, v_status_closed_a, v_tenant_a, v_version
  );
  execute 'reset role';

  ASSERT (v_result->'order'->>'status_id')::uuid = v_status_closed_a,
    '[TEST 11] FAIL: change_order_status_v2 no actualizó estado en pedido terminal no archivado';

  -- =========================================================================
  -- TEST 12: no-op conserva versión (idempotent save returns same version token)
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  SELECT row_version INTO v_version FROM public.orders WHERE id = v_order_noop;
  v_result := public.change_order_content_v2(
    v_order_noop, 'title',
    (SELECT title FROM public.orders WHERE id = v_order_noop),  -- same title
    v_tenant_a, v_version
  );
  execute 'reset role';

  ASSERT (v_result->>'version') = v_version::text,
    format('[TEST 12] FAIL: no-op cambió la versión. Esperado %s, obtenido %s', v_version, v_result->>'version');
  ASSERT (SELECT row_version FROM public.orders WHERE id = v_order_noop) = v_version,
    '[TEST 12b] FAIL: row_version en BD cambió en operación no-op';

  -- =========================================================================
  -- TEST 13: change_order_status_v2 funciona correctamente
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  SELECT row_version INTO v_version FROM public.orders WHERE id = v_order_status;
  v_result := public.change_order_status_v2(
    v_order_status, v_status_closed_a, v_tenant_a, v_version
  );
  execute 'reset role';

  ASSERT (v_result->'order'->>'status_id')::uuid = v_status_closed_a,
    '[TEST 13] FAIL: change_order_status_v2 no cambió status';
  ASSERT (v_result->>'version') IS NOT NULL,
    '[TEST 13b] FAIL: change_order_status_v2 no devolvió version token';
  ASSERT (SELECT row_version FROM public.orders WHERE id = v_order_status) > v_version,
    '[TEST 13c] FAIL: trigger no incrementó row_version tras status change';

  -- =========================================================================
  -- TEST 14: assign_order_client_v2 funciona correctamente
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  SELECT row_version INTO v_version FROM public.orders WHERE id = v_order_client;
  v_result := public.assign_order_client_v2(
    v_order_client, v_client_1, v_tenant_a, v_version
  );
  execute 'reset role';

  ASSERT (v_result->'order'->>'client_id')::uuid = v_client_1,
    '[TEST 14] FAIL: assign_order_client_v2 no asignó cliente';
  ASSERT (v_result->>'version') IS NOT NULL,
    '[TEST 14b] FAIL: assign_order_client_v2 no devolvió version token';

  -- =========================================================================
  -- TEST 15: create_client_and_assign_order_v2 no deja huérfanos
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  SELECT COUNT(*) INTO v_clients_before FROM public.clients WHERE tenant_id = v_tenant_a;
  SELECT row_version INTO v_version FROM public.orders WHERE id = v_order_create;
  v_result := public.create_client_and_assign_order_v2(
    v_order_create, v_customer_type_a,
    'Cliente Nuevo P16', null, null, null,
    'nuevop16@example.com', null, null,
    v_tenant_a, v_version
  );
  execute 'reset role';

  SELECT COUNT(*) INTO v_clients_after FROM public.clients WHERE tenant_id = v_tenant_a;
  ASSERT v_clients_after = v_clients_before + 1,
    '[TEST 15] FAIL: create_client_and_assign_order_v2 no creó exactamente 1 cliente';
  ASSERT (v_result->'order'->>'client_id') IS NOT NULL,
    '[TEST 15b] FAIL: create_client_and_assign_order_v2 no devolvió client_id en el pedido';
  ASSERT (SELECT client_id FROM public.orders WHERE id = v_order_create) IS NOT NULL,
    '[TEST 15c] FAIL: pedido quedó sin cliente (cliente huérfano)';

  -- =========================================================================
  -- TEST 16: Kiosk sigue creando pedidos (row_version=0 on insert)
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('app.order_lifecycle', '', true);
  perform set_config('app.kiosk_submission', 'validated', true);

  v_order_kiosk_new := gen_random_uuid();
  insert into public.orders (
    id, tenant_id, title, status_id, metadata, created_by
  ) values (
    v_order_kiosk_new, v_tenant_a, 'Kiosk order phase16 new',
    v_status_initial_a,
    jsonb_build_object('source', 'kiosk'), null
  );

  SELECT row_version INTO v_kiosk_row_version FROM public.orders WHERE id = v_order_kiosk_new;
  ASSERT v_kiosk_row_version = 0,
    format('[TEST 16] FAIL: Kiosk insert row_version esperado 0, obtenido %s', v_kiosk_row_version);

  -- =========================================================================
  -- TEST 17: Lifecycle guard intacto — función y trigger existen
  -- =========================================================================

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tg_orders_lifecycle_guard'
  ), '[TEST 17] FAIL: función de guarda tg_orders_lifecycle_guard no existe';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'orders'
      AND t.tgname = 'trg_orders_lifecycle_guard'
  ), '[TEST 17b] FAIL: trigger trg_orders_lifecycle_guard no existe';

  -- =========================================================================
  -- TEST 18: activity_log sigue registrándose tras cambio v2
  -- =========================================================================
  SELECT COUNT(*) INTO v_log_count_before FROM public.activity_log WHERE entity_type = 'order';

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  SELECT row_version INTO v_version FROM public.orders WHERE id = v_order_main;
  PERFORM public.change_order_content_v2(
    v_order_main, 'title', 'Titulo Activity Log Test', v_tenant_a, v_version
  );
  execute 'reset role';

  SELECT COUNT(*) INTO v_log_count_after FROM public.activity_log WHERE entity_type = 'order';

  ASSERT v_log_count_after > v_log_count_before,
    '[TEST 18] FAIL: no se registró actividad tras change_order_content_v2';

  RAISE NOTICE 'phase16: todos los tests pasaron — v1 eliminadas, v2 intactas, comportamiento preservado';

end;
$phase16$;

rollback;
