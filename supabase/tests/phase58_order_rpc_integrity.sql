-- Local only. R5 (20261022120000): the eight order RPCs keep their original
-- logic on every execution path, and the app.order_write marker never outlives
-- a call. Rollback-only.
--
-- The same assertions hold on main (no marker) and on R5, so this file also
-- proves that R5 did not change what the RPCs do:
--   * FOUND: when the UPDATE touches no row (a probe trigger skips it), each RPC
--     raises its own "could not ..." error instead of answering success;
--   * errors raised inside the UPDATE propagate (no RPC swallows them), nothing
--     is written and the marker is closed again;
--   * the success path bumps row_version once and closes the marker;
--   * authorization and RLS: viewer and another tenant are refused exactly as
--     before, and a stale version is still refused.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase58 integrity: %', label;
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
    raise exception 'phase58 integrity expected % %, got %: % (statement: %)', expected, coalesce(msg, ''), sqlstate, sqlerrm, statement;
  end;
  raise exception 'phase58 integrity unexpectedly succeeded: %', statement;
end $$;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
end $$;

create function pg_temp.rv(o uuid) returns bigint language sql as $$
  select row_version from public.orders where id = o
$$;

-- Never 'validated' outside an RPC: NULL on main, '' after an R5 RPC.
create function pg_temp.marker_closed() returns boolean language sql as $$
  select coalesce(pg_catalog.current_setting('app.order_write', true), '') <> 'validated'
$$;

-- Probe (rolled back with the file): first BEFORE UPDATE trigger on orders.
-- phase58.skip = order id -> the row is skipped (UPDATE touches 0 rows);
-- phase58.fail = order id -> the UPDATE raises.
create function public.zz_phase58_probe() returns trigger language plpgsql set search_path to '' as $$
begin
  if old.id::text = coalesce(pg_catalog.current_setting('phase58.skip', true), '') then
    return null;
  end if;
  if old.id::text = coalesce(pg_catalog.current_setting('phase58.fail', true), '') then
    raise exception 'phase58 forced failure' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger aaa_phase58_probe before update on public.orders
  for each row execute function public.zz_phase58_probe();

