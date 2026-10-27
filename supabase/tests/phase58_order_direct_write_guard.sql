-- Local only. R5: direct writes to public.orders only through controlled RPCs
-- (20261022120000_order_direct_write_guard_v1.sql).
-- Run it in a NEW psql session: the first assertion checks that app.order_write
-- was never set (NULL), the state of a fresh pooled connection.
-- Rollback-only.
--
-- A SQL session can call set_config itself; an API user cannot (PostgREST only
-- exposes public/graphql_public). Section 7 sets the marker by hand only to
-- prove that identity columns stay fixed even with it. The API-level proof is
-- phase58_order_direct_write_guard_api.sh; the catalog proof lives in
-- release_gate_security_invariants.sql.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase58: %', label;
  end if;
end $$;

create function pg_temp.boom(statement text, expected text, msg text default null) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected and (msg is null or sqlerrm = msg) then
      return;
    end if;
    raise exception 'phase58 expected % %, got %: % (statement: %)', expected, coalesce(msg, ''), sqlstate, sqlerrm, statement;
  end;
  raise exception 'phase58 unexpectedly succeeded: %', statement;
end $$;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
end $$;

create function pg_temp.rv(o uuid) returns bigint language sql as $$
  select row_version from public.orders where id = o
$$;

create function pg_temp.marker() returns text language sql as $$
  select pg_catalog.current_setting('app.order_write', true)
$$;

do $$
declare
  a uuid := 'e5800000-0000-4000-8000-000000000001';   -- owner, tenant A
  s uuid := 'e5800000-0000-4000-8000-000000000002';   -- staff, tenant A
  vw uuid := 'e5800000-0000-4000-8000-000000000003';  -- viewer, tenant A
  b uuid := 'e5800000-0000-4000-8000-000000000004';   -- owner, tenant B
  ta uuid := 'e5800000-0000-4000-8000-000000000011';
  tb uuid := 'e5800000-0000-4000-8000-000000000012';
  st_init uuid := 'e5800000-0000-4000-8000-000000000021';
  st_ready uuid := 'e5800000-0000-4000-8000-000000000022';
  st_closed uuid := 'e5800000-0000-4000-8000-000000000023';
  st_b uuid := 'e5800000-0000-4000-8000-000000000024';
  svc uuid := 'e5800000-0000-4000-8000-000000000031';
  chan uuid := 'e5800000-0000-4000-8000-000000000032';
  member uuid := 'e5800000-0000-4000-8000-000000000033';
  fstat uuid := 'e5800000-0000-4000-8000-000000000034';
  ctype uuid := 'e5800000-0000-4000-8000-000000000035';
  cli uuid := 'e5800000-0000-4000-8000-000000000036';
  o1 uuid := 'e5800000-0000-4000-8000-000000000041';
  o_arch uuid := 'e5800000-0000-4000-8000-000000000042';
  o_flow uuid := 'e5800000-0000-4000-8000-000000000043';
  o_cli uuid := 'e5800000-0000-4000-8000-000000000044';
  o_null uuid := 'e5800000-0000-4000-8000-000000000045';
  ob uuid := 'e5800000-0000-4000-8000-000000000046';
  blocked constant text := 'orders can only change through controlled RPCs';
  identity constant text := 'order identity columns are immutable';
  r jsonb;
  v bigint;
  n integer;
  col text;
  mark text;
