-- Local only. Order Lines V1 · PR A: schema, integrity, economic protection,
-- tenant isolation, roles, atomicity and performance of replace_order_items_v1.
-- Rollback-only: nothing is committed.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase51: %', label;
  end if;
end $$;

-- Runs a statement and requires a specific SQLSTATE (and optional message).
create function pg_temp.boom(statement text, expected text, msg text default null) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected and (msg is null or sqlerrm = msg) then
      return;
    end if;
    raise exception 'phase51 expected % %, got %: %', expected, coalesce(msg, ''), sqlstate, sqlerrm;
  end;
  raise exception 'phase51 unexpectedly succeeded: %', statement;
end $$;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
end $$;

create function pg_temp.rv(o uuid) returns text language sql as $$
  select row_version::text from public.orders where id = o
$$;

create function pg_temp.line(concept text, qty text, price text, disc text default '0', tax text default '0')
returns jsonb language sql as $$
  select jsonb_build_object('concept', concept, 'quantity', qty, 'unit_price', price,
    'discount_percent', disc, 'tax_rate', tax)
$$;

do $$
declare
  a uuid := 'e5100000-0000-4000-8000-000000000001';
  mgr uuid := 'e5100000-0000-4000-8000-000000000002';
  stf uuid := 'e5100000-0000-4000-8000-000000000003';
  vwr uuid := 'e5100000-0000-4000-8000-000000000004';
  b uuid := 'e5100000-0000-4000-8000-000000000005';
  ta uuid := 'e5100000-0000-4000-8000-000000000011';
  tb uuid := 'e5100000-0000-4000-8000-000000000012';
  plan uuid := 'e5100000-0000-4000-8000-000000000041';
  st_a uuid;
  st_b uuid;
  o1 uuid := 'e5100000-0000-4000-8000-000000000031';
  o2 uuid := 'e5100000-0000-4000-8000-000000000032';
  o3 uuid := 'e5100000-0000-4000-8000-000000000033';
  oarch uuid := 'e5100000-0000-4000-8000-000000000034';
  ob uuid := 'e5100000-0000-4000-8000-000000000035';
  ohist uuid := 'e5100000-0000-4000-8000-000000000036';
  r jsonb;
  v0 bigint;
  v1 bigint;
  n integer;
  items jsonb;
  t0 timestamptz;
  ms_1 numeric;
  ms_50 numeric;
  ms_500 numeric;
  paid_at timestamptz := '2026-10-16T08:00:00Z';
  l1 jsonb := pg_temp.line('Copias A4', '3', '10', '10', '21');
  l2 jsonb := pg_temp.line('Encuadernación', '2', '5.50', '0', '10');
