-- Local only. Order line-item calculator:
--   1. Parity: lib/orders/line-amounts.fixtures.json (the vectors the TS preview
--      is tested against) must match public.quote_line_amounts_v1 exactly.
--   2. set_order_manual_total_v1 (20261105100000): atomic switch from items mode
--      to a typed total, payments untouched, total_below_paid, row_version,
--      roles, tenant isolation, archived orders, lines kept as reference.
-- Rollback-only: nothing is committed. Run from the repository root.
\set fixtures `cat lib/orders/line-amounts.fixtures.json`
begin;

select set_config('phase68.fixtures', :'fixtures', true) is null as phase68_unused \gset

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase68: %', label;
  end if;
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

-- ------------------------------------------------------------ 1. parity
do $$
declare
  v jsonb;
  a record;
  n integer := 0;
begin
  for v in select jsonb_array_elements(current_setting('phase68.fixtures')::jsonb -> 'vectors') loop
    select * into a from public.quote_line_amounts_v1(
      (v ->> 'quantity')::numeric, (v ->> 'unit_price')::numeric,
      (v ->> 'discount_percent')::numeric, (v ->> 'tax_rate')::numeric,
      (v ->> 'prices_include_tax')::boolean);
    perform pg_temp.ok(
      a.subtotal::text = v ->> 'subtotal' and a.tax_amount::text = v ->> 'tax_amount' and a.total::text = v ->> 'total',
      format('parity vector "%s": sql %s/%s/%s, fixture %s/%s/%s', v ->> 'note',
        a.subtotal, a.tax_amount, a.total, v ->> 'subtotal', v ->> 'tax_amount', v ->> 'total'));
    n := n + 1;
  end loop;
  perform pg_temp.ok(n >= 20, 'parity: the fixture file has at least 20 vectors');
end $$;