begin
  perform pg_temp.ok(pg_temp.marker() is null,
    'fixture: run this file in a new session (app.order_write must be unset)');

  -- Fixtures (postgres).
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase58.test', '{}'), (s, 's@phase58.test', '{}'),
    (vw, 'v@phase58.test', '{}'), (b, 'b@phase58.test', '{}');
  insert into public.profiles (id, full_name) values
    (a, 'Ana'), (s, 'Sara'), (vw, 'Vero'), (b, 'Bruno');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase58 A', 'phase58a', true), (tb, 'Phase58 B', 'phase58b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, s, 'staff', true), (ta, vw, 'viewer', true),
    (tb, b, 'owner', true);
  insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled) values
    (st_init, ta, 'Recibido', 'received', true, 1, true, false, false, false),
    (st_ready, ta, 'Listo', 'ready', true, 2, false, true, false, false),
    (st_closed, ta, 'Entregado', 'delivered', true, 3, false, false, true, false),
    (st_b, tb, 'Recibido', 'received', true, 1, true, false, false, false);
  perform pg_temp.as_user(a); -- catalogue activity triggers need an actor
  insert into public.services (id, tenant_id, name, active, sort_order) values (svc, ta, 'Servicio', true, 1);
  insert into public.entry_channels (id, tenant_id, name, code, active, sort_order) values (chan, ta, 'Mostrador', 'counter', true, 1);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (member, ta, 'Miembro', true, true);
  insert into public.file_statuses (id, tenant_id, name, code, active, sort_order) values (fstat, ta, 'Recibidos', 'received', true, 1);
  insert into public.customer_types (id, tenant_id, name, active, sort_order) values (ctype, ta, 'Particular', true, 1);
  insert into public.clients (id, tenant_id, customer_type_id, name, active, created_by) values (cli, ta, ctype, 'Cliente', true, a);

  -- 1. R5-B: staff still creates orders with what POST /api/orders writes (+ id).
  perform pg_temp.as_user(s);
  set local role authenticated;
  insert into public.orders (
    id, tenant_id, title, description, client_id, service_id, assigned_team_member_id,
    status_id, entry_channel_id, order_context_id, store_id, priority, due_at, notes,
    file_status_id, created_by
  ) values (
    o1, ta, 'Pedido R5', '<p>Descripción</p>', null, svc, member,
    st_init, chan, null, null, 'normal', '2026-11-02T10:00:00Z', '<p>Nota</p>',
    null, s
  );
  insert into public.orders (id, tenant_id, title, status_id, created_by) values
    (o_arch, ta, 'Para archivar', st_closed, s),
    (o_flow, ta, 'Flujo', st_init, s),
    (o_cli, ta, 'Cliente', st_init, s);
  insert into public.orders (id, tenant_id, title, status_id) values (o_null, ta, 'Sin autor', st_init);
  perform pg_temp.ok((select created_by is null from public.orders where id = o_null), 'created_by may stay NULL');
  perform pg_temp.ok((select reference is not null and row_version = 0 from public.orders where id = o1),
    'reference and row_version still come from the database');

  -- 2. A fresh session (marker NULL): every direct UPDATE is refused, even a no-op.
  foreach col in array array[
    'id', 'tenant_id', 'reference', 'title', 'description', 'client_id', 'service_id',
    'assigned_team_member_id', 'entry_channel_id', 'order_context_id', 'file_status_id',
    'quote_status_id', 'payment_status_id', 'delivery_method_id', 'priority', 'received_at',
    'due_at', 'customer_notification_status', 'customer_notified_at', 'customer_notified_by',
    'external_folder_url', 'notes', 'requirements_override', 'metadata', 'created_by',
    'created_at', 'updated_at', 'store_id', 'row_version'
  ] loop
    perform pg_temp.boom(format('update public.orders set %1$I = %1$I where id = %2$L', col, o1), '42501', blocked);
  end loop;
  perform pg_temp.boom(format($q$update public.orders set assigned_team_member_id = null, priority = 'urgent', due_at = now(), notes = 'x' where id = %L$q$, o1), '42501', blocked);
  perform pg_temp.boom(format($q$update public.orders set customer_notified_by = %L, customer_notification_status = 'notified' where id = %L$q$, a, o1), '42501', blocked);
  perform pg_temp.boom(format($q$update public.orders set metadata = '{"source":"kiosk"}' where id = %L$q$, o1), '42501', blocked);

  -- The older guards fire first and keep their messages.
  perform pg_temp.boom(format('update public.orders set status_id = %L where id = %L', st_ready, o1), '42501',
    'order lifecycle fields can only change through controlled RPCs');
  perform pg_temp.boom(format('update public.orders set total_amount = 5 where id = %L', o1), '42501', 'total_amount_rpc_only');
  perform pg_temp.boom(format($q$update public.orders set total_mode = 'items' where id = %L$q$, o1), '42501', 'order_items_columns_rpc_only');

  -- 3. Anything but exactly 'validated' keeps the gate shut.
  foreach mark in array array['', 'x', 'VALIDATED', ' validated', 'validated '] loop
    perform set_config('app.order_write', mark, true);
    perform pg_temp.boom(format($q$update public.orders set notes = 'x' where id = %L$q$, o1), '42501', blocked);
  end loop;
  perform set_config('app.order_write', '', true);

  -- 4. Each of the eight RPCs still works for staff, bumps row_version, and
  --    leaves the marker closed: a direct UPDATE right after, in the same
  --    transaction, is still refused.
  v := pg_temp.rv(o1);
  r := public.change_order_content_v2(o1, 'title', 'Título nuevo', ta, v);
  perform pg_temp.ok((r->>'version')::bigint = v + 1 and r->'order'->>'title' = 'Título nuevo', 'content_v2 title');
  perform pg_temp.ok(pg_temp.marker() = '', 'content_v2 clears the marker');
  perform pg_temp.boom(format($q$update public.orders set notes = 'x' where id = %L$q$, o1), '42501', blocked);
  r := public.change_order_content_v2(o1, 'external_folder_url', 'https://drive.example.com/r5', ta, pg_temp.rv(o1));
  perform pg_temp.ok(r->'order'->>'external_folder_url' = 'https://drive.example.com/r5', 'content_v2 external_folder_url');

  r := public.change_order_details_v2(o1, 'priority', 'high', ta, pg_temp.rv(o1));
  perform pg_temp.ok(r->'order'->>'priority' = 'high', 'details_v2 priority');
  r := public.change_order_details_v2(o1, 'assigned_team_member_id', null, ta, pg_temp.rv(o1));
  perform pg_temp.ok(r->'order'->>'assigned_team_member_id' is null, 'details_v2 unassign');
  r := public.change_order_details_v2(o1, 'due_at', '2026-11-05T10:00:00Z', ta, pg_temp.rv(o1));
  perform pg_temp.ok(pg_temp.marker() = '', 'details_v2 clears the marker');
  perform pg_temp.boom(format($q$update public.orders set priority = 'urgent' where id = %L$q$, o1), '42501', blocked);

  r := public.change_order_management_v2(o1, 'file_status_id', fstat, ta, pg_temp.rv(o1));
  perform pg_temp.ok((select file_status_id = fstat from public.orders where id = o1), 'management_v2 file status');
  perform pg_temp.ok(pg_temp.marker() = '', 'management_v2 clears the marker');

  r := public.change_order_notification_status_v2(o1, 'notified', ta, pg_temp.rv(o1));
  perform pg_temp.ok((select customer_notification_status = 'notified' and customer_notified_by = s from public.orders where id = o1),
    'notification_v2 records the real actor');
  perform pg_temp.ok(pg_temp.marker() = '', 'notification_v2 clears the marker');

  r := public.assign_order_client_v2(o_cli, cli, ta, pg_temp.rv(o_cli));
  perform pg_temp.ok((select client_id = cli from public.orders where id = o_cli), 'assign_order_client_v2');
  perform pg_temp.ok(pg_temp.marker() = '', 'assign_order_client_v2 clears the marker');
  r := public.create_client_and_assign_order_v2(o_cli, ctype, 'Cliente nuevo', null, null, null, 'nuevo@phase58.test', null, null, ta, pg_temp.rv(o_cli));
  perform pg_temp.ok((select client_id <> cli from public.orders where id = o_cli), 'create_client_and_assign_order_v2');
  perform pg_temp.ok(pg_temp.marker() = '', 'create_client_and_assign_order_v2 clears the marker');

  r := public.change_order_status_v2(o_flow, st_ready, ta, pg_temp.rv(o_flow));
  perform pg_temp.ok((select status_id = st_ready and ready_at is not null from public.orders where id = o_flow), 'status_v2 ready');
  r := public.change_order_status_v2(o_flow, st_closed, ta, pg_temp.rv(o_flow));
  perform pg_temp.ok(pg_temp.marker() = '', 'status_v2 clears the marker');
  r := public.archive_order(o_flow, ta);
  perform pg_temp.ok((select archived_at is not null from public.orders where id = o_flow), 'archive_order');
  perform pg_temp.ok(pg_temp.marker() = '', 'archive_order clears the marker');
  perform pg_temp.boom(format($q$update public.orders set notes = 'x' where id = %L$q$, o_flow), '42501', blocked);

  -- Activity still records the RPC changes with the real actor (read as
  -- postgres: staff cannot read activity_log).
  reset role;
  perform pg_temp.ok((select count(*) >= 5 from public.activity_log
                      where tenant_id = ta and entity_id = o1 and user_id = s), 'activity log keeps the RPC changes');
  set local role authenticated;

  -- Other roles keep using the RPCs.
  perform pg_temp.as_user(a);
  r := public.change_order_content_v2(o1, 'notes', '<p>Owner</p>', ta, pg_temp.rv(o1));
  perform pg_temp.ok(r->'order'->>'notes' = '<p>Owner</p>', 'owner uses content_v2');
  perform pg_temp.as_user(s);

  -- 5. Archived orders: the direct PATCH that used to pass is refused, and the
  --    RPC answer is unchanged.
  r := public.archive_order(o_arch, ta);
  perform pg_temp.boom(format($q$update public.orders set assigned_team_member_id = %L where id = %L$q$, member, o_arch), '42501', blocked);
  perform pg_temp.boom(format($q$update public.orders set priority = 'urgent', due_at = now(), notes = 'x' where id = %L$q$, o_arch), '42501', blocked);
  perform pg_temp.boom(format($q$select public.change_order_details_v2(%L, 'priority', 'urgent', %L, %s)$q$, o_arch, ta, pg_temp.rv(o_arch)), '42501', 'order is archived');

  -- 6. SECURITY DEFINER RPCs are unaffected.
  r := public.set_order_total_amount(o1, '12.50', pg_temp.rv(o1)::text);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '12.50', 'set_order_total_amount still works');

  -- 7. Identity columns stay fixed even with the marker (set by hand here: only
  --    a SQL session can do that). The marker alone opens ordinary columns.
  perform set_config('app.order_write', 'validated', true);
  perform pg_temp.boom(format($q$update public.orders set reference = 'R5-FAKE' where id = %L$q$, o1), '42501', identity);
  perform pg_temp.boom(format('update public.orders set tenant_id = %L where id = %L', tb, o1), '42501', identity);
  perform pg_temp.boom(format('update public.orders set id = gen_random_uuid() where id = %L', o_null), '42501', identity);
  perform pg_temp.boom(format('update public.orders set created_by = %L where id = %L', a, o1), '42501', identity);
  perform pg_temp.boom(format($q$update public.orders set created_at = now() - interval '1 day' where id = %L$q$, o1), '42501', identity);
  update public.orders set notes = 'con marca' where id = o_null;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 1, 'the marker is what opens the gate');
  perform set_config('app.order_write', '', true);
  perform pg_temp.boom(format($q$update public.orders set notes = 'x' where id = %L$q$, o_null), '42501', blocked);

  -- 8. RLS unchanged: viewer and other tenants touch no row (the trigger never fires).
  perform pg_temp.as_user(vw);
  update public.orders set notes = 'viewer' where id = o1;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'viewer direct UPDATE touches no row');
  perform pg_temp.as_user(b);
  update public.orders set notes = 'tenant B' where id = o1;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'tenant B direct UPDATE touches no row');
  perform pg_temp.as_user(s);

  -- 9. R5-B: a direct INSERT cannot set lifecycle, audit or computed columns,
  --    nor name another member as its author.
  foreach col in array array[
    'archived_at', 'ready_at', 'delivered_at', 'customer_notification_status',
    'customer_notified_at', 'customer_notified_by', 'reference', 'metadata',
    'requirements_override', 'received_at', 'row_version', 'external_folder_url',
    'quote_status_id', 'payment_status_id', 'delivery_method_id', 'total_amount',
    'total_mode', 'created_at', 'updated_at'
  ] loop
    perform pg_temp.boom(format($q$insert into public.orders (tenant_id, title, status_id, %I) values (%L, 'x', %L, default)$q$, col, ta, st_init),
      '42501', 'permission denied for table orders');
  end loop;
  perform pg_temp.boom(format($q$insert into public.orders (tenant_id, title, status_id, created_by) values (%L, 'x', %L, %L)$q$, ta, st_init, a),
    '42501', 'order created_by must be the current user');
  perform pg_temp.boom(format($q$insert into public.orders (tenant_id, title, status_id, created_by) values (%L, 'x', %L, %L)$q$, tb, st_b, s),
    '42501', 'new row violates row-level security policy for table "orders"');

  -- 10. postgres (migrations, seeds) may still write; service_role may not.
  reset role;
  update public.orders set notes = 'mantenimiento' where id = o1;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 1, 'postgres keeps direct access');
  set local role service_role;
  perform pg_temp.boom(format($q$update public.orders set notes = 'x' where id = %L$q$, o1), '42501', blocked);
  reset role;

  -- 11. Catalog: only the eight INVOKER RPCs (and the guard) know the marker;
  --     every UPDATE they run is preceded by it and each clears it once.
  perform pg_temp.ok((
    select array_agg(p.proname::text order by p.proname)
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where p.prosrc like '%app.order_write%'
      and ns.nspname not like 'pg\_temp%'
  ) = array[
    'archive_order', 'assign_order_client_v2', 'change_order_content_v2',
    'change_order_details_v2', 'change_order_management_v2',
    'change_order_notification_status_v2', 'change_order_status_v2',
    'create_client_and_assign_order_v2', 'tg_orders_write_guard'
  ]::text[], 'only the eight RPCs and the guard reference app.order_write');
  perform pg_temp.ok(not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and not p.prosecdef and p.prorettype <> 'trigger'::regtype
      and p.prosrc ~* '\mupdate\s+public\.orders\M'
      and (
        (select count(*) from regexp_matches(p.prosrc, $r$set_config\('app\.order_write', 'validated', true\)$r$, 'g'))
          <> (select count(*) from regexp_matches(p.prosrc, '\mupdate\s+public\.orders\M', 'gi'))
        or (select count(*) from regexp_matches(p.prosrc, $r$set_config\('app\.order_write', '', true\)$r$, 'g')) <> 1
      )
  ), 'every INVOKER UPDATE of orders is marked and each RPC clears the marker once');
  perform pg_temp.ok(not exists (
    select 1 from pg_proc p
    where p.proconfig::text like '%app.order_write%'
  ), 'no function stores the marker in its configuration');
  perform pg_temp.ok(exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.orders'::regclass and t.tgname = 'trg_orders_write_guard'
      and t.tgenabled = 'O' and not t.tgisinternal
  ), 'trg_orders_write_guard is enabled');

  raise notice 'phase58 order direct write guard: all assertions passed';
end $$;
rollback;