do $$
declare
  a uuid := 'e5830000-0000-4000-8000-000000000001';   -- owner, tenant A
  s uuid := 'e5830000-0000-4000-8000-000000000002';   -- staff, tenant A
  vw uuid := 'e5830000-0000-4000-8000-000000000003';  -- viewer, tenant A
  b uuid := 'e5830000-0000-4000-8000-000000000004';   -- owner, tenant B
  ta uuid := 'e5830000-0000-4000-8000-000000000011';
  tb uuid := 'e5830000-0000-4000-8000-000000000012';
  st_init uuid := 'e5830000-0000-4000-8000-000000000021';
  st_ready uuid := 'e5830000-0000-4000-8000-000000000022';
  st_closed uuid := 'e5830000-0000-4000-8000-000000000023';
  st_b uuid := 'e5830000-0000-4000-8000-000000000024';
  svc uuid := 'e5830000-0000-4000-8000-000000000031';
  fstat uuid := 'e5830000-0000-4000-8000-000000000032';
  ctype uuid := 'e5830000-0000-4000-8000-000000000033';
  cli uuid := 'e5830000-0000-4000-8000-000000000034';
  rpc record;
  o uuid;
  v bigint;
  n_clients bigint;
  stmt text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase58i.test', '{}'), (s, 's@phase58i.test', '{}'),
    (vw, 'v@phase58i.test', '{}'), (b, 'b@phase58i.test', '{}');
  insert into public.profiles (id, full_name) values (a, 'Ana'), (s, 'Sara'), (vw, 'Vero'), (b, 'Bruno');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase58i A', 'phase58ia', true), (tb, 'Phase58i B', 'phase58ib', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, s, 'staff', true), (ta, vw, 'viewer', true), (tb, b, 'owner', true);
  insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled) values
    (st_init, ta, 'Recibido', 'received', true, 1, true, false, false, false),
    (st_ready, ta, 'Listo', 'ready', true, 2, false, true, false, false),
    (st_closed, ta, 'Entregado', 'delivered', true, 3, false, false, true, false),
    (st_b, tb, 'Recibido', 'received', true, 1, true, false, false, false);
  perform pg_temp.as_user(a);
  insert into public.services (id, tenant_id, name, active, sort_order) values (svc, ta, 'Servicio', true, 1);
  insert into public.file_statuses (id, tenant_id, name, code, active, sort_order) values (fstat, ta, 'Recibidos', 'received', true, 1);
  insert into public.customer_types (id, tenant_id, name, active, sort_order) values (ctype, ta, 'Particular', true, 1);
  insert into public.clients (id, tenant_id, customer_type_id, name, active, created_by) values (cli, ta, ctype, 'Cliente', true, a);

  -- One order per RPC; archive_order needs a terminal order.
  create temporary table phase58_rpcs (
    label text, order_id uuid, status_id uuid, call text, found_msg text, versioned boolean,
    -- answer when another tenant calls with its own tenant id (each RPC's original order of checks)
    other_state text default 'P0002', other_msg text default 'order not found'
  ) on commit drop;
  insert into phase58_rpcs (label, order_id, status_id, call, found_msg, versioned) values
    ('change_order_content_v2', gen_random_uuid(), st_init,
     $c$select public.change_order_content_v2(%1$L, 'title', 'Nuevo título', %2$L, %3$s)$c$, 'could not update order content', true),
    ('change_order_details_v2', gen_random_uuid(), st_init,
     $c$select public.change_order_details_v2(%1$L, 'priority', 'high', %2$L, %3$s)$c$, 'could not update order details', true),
    ('change_order_management_v2', gen_random_uuid(), st_init,
     format($c$select public.change_order_management_v2(%%1$L, 'file_status_id', %L, %%2$L, %%3$s)$c$, fstat), 'could not update order management', true),
    ('change_order_notification_status_v2', gen_random_uuid(), st_init,
     $c$select public.change_order_notification_status_v2(%1$L, 'notified', %2$L, %3$s)$c$, 'could not update order', true),
    ('assign_order_client_v2', gen_random_uuid(), st_init,
     format($c$select public.assign_order_client_v2(%%1$L, %L, %%2$L, %%3$s)$c$, cli), 'could not update order client', true),
    ('create_client_and_assign_order_v2', gen_random_uuid(), st_init,
     format($c$select public.create_client_and_assign_order_v2(%%1$L, %L, 'Cliente nuevo', null, null, null, 'nuevo@phase58i.test', null, null, %%2$L, %%3$s)$c$, ctype),
     'could not assign client to order', true),
    ('change_order_status_v2', gen_random_uuid(), st_init,
     format($c$select public.change_order_status_v2(%%1$L, %L, %%2$L, %%3$s)$c$, st_ready), 'could not update order', true),
    ('archive_order', gen_random_uuid(), st_closed,
     $c$select public.archive_order(%1$L, %2$L)$c$, 'could not archive order', false);
  -- create_client_and_assign_order_v2 checks the customer type before the order.
  update phase58_rpcs set other_state = '22023', other_msg = 'invalid customer type for current tenant'
    where label = 'create_client_and_assign_order_v2';
  grant select on phase58_rpcs to authenticated;

  perform pg_temp.as_user(s);
  set local role authenticated;
  for rpc in select * from phase58_rpcs loop
    insert into public.orders (id, tenant_id, title, status_id, created_by)
      values (rpc.order_id, ta, rpc.label, rpc.status_id, s);
  end loop;

  for rpc in select * from phase58_rpcs order by label loop
    o := rpc.order_id;

    -- 1. FOUND: the UPDATE touches no row -> the RPC's own error, nothing written.
    perform set_config('phase58.skip', o::text, true);
    v := pg_temp.rv(o);
    select count(*) into n_clients from public.clients where tenant_id = ta;
    perform pg_temp.boom(format(rpc.call, o, ta, v), 'P0001', rpc.found_msg);
    perform pg_temp.ok(pg_temp.marker_closed(), rpc.label || ': marker closed after a 0-row UPDATE');
    perform pg_temp.ok(pg_temp.rv(o) = v, rpc.label || ': 0-row UPDATE writes nothing');
    perform pg_temp.ok((select count(*) from public.clients where tenant_id = ta) = n_clients,
      rpc.label || ': 0-row UPDATE leaves no orphan row');
    perform set_config('phase58.skip', '', true);

    -- 2. An error inside the UPDATE propagates; nothing written; marker closed.
    perform set_config('phase58.fail', o::text, true);
    perform pg_temp.boom(format(rpc.call, o, ta, v), 'P0001', 'phase58 forced failure');
    perform pg_temp.ok(pg_temp.marker_closed(), rpc.label || ': marker closed after a failed UPDATE');
    perform pg_temp.ok(pg_temp.rv(o) = v, rpc.label || ': failed UPDATE writes nothing');
    perform pg_temp.ok((select count(*) from public.clients where tenant_id = ta) = n_clients,
      rpc.label || ': failed UPDATE leaves no orphan row');
    perform set_config('phase58.fail', '', true);

    -- 3. Authorization and RLS, unchanged: viewer and another tenant are refused,
    --    an order of another tenant is not found.
    perform pg_temp.as_user(vw);
    perform pg_temp.boom(format(rpc.call, o, ta, v), '42501', 'tenant access denied');
    perform pg_temp.as_user(b);
    perform pg_temp.boom(format(rpc.call, o, ta, v), '42501', 'tenant access denied');
    perform pg_temp.boom(format(rpc.call, o, tb, v), rpc.other_state, rpc.other_msg);
    perform pg_temp.as_user(s);
    perform pg_temp.ok(pg_temp.marker_closed(), rpc.label || ': marker closed after refusals');

    -- 4. Optimistic concurrency, unchanged: a stale version is refused.
    if rpc.versioned then
      perform pg_temp.boom(format(rpc.call, o, ta, v + 7), 'GCO01', 'order has been modified since last read');
    end if;

    -- 5. Success: one row_version bump, marker closed afterwards.
    execute format(rpc.call, o, ta, v);
    perform pg_temp.ok(pg_temp.rv(o) = v + 1, rpc.label || ': success bumps row_version once');
    perform pg_temp.ok(pg_temp.marker_closed(), rpc.label || ': marker closed after success');
  end loop;

  reset role;
  raise notice 'phase58 order RPC integrity: all assertions passed';
end $$;
rollback;
