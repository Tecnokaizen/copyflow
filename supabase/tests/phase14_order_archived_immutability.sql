-- Order Editing V1 · E1: archived orders are read-only in the database.
-- Run after 20260917214500_order_archived_immutability.sql against local db reset.
--
-- Covers the six editing RPCs:
--   change_order_content, change_order_details, change_order_management,
--   change_order_notification_status, assign_order_client,
--   create_client_and_assign_order
--
-- Product decision (E1): terminal (closed/cancelled) but NOT archived orders
-- stay editable on purpose. archived_at is the only read-only boundary.

begin;

do $phase14$
declare
  v_owner_a uuid := 'c1000000-0000-4000-8000-000000000001';
  v_staff_a uuid := 'c1000000-0000-4000-8000-000000000002';
  v_viewer_a uuid := 'c1000000-0000-4000-8000-000000000003';
  v_owner_b uuid := 'c1000000-0000-4000-8000-000000000004';
  v_tenant_a uuid := 'c1000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'c1000000-0000-4000-8000-000000000012';
  v_status_initial_a uuid := 'c1000000-0000-4000-8000-000000000021';
  v_status_closed_a uuid := 'c1000000-0000-4000-8000-000000000022';
  v_status_initial_b uuid := 'c1000000-0000-4000-8000-000000000023';
  v_service_a uuid := 'c1000000-0000-4000-8000-000000000031';
  v_service_b uuid := 'c1000000-0000-4000-8000-000000000032';
  v_channel_a uuid := 'c1000000-0000-4000-8000-000000000033';
  v_context_a uuid := 'c1000000-0000-4000-8000-000000000034';
  v_store_a uuid := 'c1000000-0000-4000-8000-000000000035';
  v_member_a uuid := 'c1000000-0000-4000-8000-000000000036';
  v_file_status_a uuid := 'c1000000-0000-4000-8000-000000000041';
  v_quote_status_a uuid := 'c1000000-0000-4000-8000-000000000042';
  v_payment_status_a uuid := 'c1000000-0000-4000-8000-000000000043';
  v_delivery_method_a uuid := 'c1000000-0000-4000-8000-000000000044';
  v_customer_type_a uuid := 'c1000000-0000-4000-8000-000000000051';
  v_client_1 uuid := 'c1000000-0000-4000-8000-000000000052';
  v_client_2 uuid := 'c1000000-0000-4000-8000-000000000053';
  v_order_open uuid := 'c1000000-0000-4000-8000-000000000061';
  v_order_terminal uuid := 'c1000000-0000-4000-8000-000000000062';
  v_order_archived uuid := 'c1000000-0000-4000-8000-000000000063';
  v_order_b uuid := 'c1000000-0000-4000-8000-000000000064';
  v_order_kiosk uuid := 'c1000000-0000-4000-8000-000000000065';
  v_sqlstate text;
  v_message text;
  v_count integer;
  v_clients_before integer;
  v_clients_after integer;
  v_result jsonb;
  v_snapshot public.orders%rowtype;
  v_after public.orders%rowtype;
  v_created_def text;
  v_kiosk_marker text;
