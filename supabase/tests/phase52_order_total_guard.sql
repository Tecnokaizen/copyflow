-- Local only. P0 hotfix: the orders.total_amount guard must hold on a session that
-- never set gestcopy.order_total_write (the GUC is NULL), for every role, and the
-- authorized RPCs, collections and tenant isolation must keep working.
-- Run it in a NEW psql session: the first assertion checks the GUC is still unset.
-- Rollback-only.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase52: %', label;
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
    raise exception 'phase52 expected % %, got %: %', expected, coalesce(msg, ''), sqlstate, sqlerrm;
  end;
  raise exception 'phase52 unexpectedly succeeded: %', statement;
end $$;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
end $$;

create function pg_temp.rv(o uuid) returns text language sql as $$
  select row_version::text from public.orders where id = o
$$;

do $$
declare
  a uuid := 'e5200000-0000-4000-8000-000000000001';
  b uuid := 'e5200000-0000-4000-8000-000000000002';
  vwr uuid := 'e5200000-0000-4000-8000-000000000003';
  ta uuid := 'e5200000-0000-4000-8000-000000000011';
  tb uuid := 'e5200000-0000-4000-8000-000000000012';
  plan uuid := 'e5200000-0000-4000-8000-000000000041';
  st_a uuid;
  st_b uuid;
  oa uuid := 'e5200000-0000-4000-8000-000000000031';
  oa2 uuid := 'e5200000-0000-4000-8000-000000000032';
  ob uuid := 'e5200000-0000-4000-8000-000000000033';
  r jsonb;
  pay uuid;
  paid_at timestamptz := '2026-10-16T08:00:00Z';
  n integer;