begin
  -- ---------------------------------------------------------------- fixture
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase51.test', '{}'), (mgr, 'm@phase51.test', '{}'), (stf, 's@phase51.test', '{}'),
    (vwr, 'v@phase51.test', '{}'), (b, 'b@phase51.test', '{}');
  insert into public.profiles (id, full_name) values
    (a, 'Ana'), (mgr, 'Manu'), (stf, 'Sara'), (vwr, 'Vero'), (b, 'Bruno');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase51 A', 'phase51a', true), (tb, 'Phase51 B', 'phase51b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, mgr, 'manager', true), (ta, stf, 'staff', true),
    (ta, vwr, 'viewer', true), (tb, b, 'owner', true);
  insert into public.order_statuses (tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
  values (ta, 'Recibido', 'received', true, 1, true, false, false, false),
         (tb, 'Recibido', 'received', true, 1, true, false, false, false);
  select id into st_a from public.order_statuses where tenant_id = ta and is_initial;
  select id into st_b from public.order_statuses where tenant_id = tb and is_initial;
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (plan, 'phase51', 'Phase51', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
  select plan, id, true, 500 from public.features where code = 'storage_bytes';
  insert into public.subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
  values (ta, plan, 'active', now(), now() + interval '30 days');

  perform pg_temp.as_user(a);
  set local role authenticated;
  insert into public.orders (id, tenant_id, title, status_id) values
    (o1, ta, 'Pedido 1', st_a), (o2, ta, 'Pedido 2', st_a), (o3, ta, 'Pedido 3', st_a),
    (oarch, ta, 'Pedido archivado', st_a), (ohist, ta, 'Pedido histórico', st_a);
  -- A fresh session has never set gestcopy.order_total_write (the GUC is NULL).
  -- The direct write must still be refused: NULL is "not allowed", not "skip the guard".
  perform pg_temp.ok(current_setting('gestcopy.order_total_write', true) is null, 'fixture: GUC is still unset');
  perform pg_temp.boom(format($q$update public.orders set total_amount=5 where id=%L$q$, o1), '42501', 'total_amount_rpc_only');
  perform pg_temp.boom(format($q$update public.orders set total_mode='items' where id=%L$q$, o1), '42501', 'order_items_columns_rpc_only');
  r := public.set_order_total_amount(ohist, '123.45', pg_temp.rv(ohist));
  perform pg_temp.ok(r->>'ok' = 'true', 'historic total set through the legacy path');
  r := public.set_order_total_amount(o1, '200.00', pg_temp.rv(o1));
  perform pg_temp.ok(r->>'ok' = 'true', 'manual total on o1');
  perform pg_temp.as_user(b);
  insert into public.orders (id, tenant_id, title, status_id) values (ob, tb, 'Pedido B', st_b);
  perform pg_temp.as_user(a);

  -- ---------------------------------------------------- 1. legacy / history
  perform pg_temp.ok(
    (select total_mode = 'manual' and prices_include_tax = false
       and items_subtotal = 0 and items_tax_total = 0 and items_total = 0
       and total_amount = 123.45 from public.orders where id = ohist),
    'an order created before lines keeps manual mode, zero items and its exact total');
  perform pg_temp.ok(
    (select count(*) = 0 from public.order_items where order_id in (o1, o2, o3, ohist)),
    'orders start without lines');

  -- ------------------------------------------------- 2. privileges / schema
  perform pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.order_items'::regclass), 'order_items has RLS');
  perform pg_temp.ok(
    has_table_privilege('authenticated', 'public.order_items', 'SELECT')
    and not has_table_privilege('authenticated', 'public.order_items', 'INSERT')
    and not has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.order_items', 'DELETE')
    and not has_table_privilege('authenticated', 'public.order_items', 'TRUNCATE')
    and not has_table_privilege('service_role', 'public.order_items', 'INSERT')
    and not has_table_privilege('anon', 'public.order_items', 'SELECT'),
    'authenticated reads only; nobody writes order_items directly');
  perform pg_temp.ok(
    has_function_privilege('authenticated', 'public.replace_order_items_v1(uuid,text,jsonb,text,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.replace_order_items_v1(uuid,text,jsonb,text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.order_items_refresh_totals_v1(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.order_item_payload_error_v1(jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.tg_order_item_guard_v1()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.tg_order_items_rollup_v1()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.tg_orders_items_guard_v1()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.tg_orders_purge_items_v1()', 'EXECUTE'),
    'only replace_order_items_v1 is callable; internals are closed');
  perform pg_temp.ok(
    (select bool_and(prosecdef and proconfig @> array['search_path=""'])
       from pg_proc where proname in (
         'replace_order_items_v1', 'order_items_refresh_totals_v1', 'tg_order_item_guard_v1',
         'tg_order_items_rollup_v1', 'tg_orders_items_guard_v1', 'tg_orders_purge_items_v1')
         and pronamespace = 'public'::regnamespace),
    'SECURITY DEFINER functions pin an empty search_path');

  -- direct writes by an authenticated owner
  perform pg_temp.boom(format($q$insert into public.order_items(tenant_id,order_id,position,concept,quantity,unit_price) values(%L,%L,1,'x',1,1)$q$, ta, o1), '42501');
  perform pg_temp.boom(format($q$update public.orders set total_mode='items' where id=%L$q$, o1), '42501', 'order_items_columns_rpc_only');
  perform pg_temp.boom(format($q$update public.orders set items_total=5 where id=%L$q$, o1), '42501', 'order_items_columns_rpc_only');
  perform pg_temp.boom(format($q$update public.orders set prices_include_tax=true where id=%L$q$, o1), '42501', 'order_items_columns_rpc_only');
  perform pg_temp.boom(format($q$update public.orders set total_amount=1 where id=%L$q$, o1), '42501', 'total_amount_rpc_only');
  -- Since 20261022120000 authenticated cannot name total_mode in a direct INSERT.
  perform pg_temp.boom(format($q$insert into public.orders(tenant_id,title,status_id,total_mode) values(%L,'x',%L,'items')$q$, ta, st_a), '42501', 'permission denied for table orders');
  perform pg_temp.ok((select total_mode = 'manual' and total_amount = 200.00 from public.orders where id = o1), 'direct writes changed nothing');

  -- ------------------------------------------------------- 3. manual mode
  v0 := pg_temp.rv(o1)::bigint;
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1, l2));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_mode' = 'manual' and r->>'items_count' = '2', 'manual replace ok');
  perform pg_temp.ok(
    r->>'items_subtotal' = '38.00' and r->>'items_tax_total' = '6.77' and r->>'items_total' = '44.77',
    'exact VAT-excluded aggregate (27.00+5.67+32.67 / 11.00+1.10+12.10)');
  perform pg_temp.ok(
    r->'items'->0->>'subtotal' = '27.00' and r->'items'->0->>'tax_amount' = '5.67' and r->'items'->0->>'total' = '32.67'
    and r->'items'->1->>'total' = '12.10' and r->'items'->0->>'position' = '1' and r->'items'->1->>'position' = '2',
    'per-line amounts and positions');
  perform pg_temp.ok(r->>'total_amount' = '200.00', 'manual mode: lines do not change total_amount');
  perform pg_temp.ok(pg_temp.rv(o1)::bigint = v0 + 1, 'one successful replace bumps row_version exactly once');
  perform pg_temp.ok(
    (select count(*) = 1 from public.activity_log where entity_id = o1 and action = 'order.items_replaced'
       and new_values->>'items_count' = '2' and new_values->>'items_total' = '44.77'
       and metadata->>'field' = 'items'),
    'activity logged without line payload');
  perform pg_temp.ok((select count(*) = 2 from public.order_items where order_id = o1), 'two lines persisted');

  -- retro-compat: the manual path still works and reflects the manual amount
  r := public.set_order_total_amount(o1, '250.00', pg_temp.rv(o1));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '250.00', 'manual total still editable in manual mode');
  perform pg_temp.ok((select items_total = 44.77 from public.orders where id = o1), 'manual total does not touch items_total');

  -- --------------------------------------------- 4. VAT-included, fiscal parity
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1, l2), null, true);
  perform pg_temp.ok(
    r->>'ok' = 'true' and r->>'prices_include_tax' = 'true'
    and r->>'items_subtotal' = '32.31' and r->>'items_tax_total' = '5.69' and r->>'items_total' = '38.00',
    'exact VAT-included aggregate (22.31+4.69=27.00 / 10.00+1.00=11.00)');
  reset role; -- quote_line_amounts_v1 is internal (not callable by API roles)
  perform pg_temp.ok(
    (select bool_and((i.subtotal, i.tax_amount, i.total) = (q.subtotal, q.tax_amount, q.total))
       from public.order_items i
       cross join lateral public.quote_line_amounts_v1(i.quantity, i.unit_price, i.discount_percent, i.tax_rate, true) q
      where i.order_id = o1),
    'line amounts equal quote_line_amounts_v1 (same rounding as quotes)');
  perform pg_temp.as_user(a);
  set local role authenticated;
  -- the flag is stable when omitted
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1));
  perform pg_temp.ok(r->>'prices_include_tax' = 'true' and r->>'items_total' = '27.00', 'omitted flag keeps VAT-included');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1), null, false);
  perform pg_temp.ok(r->>'items_total' = '32.67', 'switching VAT mode recomputes every line');
  -- direct VAT flip with lines present is refused even with the write flag
  reset role;
  perform set_config('gestcopy.order_items_write', '1', true);
  perform pg_temp.boom(format($q$update public.orders set prices_include_tax=true where id=%L$q$, o1), '55000', 'replace_items_before_tax_mode');
  perform set_config('gestcopy.order_items_write', '', true);
  perform pg_temp.as_user(a);
  set local role authenticated;

  -- ------------------------------------------------------------ 5. items mode
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), '[]'::jsonb, 'items');
  perform pg_temp.ok(r->>'error' = 'items_required', 'items mode needs at least one line');
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), jsonb_build_array(l1, l2), 'items');
  perform pg_temp.ok(
    r->>'ok' = 'true' and r->>'total_mode' = 'items' and r->>'total_amount' = '44.77' and r->>'items_total' = '44.77',
    'items mode: total_amount derives from the lines');
  perform pg_temp.ok((select total_amount = items_total from public.orders where id = o2), 'invariant total_amount = items_total');
  r := public.set_order_total_amount(o2, '10.00', pg_temp.rv(o2));
  perform pg_temp.ok(r->>'error' = 'total_mode_items', 'manual total refused in items mode');
  r := public.set_order_total_amount(o2, '44.77', pg_temp.rv(o2));
  perform pg_temp.ok(r->>'error' = 'total_mode_items', 'even the same value is refused (explicit contract)');
  perform pg_temp.boom(format($q$update public.orders set total_amount=1 where id=%L$q$, o2), '42501', 'total_amount_items_mode');
  reset role;
  -- legacy flag only: still refused by the items-mode guard
  perform set_config('gestcopy.order_total_write', '1', true);
  perform pg_temp.boom(format($q$update public.orders set total_amount=1 where id=%L$q$, o2), '42501', 'total_amount_items_mode');
  -- both flags: the CHECK constraint still keeps total_amount = items_total
  perform set_config('gestcopy.order_items_write', '1', true);
  perform pg_temp.boom(format($q$update public.orders set total_amount=1 where id=%L$q$, o2), '23514');
  perform set_config('gestcopy.order_items_write', '', true);
  perform set_config('gestcopy.order_total_write', '', true);
  perform pg_temp.ok((select total_amount = 44.77 from public.orders where id = o2), 'total unchanged after refused writes');
  perform pg_temp.as_user(a);
  set local role authenticated;

  -- items -> manual keeps the amount as it is
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), jsonb_build_array(l1, l2), 'manual');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_mode' = 'manual' and r->>'total_amount' = '44.77', 'items -> manual keeps total_amount');
  r := public.set_order_total_amount(o2, '60.00', pg_temp.rv(o2));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '60.00', 'manual again after switching back');
  -- manual -> items overwrites the manual amount with the exact derived one
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), jsonb_build_array(l1, l2), 'items');
  perform pg_temp.ok(r->>'total_amount' = '44.77' and r->>'total_mode' = 'items', 'manual -> items derives the total');
  perform pg_temp.ok(
    exists (select 1 from public.activity_log
      where entity_id = o2 and action = 'order.items_replaced'
        and new_values->>'total_amount' = '44.77' and previous_values->>'total_amount' = '60.00'
        and new_values->>'total_mode' = 'items' and previous_values->>'total_mode' = 'manual'),
    'activity keeps previous and new total');

  -- ------------------------------------------------------------- 6. payments
  r := public.record_order_payment(o2, '30.00', paid_at, 'phase51-pay-0001', 'cash', null, ta);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '30.00', 'payment against the derived total');
  r := public.record_order_payment(o2, '14.78', paid_at, 'phase51-pay-0002', 'cash', null, ta);
  perform pg_temp.ok(r->>'error' = 'payment_exceeds_total', 'payments cannot exceed the derived total');
  v0 := pg_temp.rv(o2)::bigint;
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), jsonb_build_array(pg_temp.line('Solo esto', '1', '29.99')), 'items');
  perform pg_temp.ok(r->>'error' = 'total_below_paid', 'lines that would drop the total below collections are refused');
  perform pg_temp.ok(
    pg_temp.rv(o2)::bigint = v0
    and (select count(*) = 2 and bool_and(concept in ('Copias A4', 'Encuadernación')) from public.order_items where order_id = o2)
    and (select total_amount = 44.77 and items_total = 44.77 and total_mode = 'items' from public.orders where id = o2),
    'refusal is atomic: lines, totals and row_version untouched');
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), jsonb_build_array(pg_temp.line('Justo lo cobrado', '1', '30.00')), 'items');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '30.00' and r->>'pending_amount' = '0.00' and r->>'collection_state' = 'paid',
    'editing with payments registered is allowed down to exactly what was collected');
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), jsonb_build_array(pg_temp.line('Más caro', '1', '80.00')), 'items');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '80.00' and r->>'paid_amount' = '30.00' and r->>'collection_state' = 'partial',
    'raising the total keeps collections intact');
  -- switching a paid manual order to items below what was collected is refused too
  r := public.set_order_total_amount(o3, '100.00', pg_temp.rv(o3));
  r := public.record_order_payment(o3, '60.00', paid_at, 'phase51-pay-0003', 'cash', null, ta);
  perform pg_temp.ok(r->>'ok' = 'true', 'payment on o3');
  r := public.replace_order_items_v1(o3, pg_temp.rv(o3), jsonb_build_array(pg_temp.line('Poco', '1', '50.00')), 'items');
  perform pg_temp.ok(r->>'error' = 'total_below_paid', 'manual -> items below collections is refused');
  perform pg_temp.ok(
    (select total_mode = 'manual' and total_amount = 100.00 from public.orders where id = o3)
    and (select count(*) = 0 from public.order_items where order_id = o3),
    'and nothing was written');
  r := public.replace_order_items_v1(o3, pg_temp.rv(o3), jsonb_build_array(pg_temp.line('Poco', '1', '50.00')), 'manual');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '100.00' and r->>'paid_amount' = '60.00', 'manual lines never touch a paid total');

  -- ---------------------------------------------------- 7. validation, atomicity
  v0 := pg_temp.rv(o1)::bigint;
  perform pg_temp.ok(
    (select count(*) = 1 from public.order_items where order_id = o1), 'o1 has the single line from the VAT test');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1, jsonb_build_object('concept', 'x', 'quantity', '1', 'unit_price', '1', 'subtotal', '1')));
  perform pg_temp.ok(r->>'error' = 'invalid_items' and (r->>'index')::int = 1 and r->>'field' = 'unknown_field', 'clients cannot send amounts or ids');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(jsonb_build_object('concept', 'x', 'quantity', '1', 'unit_price', '1', 'id', gen_random_uuid())));
  perform pg_temp.ok(r->>'field' = 'unknown_field', 'ids are refused');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(
    pg_temp.line('x', '999999999999', '999999999999.999999', '0', '100'),
    pg_temp.line('y', '999999999999', '999999999999.999999', '0', '100')));
  perform pg_temp.ok(r->>'error' = 'amount_overflow', 'numeric overflow is a controlled error');
  perform pg_temp.ok(
    pg_temp.rv(o1)::bigint = v0 and (select count(*) = 1 from public.order_items where order_id = o1)
    and (select items_total = 32.67 from public.orders where id = o1),
    'failed replaces are fully rolled back');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), null);
  perform pg_temp.ok(r->>'error' = 'invalid_items', 'null items');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), '{"a":1}'::jsonb);
  perform pg_temp.ok(r->>'error' = 'invalid_items', 'non-array items');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1), 'weird');
  perform pg_temp.ok(r->>'error' = 'invalid_total_mode', 'invalid total_mode');
  r := public.replace_order_items_v1(o1, (v0 - 1)::text, jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'conflict' and r->>'row_version' = v0::text, 'stale row_version is a conflict');
  r := public.replace_order_items_v1(o1, null, jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'conflict', 'missing row_version is a conflict');
  r := public.replace_order_items_v1(o1, 'abc', jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'conflict', 'malformed row_version is a conflict');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), '[]'::jsonb);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'items_count' = '0' and r->>'items_total' = '0.00' and r->>'total_amount' = '250.00',
    'manual orders may have no lines; replacing with [] clears them and keeps the manual total');
  -- 500 allowed, 501 refused
  select jsonb_agg(pg_temp.line('Linea ' || g, '1', '0.01')) into items from generate_series(1, 501) g;
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), items);
  perform pg_temp.ok(r->>'error' = 'too_many_items', '501 lines refused');
  select jsonb_agg(pg_temp.line('Linea ' || g, '1', '0.01')) into items from generate_series(1, 500) g;
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), items);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'items_count' = '500' and r->>'items_total' = '5.00', '500 lines accepted');

  -- payload rules (pure internal function: not callable by API roles)
  reset role;
  perform pg_temp.ok(
    (select bool_and(public.order_item_payload_error_v1(c.j) = c.expected)
       from (values
         ('{"concept":"","quantity":"1","unit_price":"1"}'::jsonb, 'concept'),
         ('{"concept":"   ","quantity":"1","unit_price":"1"}', 'concept'),
         ('{"concept":null,"quantity":"1","unit_price":"1"}', 'concept'),
         ('{"quantity":"1","unit_price":"1"}', 'concept'),
         ('{"concept":"x","quantity":"0","unit_price":"1"}', 'quantity'),
         ('{"concept":"x","quantity":"-1","unit_price":"1"}', 'quantity'),
         ('{"concept":"x","quantity":"1e3","unit_price":"1"}', 'quantity'),
         ('{"concept":"x","quantity":"1.1234567","unit_price":"1"}', 'quantity'),
         ('{"concept":"x","quantity":"NaN","unit_price":"1"}', 'quantity'),
         ('{"concept":"x","quantity":null,"unit_price":"1"}', 'quantity'),
         ('{"concept":"x","quantity":"1","unit_price":"-0.01"}', 'unit_price'),
         ('{"concept":"x","quantity":"1","unit_price":"abc"}', 'unit_price'),
         ('{"concept":"x","quantity":"1","unit_price":"1","discount_percent":"100.01"}', 'discount_percent'),
         ('{"concept":"x","quantity":"1","unit_price":"1","discount_percent":"-1"}', 'discount_percent'),
         ('{"concept":"x","quantity":"1","unit_price":"1","tax_rate":"101"}', 'tax_rate'),
         ('{"concept":"x","quantity":"1","unit_price":"1","tax_rate":"x"}', 'tax_rate'),
         ('{"concept":"x","quantity":"1","unit_price":"1","unit":5}', 'unit'),
         ('{"concept":"x","quantity":"1","unit_price":"1","description":7}', 'description'),
         ('{"concept":"x","quantity":"1","unit_price":"1","total":"1"}', 'unknown_field'),
         ('[1]', 'item'),
         ('"x"', 'item')
       ) as c(j, expected)),
    'invalid payloads are named precisely');
  perform pg_temp.ok(
    public.order_item_payload_error_v1('{"concept":"x","quantity":1.5,"unit_price":0,"discount_percent":100,"tax_rate":0,"unit":null,"description":null}') is null
    and public.order_item_payload_error_v1('{"concept":"x","quantity":"0.000001","unit_price":"999999999999.999999","discount_percent":"100.000000","tax_rate":"99.999999"}') is null
    and public.order_item_payload_error_v1(jsonb_build_object('concept', repeat('x', 2000), 'quantity', 1, 'unit_price', 1)) is null
    and public.order_item_payload_error_v1(jsonb_build_object('concept', repeat('x', 2001), 'quantity', 1, 'unit_price', 1)) = 'concept'
    and public.order_item_payload_error_v1(jsonb_build_object('concept', '  ' || repeat('x', 2000) || '  ', 'quantity', 1, 'unit_price', 1)) is null,
    'boundary values');
  -- Text limits match the quote line limits (lib/quotes/payload.ts), so a converted line never loses text.
  perform pg_temp.ok(
    public.order_item_payload_error_v1(jsonb_build_object('concept', 'x', 'description', repeat('d', 10000), 'quantity', 1, 'unit_price', 1)) is null
    and public.order_item_payload_error_v1(jsonb_build_object('concept', 'x', 'description', repeat('d', 10001), 'quantity', 1, 'unit_price', 1)) = 'description'
    and public.order_item_payload_error_v1(jsonb_build_object('concept', 'x', 'unit', repeat('u', 100), 'quantity', 1, 'unit_price', 1)) is null
    and public.order_item_payload_error_v1(jsonb_build_object('concept', 'x', 'unit', repeat('u', 101), 'quantity', 1, 'unit_price', 1)) = 'unit',
    'description and unit limits match quotes (10000 and 100)');
  perform pg_temp.ok(
    exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.order_items'::regclass and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'char_length\(concept\) <= 2000\M')
    and exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.order_items'::regclass and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'char_length\(description\) <= 10000\M')
    and exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.order_items'::regclass and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'char_length\(unit\) <= 100\M')
    and not exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.order_items'::regclass and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'char_length\((concept|description|unit)\) <= (500|5000|40)\M'),
    'order_items table text limits match quotes (2000 / 10000 / 100)');
  perform pg_temp.as_user(a);
  set local role authenticated;

  -- ------------------------------------------------------------ 8. archived
  reset role;
  perform set_config('app.order_lifecycle', 'validated', true);
  update public.orders set archived_at = now() where id = oarch;
  perform pg_temp.as_user(a);
  set local role authenticated;
  r := public.replace_order_items_v1(oarch, pg_temp.rv(oarch), jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'order_archived', 'archived orders are read-only (archived_at is the only lifecycle lock)');
  reset role;
  perform set_config('gestcopy.order_items_write', '1', true);
  perform pg_temp.boom(format($q$insert into public.order_items(tenant_id,order_id,position,concept,quantity,unit_price) values(%L,%L,1,'x',1,1)$q$, ta, oarch), '55000', 'order_archived');
  perform set_config('gestcopy.order_items_write', '', true);
  perform pg_temp.as_user(a);
  set local role authenticated;

  -- --------------------------------------------------- 9. roles and tenants
  perform pg_temp.as_user(vwr);
  perform pg_temp.ok((select count(*) = 500 from public.order_items where order_id = o1), 'viewer reads the lines');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'forbidden', 'viewer cannot write lines');
  perform pg_temp.as_user(stf);
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1));
  perform pg_temp.ok(r->>'ok' = 'true', 'staff can write lines');
  perform pg_temp.as_user(mgr);
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1, l2));
  perform pg_temp.ok(r->>'ok' = 'true', 'manager can write lines');
  perform pg_temp.as_user(b);
  perform pg_temp.ok((select count(*) = 0 from public.order_items where order_id in (o1, o2)), 'tenant B cannot read tenant A lines');
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'not_found', 'tenant B cannot write on a tenant A order (and cannot tell it exists)');
  r := public.replace_order_items_v1(o1, '0', jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'not_found', 'same answer with any version');
  r := public.replace_order_items_v1(ob, pg_temp.rv(ob), jsonb_build_array(l2));
  perform pg_temp.ok(r->>'ok' = 'true', 'tenant B writes its own order');
  perform pg_temp.as_user(a);
  perform pg_temp.ok((select count(*) = 0 from public.order_items where order_id = ob), 'tenant A cannot read tenant B lines');
  perform pg_temp.as_user(null);
  r := public.replace_order_items_v1(o1, '0', jsonb_build_array(l1));
  perform pg_temp.ok(r->>'error' = 'not_found', 'no authenticated user');
  perform pg_temp.as_user(a);
  set local role anon;
  perform pg_temp.boom(format($q$select public.replace_order_items_v1(%L,'0','[]')$q$, o1), '42501');
  perform pg_temp.boom($q$select count(*) from public.order_items$q$, '42501');
  set local role authenticated;
  perform pg_temp.as_user(a);

  -- ------------------------------------------- 10. statement-level aggregates
  reset role;
  perform set_config('gestcopy.order_items_write', '1', true);
  -- cross-tenant line: refused by the row guard (tenant+order lookup) and, behind it,
  -- by the composite FK (tenant_id, order_id) -> orders (tenant_id, id)
  perform pg_temp.ok(
    exists (select 1 from pg_constraint where conname = 'order_items_order_fk'
      and conrelid = 'public.order_items'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id)%'),
    'composite tenant+order foreign key exists');
  perform pg_temp.boom(format($q$insert into public.order_items(tenant_id,order_id,position,concept,quantity,unit_price) values(%L,%L,1,'x',1,1)$q$, tb, o3), 'P0002', 'order_not_found');
  perform pg_temp.boom(format($q$update public.order_items set tenant_id=%L where order_id=%L$q$, tb, o1), '55000', 'immutable_identity');
  -- one statement, one refresh: 500 rows inserted = row_version +1
  delete from public.order_items where order_id = o3;
  update public.orders set total_amount = total_amount where id = o3; -- no-op
  v0 := pg_temp.rv(o3)::bigint;
  insert into public.order_items(tenant_id, order_id, position, concept, quantity, unit_price)
  select ta, o3, g, 'Fila ' || g, 2, 1.25 from generate_series(1, 500) g;
  perform pg_temp.ok((select items_total = 1250.00 from public.orders where id = o3), 'statement trigger refreshed the aggregate');
  perform pg_temp.ok(pg_temp.rv(o3)::bigint = v0 + 1, '500 rows inserted in one statement refresh the order once');
  v0 := pg_temp.rv(o3)::bigint;
  update public.order_items set unit_price = 2.50 where order_id = o3;
  perform pg_temp.ok((select items_total = 2500.00 from public.orders where id = o3) and pg_temp.rv(o3)::bigint = v0 + 1,
    '500 rows updated in one statement refresh the order once');
  v0 := pg_temp.rv(o3)::bigint;
  delete from public.order_items where order_id = o3 and position > 250;
  perform pg_temp.ok((select items_total = 1250.00 from public.orders where id = o3) and pg_temp.rv(o3)::bigint = v0 + 1,
    '250 rows deleted in one statement refresh the order once');
  -- items mode + collections: a statement that would drop below paid is rolled back whole
  perform set_config('gestcopy.order_total_write', '1', true);
  update public.orders set total_mode = 'items', total_amount = items_total where id = o3;
  perform set_config('gestcopy.order_total_write', '', true);
  perform pg_temp.ok((select total_mode = 'items' and total_amount = 1250.00 from public.orders where id = o3), 'o3 in items mode (privileged fixture)');
  perform pg_temp.boom(format($q$delete from public.order_items where order_id=%L$q$, o3), '23514', 'total_below_paid');
  perform pg_temp.ok((select count(*) = 250 from public.order_items where order_id = o3), 'rolled back statement left every line');
  perform set_config('gestcopy.order_items_write', '', true);
  -- without the flag even the privileged role is refused
  perform pg_temp.boom(format($q$delete from public.order_items where order_id=%L$q$, o3), '42501', 'order_items_rpc_only');

  -- --------------------------------------------------------- 11. purge
  perform set_config('gestcopy.order_items_write', '1', true);
  perform pg_temp.ok((select count(*) > 0 from public.order_items where order_id = o2), 'o2 has lines and payments');
  perform set_config('gestcopy.order_items_write', '', true);
  delete from public.orders where id in (o2, o3);
  perform pg_temp.ok(
    (select count(*) = 0 from public.order_items where order_id in (o2, o3))
    and (select count(*) = 0 from public.order_payments where order_id in (o2, o3)),
    'deleting an order purges its lines and payments');

  -- ------------------------------------------------------- 12. performance
  perform pg_temp.as_user(a);
  set local role authenticated;
  for n in select unnest(array[1, 50, 500]) loop
    select jsonb_agg(pg_temp.line('Concepto ' || g, (1 + g % 7)::text, (g % 13 + 0.5)::text, (g % 20)::text, '21')) into items
    from generate_series(1, n) g;
    v0 := pg_temp.rv(ohist)::bigint;
    t0 := clock_timestamp();
    r := public.replace_order_items_v1(ohist, pg_temp.rv(ohist), items, 'manual');
    ms_500 := extract(epoch from clock_timestamp() - t0) * 1000;
    perform pg_temp.ok(r->>'ok' = 'true' and (r->>'items_count')::int = n, 'perf replace ' || n);
    perform pg_temp.ok(pg_temp.rv(ohist)::bigint = v0 + 1, 'perf: ' || n || ' lines refresh the order once, not per line');
    perform pg_temp.ok(r->>'total_amount' = '123.45', 'perf: manual total untouched by ' || n || ' lines');
    if n = 1 then ms_1 := ms_500; elsif n = 50 then ms_50 := ms_500; end if;
    raise notice 'phase51 perf: % line(s) -> % ms', n, round(ms_500, 1);
  end loop;
  perform pg_temp.ok(ms_500 < 3000, 'perf: 500 lines replaced in under 3 s (measured ' || round(ms_500, 1) || ' ms)');
  perform pg_temp.ok(ms_500 < greatest(ms_50, 5) * 60, 'perf: growth from 50 to 500 lines is not quadratic');

  reset role;
  raise notice 'phase51 order lines: all assertions passed';
end $$;

rollback;