-- ------------------------------------- 2. set_order_manual_total_v1
do $$
declare
  a uuid := 'e6800000-0000-4000-8000-000000000001';
  vwr uuid := 'e6800000-0000-4000-8000-000000000004';
  b uuid := 'e6800000-0000-4000-8000-000000000005';
  stf uuid := 'e6800000-0000-4000-8000-000000000006';
  ta uuid := 'e6800000-0000-4000-8000-000000000011';
  tb uuid := 'e6800000-0000-4000-8000-000000000012';
  st_a uuid;
  o1 uuid := 'e6800000-0000-4000-8000-000000000031';
  o2 uuid := 'e6800000-0000-4000-8000-000000000032';
  o3 uuid := 'e6800000-0000-4000-8000-000000000033';
  oarch uuid := 'e6800000-0000-4000-8000-000000000034';
  r jsonb;
  v0 text;
  n integer;
  paid_at timestamptz := '2026-11-05T08:00:00Z';
  l1 jsonb := pg_temp.line('Copias A4', '100', '0.10', '0', '21');
  l2 jsonb := pg_temp.line('Encuadernación', '2', '5.50', '0', '10');
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase68.test', '{}'), (vwr, 'v@phase68.test', '{}'),
    (b, 'b@phase68.test', '{}'), (stf, 's@phase68.test', '{}');
  insert into public.profiles (id, full_name) values (a, 'Ana'), (vwr, 'Vero'), (b, 'Bruno'), (stf, 'Sara');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase68 A', 'phase68a', true), (tb, 'Phase68 B', 'phase68b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, vwr, 'viewer', true), (ta, stf, 'staff', true), (tb, b, 'owner', true);
  insert into public.order_statuses (tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
  values (ta, 'Recibido', 'received', true, 1, true, false, false, false);
  select id into st_a from public.order_statuses where tenant_id = ta and is_initial;

  perform pg_temp.as_user(a);
  set local role authenticated;
  insert into public.orders (id, tenant_id, title, status_id) values
    (o1, ta, 'Pedido 1', st_a), (o2, ta, 'Pedido 2', st_a), (o3, ta, 'Pedido 3', st_a), (oarch, ta, 'Archivado', st_a);

  -- privileges
  reset role;
  perform pg_temp.ok(
    has_function_privilege('authenticated', 'public.set_order_manual_total_v1(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_order_manual_total_v1(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.set_order_manual_total_v1(uuid,text,text)', 'EXECUTE'),
    'only authenticated can execute set_order_manual_total_v1');
  perform pg_temp.ok(
    (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
      where oid = 'public.set_order_manual_total_v1(uuid,text,text)'::regprocedure),
    'SECURITY DEFINER with an empty search_path');
  set local role authenticated;

  -- ---------------------------------------------- items mode → direct total
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1, l2), 'items', false);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '24.20', 'o1 in items mode, total 24.20 (12.10 + 12.10)');
  v0 := pg_temp.rv(o1);

  r := public.set_order_manual_total_v1(o1, '30', v0);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'changed' = 'true' and r->>'total_mode' = 'manual'
    and r->>'total_amount' = '30.00' and r->>'row_version' = (v0::bigint + 1)::text,
    'switch: manual mode, typed total, row_version + 1, collection snapshot returned');
  perform pg_temp.ok(
    (select total_mode = 'manual' and total_amount = 30 and items_total = 24.20 and items_subtotal = 21.00
       and items_tax_total = 3.20 and prices_include_tax = false from public.orders where id = o1),
    'switch keeps items_* (reference) and the VAT flag');
  perform pg_temp.ok((select count(*) = 2 from public.order_items where order_id = o1), 'switch keeps the lines');
  perform pg_temp.ok(
    (select count(*) = 1 from public.activity_log where entity_id = o1 and action = 'order.total_changed'
       and previous_values = '{"total_amount":"24.20","total_mode":"items"}'::jsonb
       and new_values = '{"total_amount":"30.00","total_mode":"manual"}'::jsonb),
    'one order.total_changed row with both modes');

  -- manual mode: same as the legacy path
  v0 := pg_temp.rv(o1);
  r := public.set_order_manual_total_v1(o1, '30.00', v0);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'changed' = 'false' and pg_temp.rv(o1) = v0,
    'manual mode, same amount: no change, no version bump');
  r := public.set_order_manual_total_v1(o1, '35.5', v0);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '35.50', 'manual mode, new amount');

  -- items mode with the same amount still switches
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1, l2), 'items', null);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '24.20', 'back to items mode (recoverable)');
  r := public.set_order_manual_total_v1(o1, '24.20', pg_temp.rv(o1));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'changed' = 'true' and r->>'total_mode' = 'manual',
    'items mode, same amount: still switches to manual');

  -- null total (unset) is allowed without payments, like set_order_total_amount
  r := public.replace_order_items_v1(o1, pg_temp.rv(o1), jsonb_build_array(l1), 'items', null);
  r := public.set_order_manual_total_v1(o1, null, pg_temp.rv(o1));
  perform pg_temp.ok(r->>'ok' = 'true' and (select total_amount is null and total_mode = 'manual' from public.orders where id = o1),
    'unset total from items mode');

  -- ---------------------------------------------------- payments untouched
  r := public.replace_order_items_v1(o2, pg_temp.rv(o2), jsonb_build_array(l1, l2), 'items', false);
  r := public.record_order_payment(o2, '20.00', paid_at, 'phase68-pay-0001', 'cash', null, ta);
  perform pg_temp.ok(r->>'ok' = 'true', 'payment of 20.00 on o2');
  v0 := pg_temp.rv(o2);

  r := public.set_order_manual_total_v1(o2, '19.99', v0);
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'error' = 'total_below_paid', 'below paid is refused');
  perform pg_temp.ok(
    (select total_mode = 'items' and total_amount = 24.20 and row_version::text = v0 from public.orders where id = o2),
    'refused switch writes nothing: still items mode, same total and version');
  perform pg_temp.ok(
    (select count(*) = 0 from public.activity_log where entity_id = o2 and action = 'order.total_changed'),
    'refused switch logs nothing');

  r := public.set_order_manual_total_v1(o2, null, v0);
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'error' = 'total_below_paid', 'unset total with payments is refused');

  r := public.set_order_manual_total_v1(o2, '20', v0);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '20.00' and r->>'pending_amount' = '0.00'
    and r->>'collection_state' = 'paid', 'total equal to paid is allowed; paid/pending derived from payments');
  perform pg_temp.ok(
    (select count(*) = 1 and sum(amount) = 20 and bool_and(voided_at is null) from public.order_payments where order_id = o2),
    'payments are never touched');

  -- ------------------------------------------------------------ conflicts
  r := public.set_order_manual_total_v1(o3, '10', '999');
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'error' = 'conflict' and r->>'row_version' = pg_temp.rv(o3),
    'stale version: conflict with the current version');
  r := public.set_order_manual_total_v1(o3, '10', 'abc');
  perform pg_temp.ok(r->>'error' = 'conflict', 'malformed version: conflict');
  r := public.set_order_manual_total_v1(o3, '10', null);
  perform pg_temp.ok(r->>'error' = 'conflict', 'null version: conflict');

  -- ------------------------------------------------------- amount format
  foreach v0 in array array['-1', '1.234', '1,00', 'abc', '', '01', '1e3', '10000000000000000000'] loop
    r := public.set_order_manual_total_v1(o3, v0, pg_temp.rv(o3));
    perform pg_temp.ok(r->>'error' = 'invalid_amount', format('invalid amount %L', v0));
  end loop;

  -- ------------------------------------------------- roles and isolation
  perform pg_temp.as_user(vwr);
  r := public.set_order_manual_total_v1(o3, '10', pg_temp.rv(o3));
  perform pg_temp.ok(r->>'error' = 'forbidden', 'viewer is forbidden');
  perform pg_temp.as_user(stf);
  r := public.set_order_manual_total_v1(o3, '10', pg_temp.rv(o3));
  perform pg_temp.ok(r->>'ok' = 'true', 'staff can set the total');
  perform pg_temp.as_user(b);
  r := public.set_order_manual_total_v1(o3, '11', pg_temp.rv(o3));
  perform pg_temp.ok(r->>'error' = 'not_found', 'another tenant gets not_found');
  perform pg_temp.as_user(null);
  r := public.set_order_manual_total_v1(o3, '11', pg_temp.rv(o3));
  perform pg_temp.ok(r->>'error' = 'not_found', 'no session gets not_found');
  perform pg_temp.as_user(a);
  r := public.set_order_manual_total_v1(null, '11', '1');
  perform pg_temp.ok(r->>'error' = 'not_found', 'null order gets not_found');

  -- --------------------------------------------------------------- archived
  r := public.replace_order_items_v1(oarch, pg_temp.rv(oarch), jsonb_build_array(l1), 'items', null);
  reset role;
  update public.orders set archived_at = now() where id = oarch;
  set local role authenticated;
  r := public.set_order_manual_total_v1(oarch, '1', pg_temp.rv(oarch));
  perform pg_temp.ok(r->>'error' = 'order_archived'
    and (select total_mode = 'items' from public.orders where id = oarch), 'archived orders are read-only');

  -- ------------------------------------- the legacy path is unchanged
  r := public.replace_order_items_v1(o3, pg_temp.rv(o3), jsonb_build_array(l1), 'items', null);
  r := public.set_order_total_amount(o3, '99', pg_temp.rv(o3));
  perform pg_temp.ok(r->>'error' = 'total_mode_items', 'set_order_total_amount still refuses items mode');

  -- direct writes are still refused
  begin
    update public.orders set total_mode = 'manual' where id = o3;
    raise exception 'phase68: direct total_mode write succeeded';
  exception when sqlstate '42501' then null;
  end;

  -- the flags never leak out of the function
  r := public.set_order_manual_total_v1(o3, '50', pg_temp.rv(o3));
  perform pg_temp.ok(r->>'ok' = 'true', 'o3 switched');
  perform pg_temp.ok(coalesce(current_setting('gestcopy.order_items_write', true), '') = ''
    and coalesce(current_setting('gestcopy.order_total_write', true), '') = '', 'write flags are cleared afterwards');
  begin
    update public.orders set total_amount = 1 where id = o3;
    raise exception 'phase68: direct total write succeeded after the RPC';
  exception when sqlstate '42501' then null;
  end;

  reset role;
  raise notice 'phase68 order line-item calculator: all assertions passed';
end $$;

rollback;