begin
  -- Fresh session: the flag was never set.
  perform pg_temp.ok(
    pg_catalog.current_setting('gestcopy.order_total_write', true) is null,
    'fixture: run this file in a new session (GUC must be unset)');

  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase52.test', '{}'), (b, 'b@phase52.test', '{}'), (vwr, 'v@phase52.test', '{}');
  insert into public.profiles (id, full_name) values (a, 'Ana'), (b, 'Bruno'), (vwr, 'Vero');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase52 A', 'phase52a', true), (tb, 'Phase52 B', 'phase52b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, vwr, 'viewer', true), (tb, b, 'owner', true);
  insert into public.order_statuses (tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
  values (ta, 'Recibido', 'received', true, 1, true, false, false, false),
         (tb, 'Recibido', 'received', true, 1, true, false, false, false);
  select id into st_a from public.order_statuses where tenant_id = ta and is_initial;
  select id into st_b from public.order_statuses where tenant_id = tb and is_initial;
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (plan, 'phase52', 'Phase52', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
  select plan, id, true, 500 from public.features where code = 'storage_bytes';
  insert into public.subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
  values (ta, plan, 'active', now(), now() + interval '30 days');

  perform pg_temp.as_user(a);
  set local role authenticated;
  insert into public.orders (id, tenant_id, title, status_id) values
    (oa, ta, 'Pedido A', st_a), (oa2, ta, 'Pedido A2', st_a);
  perform pg_temp.as_user(b);
  insert into public.orders (id, tenant_id, title, status_id) values (ob, tb, 'Pedido B', st_b);
  perform pg_temp.as_user(a);

  -- 1. New session, no flag (the P0 case): direct writes are refused for every role.
  perform pg_temp.boom(format($q$update public.orders set total_amount = 5 where id = %L$q$, oa), '42501', 'total_amount_rpc_only');
  -- Since 20261022120000 authenticated cannot even name total_amount in a direct INSERT.
  perform pg_temp.boom(format($q$insert into public.orders(tenant_id,title,status_id,total_amount) values(%L,'x',%L,9)$q$, ta, st_a), '42501', 'permission denied for table orders');
  perform pg_temp.ok(pg_catalog.current_setting('gestcopy.order_total_write', true) is null,
    'refused writes never set the flag');
  reset role; -- privileged role, still no flag
  perform pg_temp.boom(format($q$update public.orders set total_amount = 5 where id = %L$q$, oa), '42501', 'total_amount_rpc_only');
  perform pg_temp.boom(format($q$insert into public.orders(tenant_id,title,status_id,total_amount) values(%L,'x',%L,9)$q$, ta, st_a), '42501', 'total_amount_rpc_only');
  -- anything but exactly '1' is "not allowed"
  perform set_config('gestcopy.order_total_write', '', true);
  perform pg_temp.boom(format($q$update public.orders set total_amount = 5 where id = %L$q$, oa), '42501', 'total_amount_rpc_only');
  perform set_config('gestcopy.order_total_write', '0', true);
  perform pg_temp.boom(format($q$update public.orders set total_amount = 5 where id = %L$q$, oa), '42501', 'total_amount_rpc_only');
  perform set_config('gestcopy.order_total_write', 'true', true);
  perform pg_temp.boom(format($q$update public.orders set total_amount = 5 where id = %L$q$, oa), '42501', 'total_amount_rpc_only');
  perform set_config('gestcopy.order_total_write', '', true);
  perform pg_temp.ok((select total_amount is null from public.orders where id = oa), 'nothing was written');
  perform pg_temp.as_user(a);
  set local role authenticated;

  -- 2. Authorized path: the RPC sets the flag for its own transaction only.
  r := public.set_order_total_amount(oa, '100.00', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '100.00', 'set_order_total_amount works');
  perform pg_temp.ok(pg_catalog.current_setting('gestcopy.order_total_write', true) = '', 'the RPC clears the flag');
  perform pg_temp.boom(format($q$update public.orders set total_amount = 5 where id = %L$q$, oa), '42501', 'total_amount_rpc_only');
  r := public.set_order_total_amount(oa, '120.00', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '120.00', 'a second RPC call still works');
  r := public.set_order_total_amount(oa, '120.00', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'changed' = 'false', 'same value is a no-op');
  -- a write that does not change the amount is not a guarded write. Since
  -- 20261022120000 a direct UPDATE needs the order RPC marker, set by hand here.
  perform set_config('app.order_write', 'validated', true);
  update public.orders set total_amount = total_amount, notes = 'sin cambio de importe' where id = oa;
  perform set_config('app.order_write', '', true);
  perform pg_temp.ok((select total_amount = 120.00 and notes = 'sin cambio de importe' from public.orders where id = oa), 'unrelated updates keep working');
  r := public.set_order_total_amount(oa, null, pg_temp.rv(oa));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' is null, 'the total can be cleared while nothing is collected');
  r := public.set_order_total_amount(oa, '120.00', pg_temp.rv(oa));

  -- 3. Authorized flag on a direct statement (what convert_quote_to_order does on INSERT).
  reset role;
  perform pg_temp.as_user(a);
  perform set_config('gestcopy.order_total_write', '1', true);
  insert into public.orders (id, tenant_id, title, status_id, total_amount)
  values ('e5200000-0000-4000-8000-000000000034', ta, 'Con total', st_a, 77.00);
  perform pg_temp.ok((select total_amount = 77.00 from public.orders where id = 'e5200000-0000-4000-8000-000000000034'), 'flag + INSERT with a total works');
  perform set_config('gestcopy.order_total_write', '', true);
  perform pg_temp.boom(format($q$insert into public.orders(tenant_id,title,status_id,total_amount) values(%L,'x',%L,9)$q$, ta, st_a), '42501', 'total_amount_rpc_only');

  -- 4. Collections stay protected.
  set local role authenticated;
  r := public.record_order_payment(oa, '60.00', paid_at, 'phase52-pay-0001', 'cash', null, ta);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '60.00', 'payment recorded');
  pay := (r->'payments'->0->>'id')::uuid;
  r := public.record_order_payment(oa, '60.00', paid_at, 'phase52-pay-0001', 'cash', null, ta);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'replayed' = 'true', 'payment idempotent replay unchanged');
  r := public.record_order_payment(oa, '61.00', paid_at, 'phase52-pay-0002', 'cash', null, ta);
  perform pg_temp.ok(r->>'error' = 'payment_exceeds_total', 'payment above the total refused');
  r := public.set_order_total_amount(oa, '59.99', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'error' = 'total_below_paid', 'RPC: total below collections refused');
  perform pg_temp.ok(pg_catalog.current_setting('gestcopy.order_total_write', true) = '', 'a refused RPC leaves the flag cleared');
  r := public.set_order_total_amount(oa, null, pg_temp.rv(oa));
  perform pg_temp.ok(r->>'error' = 'total_below_paid', 'RPC: clearing the total with collections refused');
  perform pg_temp.boom(format($q$update public.orders set total_amount = 59.99 where id = %L$q$, oa), '42501', 'total_amount_rpc_only');
  reset role;
  perform pg_temp.as_user(a);
  perform set_config('gestcopy.order_total_write', '1', true); -- even WITH the flag the collections guard holds
  perform pg_temp.boom(format($q$update public.orders set total_amount = 59.99 where id = %L$q$, oa), '23514', 'total_below_paid');
  perform pg_temp.boom(format($q$update public.orders set total_amount = null where id = %L$q$, oa), '23514', 'total_below_paid');
  update public.orders set total_amount = 60.00 where id = oa;
  perform pg_temp.ok((select total_amount = 60.00 from public.orders where id = oa), 'exactly what was collected is allowed');
  perform set_config('gestcopy.order_total_write', '', true);
  set local role authenticated;
  r := public.set_order_total_amount(oa, '200.00', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '60.00', 'raising the total keeps collections');
  r := public.void_order_payment(pay, 'error de importe');
  perform pg_temp.ok(r->>'ok' = 'true', 'void payment unchanged');
  r := public.set_order_total_amount(oa, '10.00', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '10.00', 'after voiding, the total may go below the voided amount');

  -- 5. Tenant isolation.
  perform pg_temp.as_user(b);
  r := public.set_order_total_amount(oa, '1.00', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'error' = 'not_found', 'tenant B cannot set the total of a tenant A order');
  update public.orders set total_amount = 1.00 where id = oa;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'tenant B direct UPDATE on a tenant A order touches no row (RLS)');
  perform pg_temp.boom(format($q$update public.orders set total_amount = 1.00 where id = %L$q$, ob), '42501', 'total_amount_rpc_only');
  r := public.set_order_total_amount(ob, '33.00', pg_temp.rv(ob));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '33.00', 'tenant B uses the RPC on its own order');
  perform pg_temp.as_user(vwr);
  r := public.set_order_total_amount(oa, '1.00', pg_temp.rv(oa));
  perform pg_temp.ok(r->>'error' = 'forbidden', 'viewer cannot set totals');
  update public.orders set total_amount = 1.00 where id = oa;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'viewer direct UPDATE touches no row (RLS)');
  perform pg_temp.as_user(a);
  perform pg_temp.ok((select total_amount = 10.00 from public.orders where id = oa), 'tenant A total untouched by B and the viewer');
  perform pg_temp.ok((select count(*) = 0 from public.orders where id = ob), 'tenant A cannot see tenant B orders');

  reset role;
  raise notice 'phase52 order total guard: all assertions passed';
end $$;
rollback;