begin
  -- ==========================================================
  -- Fixtures
  -- ==========================================================
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase14.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase14.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase14.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase14.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_staff_a, 'Staff A'),
    (v_viewer_a, 'Viewer A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase14', 'tenant-a-phase14', true),
    (v_tenant_b, 'Tenant B Phase14', 'tenant-b-phase14', true);

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
    (v_status_closed_a, v_tenant_a, 'Entregado', 'delivered', true, 2, false, false, true, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_a, v_tenant_a, 'Servicio A', true, 1);

  insert into public.entry_channels (id, tenant_id, name, code, active, sort_order) values
    (v_channel_a, v_tenant_a, 'Mostrador', 'counter', true, 1);

  insert into public.order_contexts (id, tenant_id, name, code, active, sort_order) values
    (v_context_a, v_tenant_a, 'Particular', 'retail', true, 1);

  insert into public.stores (id, tenant_id, name, code, active) values
    (v_store_a, v_tenant_a, 'Tienda Centro', 'centro', true);

  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values
    (v_member_a, v_tenant_a, 'Miembro A', true, true);

  insert into public.file_statuses (id, tenant_id, name, code, active, sort_order) values
    (v_file_status_a, v_tenant_a, 'Recibidos', 'received', true, 1);

  insert into public.quote_statuses (id, tenant_id, name, code, active, sort_order) values
    (v_quote_status_a, v_tenant_a, 'Aceptado', 'accepted', true, 1);

  insert into public.payment_statuses (id, tenant_id, name, code, active, sort_order) values
    (v_payment_status_a, v_tenant_a, 'Pagado', 'paid', true, 1);

  insert into public.delivery_methods (id, tenant_id, name, code, active, sort_order) values
    (v_delivery_method_a, v_tenant_a, 'Recogida', 'pickup', true, 1);

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
    (v_order_terminal, v_tenant_a, 'Terminal sin archivar', v_service_a, v_status_closed_a, v_owner_a),
    (v_order_archived, v_tenant_a, 'Para archivar', v_service_a, v_status_closed_a, v_owner_a);

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
    (v_order_b, v_tenant_b, 'Pedido B', v_service_b, v_status_initial_b, v_owner_b);

  execute 'reset role';

  -- ==========================================================
  -- 1) Baseline: the six RPCs work on a normal, open order
  -- ==========================================================
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  perform public.change_order_content(v_order_open, 'title', 'Titulo editado', v_tenant_a);
  perform public.change_order_details(v_order_open, 'priority', 'urgent', v_tenant_a);
  perform public.change_order_details(v_order_open, 'store_id', v_store_a::text, v_tenant_a);
  perform public.change_order_management(
    v_order_open, 'payment_status_id', v_payment_status_a, v_tenant_a
  );
  perform public.change_order_notification_status(v_order_open, 'notified', v_tenant_a);
  perform public.assign_order_client(v_order_open, v_client_1, v_tenant_a);

  execute 'reset role';

  select * into v_snapshot from public.orders where id = v_order_open;
  if v_snapshot.title is distinct from 'Titulo editado'
     or v_snapshot.priority is distinct from 'urgent'
     or v_snapshot.store_id is distinct from v_store_a
     or v_snapshot.payment_status_id is distinct from v_payment_status_a
     or v_snapshot.customer_notification_status is distinct from 'notified'
     or v_snapshot.client_id is distinct from v_client_1 then
    raise exception 'FAIL baseline editing broke on a non-archived order';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.create_client_and_assign_order(
    v_order_open, v_customer_type_a, 'Cliente Nuevo',
    null, null, null, null, null, null, v_tenant_a
  );
  execute 'reset role';

  if v_result #>> '{client,id}' is null then
    raise exception 'FAIL baseline create_client_and_assign_order';
  end if;

  -- ==========================================================
  -- 2) Product decision: terminal but NOT archived stays editable
  -- ==========================================================
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  perform public.change_order_content(
    v_order_terminal, 'notes', 'Correccion administrativa posterior', v_tenant_a
  );
  perform public.change_order_details(v_order_terminal, 'priority', 'high', v_tenant_a);
  perform public.change_order_management(
    v_order_terminal, 'quote_status_id', v_quote_status_a, v_tenant_a
  );
  perform public.assign_order_client(v_order_terminal, v_client_2, v_tenant_a);

  execute 'reset role';

  select * into v_after from public.orders where id = v_order_terminal;
  if v_after.notes is distinct from 'Correccion administrativa posterior'
     or v_after.priority is distinct from 'high'
     or v_after.quote_status_id is distinct from v_quote_status_a
     or v_after.client_id is distinct from v_client_2 then
    raise exception 'FAIL terminal non-archived order must stay editable';
  end if;
  if v_after.archived_at is not null then
    raise exception 'FAIL editing must not archive an order';
  end if;

  -- ==========================================================
  -- 3) The race: B archives while A still holds the ficha
  -- ==========================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.archive_order(v_order_archived, v_tenant_a);
  execute 'reset role';

  select * into v_snapshot from public.orders where id = v_order_archived;
  if v_snapshot.archived_at is null then
    raise exception 'FAIL fixture: order was not archived';
  end if;

  select count(*) into v_clients_before
  from public.clients where tenant_id = v_tenant_a;

  -- 3a) content ------------------------------------------------------------
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content(
      v_order_archived, 'title', 'No deberia escribirse', v_tenant_a
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL archived change_order_content: expected 42501 got %', v_sqlstate;
  end if;
  if v_message is distinct from 'order is archived' then
    raise exception 'FAIL archived change_order_content message: got %', v_message;
  end if;

  -- 3b) details ------------------------------------------------------------
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_details(v_order_archived, 'priority', 'urgent', v_tenant_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL archived change_order_details: % / %', v_sqlstate, v_message;
  end if;

  -- 3c) details with an unchanged value (idempotent path must also reject) --
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_details(
      v_order_archived, 'priority', v_snapshot.priority, v_tenant_a
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL archived no-op detail must reject: got %', v_sqlstate;
  end if;

  -- 3d) management ---------------------------------------------------------
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_management(
      v_order_archived, 'file_status_id', v_file_status_a, v_tenant_a
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL archived change_order_management: % / %', v_sqlstate, v_message;
  end if;

  -- 3e) notification -------------------------------------------------------
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_notification_status(
      v_order_archived, 'notified_no_pickup', v_tenant_a
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL archived change_order_notification_status: % / %', v_sqlstate, v_message;
  end if;

  -- 3f) assign_order_client ------------------------------------------------
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.assign_order_client(v_order_archived, v_client_1, v_tenant_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL archived assign_order_client: % / %', v_sqlstate, v_message;
  end if;

  -- 3g) create_client_and_assign_order -------------------------------------
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.create_client_and_assign_order(
      v_order_archived, v_customer_type_a, 'Cliente Huerfano',
      null, null, null, null, null, null, v_tenant_a
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL archived create_client_and_assign_order: % / %', v_sqlstate, v_message;
  end if;

  -- ==========================================================
  -- 4) No mutation was applied by any of the rejected calls
  -- ==========================================================
  select * into v_after from public.orders where id = v_order_archived;

  if v_after.title is distinct from v_snapshot.title
     or v_after.description is distinct from v_snapshot.description
     or v_after.notes is distinct from v_snapshot.notes
     or v_after.priority is distinct from v_snapshot.priority
     or v_after.due_at is distinct from v_snapshot.due_at
     or v_after.service_id is distinct from v_snapshot.service_id
     or v_after.entry_channel_id is distinct from v_snapshot.entry_channel_id
     or v_after.order_context_id is distinct from v_snapshot.order_context_id
     or v_after.store_id is distinct from v_snapshot.store_id
     or v_after.assigned_team_member_id is distinct from v_snapshot.assigned_team_member_id
     or v_after.file_status_id is distinct from v_snapshot.file_status_id
     or v_after.quote_status_id is distinct from v_snapshot.quote_status_id
     or v_after.payment_status_id is distinct from v_snapshot.payment_status_id
     or v_after.delivery_method_id is distinct from v_snapshot.delivery_method_id
     or v_after.customer_notification_status is distinct from v_snapshot.customer_notification_status
     or v_after.client_id is distinct from v_snapshot.client_id
     or v_after.status_id is distinct from v_snapshot.status_id
     or v_after.archived_at is distinct from v_snapshot.archived_at
     or v_after.updated_at is distinct from v_snapshot.updated_at then
    raise exception 'FAIL archived order was mutated by a rejected RPC';
  end if;

  select count(*) into v_clients_after
  from public.clients where tenant_id = v_tenant_a;
  if v_clients_after is distinct from v_clients_before then
    raise exception 'FAIL rejected create_client_and_assign_order left an orphan client';
  end if;

  -- ==========================================================
  -- 5) Tenant isolation is intact
  -- ==========================================================
  -- Cross-tenant order id under the actor's own tenant -> not found.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content(
      v_order_archived, 'title', 'cross tenant', v_tenant_b
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from 'P0002' then
    raise exception 'FAIL cross-tenant lookup: expected P0002 got %', v_sqlstate;
  end if;

  -- Foreign tenant_id passed explicitly -> role check denies first.
  v_sqlstate := null;
  begin
    perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content(
      v_order_open, 'title', 'cross tenant', v_tenant_a
    );
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL cross-tenant role check: expected 42501 got %', v_sqlstate;
  end if;
  if v_message is distinct from 'tenant access denied' then
    raise exception 'FAIL cross-tenant must deny on role, not on archive: %', v_message;
  end if;

  -- ==========================================================
  -- 6) Viewer is still denied (before and after archiving)
  -- ==========================================================
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_content(v_order_open, 'title', 'viewer', v_tenant_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501'
     or v_message is distinct from 'tenant access denied' then
    raise exception 'FAIL viewer on open order: % / %', v_sqlstate, v_message;
  end if;

  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_details(v_order_archived, 'priority', 'high', v_tenant_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL viewer on archived order: %', v_sqlstate;
  end if;
  -- Role is checked before the archive state: viewer never learns the reason.
  if v_message is distinct from 'tenant access denied' then
    raise exception 'FAIL viewer must be denied by role first: %', v_message;
  end if;

  -- ==========================================================
  -- 7) Lifecycle V1 contract untouched
  -- ==========================================================
  v_sqlstate := null; v_message := null;
  begin
    perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.change_order_status(v_order_archived, v_status_initial_a, v_tenant_a);
    execute 'reset role';
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
    execute 'reset role';
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL change_order_status archived contract drifted: % / %',
      v_sqlstate, v_message;
  end if;

  -- archive_order stays idempotent.
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_result := public.archive_order(v_order_archived, v_tenant_a);
  execute 'reset role';
  if coalesce((v_result ->> 'replay')::boolean, false) is not true then
    raise exception 'FAIL archive_order replay contract drifted';
  end if;

  -- ==========================================================
  -- 8) Kiosk regression
  -- ==========================================================
  -- Mimic the signed private submit marker only; no order_lifecycle GUC.
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
    'Kiosk archived-immutability compatibility',
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
    raise exception 'FAIL Kiosk INSERT audit broken by E1 (count=%)', v_count;
  end if;

  if coalesce(v_kiosk_marker, '') = 'validated' then
    raise exception 'FAIL test setup polluted order_lifecycle';
  end if;

  select pg_get_functiondef('public.tg_activity_log_order_created()'::regprocedure)
  into v_created_def;
  if position('app.kiosk_submission' in v_created_def) = 0
     or position('source' in v_created_def) = 0 then
    raise exception 'FAIL tg_activity_log_order_created Kiosk contract altered';
  end if;

  raise notice 'PASS phase14_order_archived_immutability';
end;
$phase14$;

commit;
