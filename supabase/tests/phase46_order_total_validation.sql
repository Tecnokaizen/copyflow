-- Local only. Order total: 0 collected allows a total, real deposits stay protected,
-- and an unrelated check violation is not reported as total_below_paid.
begin;
create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase46: %', label;
  end if;
end $$;

do $$
declare
  a uuid := 'e4600000-0000-4000-8000-000000000001';
  ta uuid := 'e4600000-0000-4000-8000-000000000011';
  client_a uuid := 'e4600000-0000-4000-8000-000000000021';
  order_a uuid := 'e4600000-0000-4000-8000-000000000031';
  plan uuid := 'e4600000-0000-4000-8000-000000000041';
  r jsonb;
  paid_at timestamptz := '2026-10-13T08:00:00Z';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase46.test', '{}');
  insert into public.profiles (id, full_name) values (a, 'Ana');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase46 A', 'phase46a', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true);
  insert into public.order_statuses (tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
  values (ta, 'Recibido', 'received', true, 1, true, false, false, false);
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (plan, 'phase46', 'Phase46', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
  select plan, id, true, 500 from public.features where code = 'storage_bytes';
  insert into public.subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
  values (ta, plan, 'active', now(), now() + interval '30 days');

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;

  insert into public.clients (id, tenant_id, name) values (client_a, ta, 'Cliente A');
  insert into public.orders (id, tenant_id, title, status_id, client_id)
  select order_a, ta, 'Pedido sin cobro', id, client_a
  from public.order_statuses where tenant_id = ta and is_initial;

  reset role;
  alter table public.orders
    add constraint orders_total_amount_probe
    check (total_amount is distinct from 100::numeric) not valid;
  set local role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', a::text, true);

  begin
    r := public.set_order_total_amount(
      order_a,
      '100.00',
      (select row_version::text from public.orders where id = order_a)
    );
    if r->>'error' = 'total_below_paid' then
      raise exception 'unrelated 23514 was rewritten as total_below_paid';
    end if;
    raise exception 'probe constraint did not fail';
  exception when others then
    if sqlerrm in (
      'unrelated 23514 was rewritten as total_below_paid',
      'probe constraint did not fail'
    ) then
      raise exception 'phase46: %', sqlerrm;
    end if;
    if sqlstate is distinct from '23514' or position('orders_total_amount_probe' in sqlerrm) = 0 then
      raise exception 'phase46: expected the probe check, got % %', sqlstate, sqlerrm;
    end if;
  end;

  reset role;
  alter table public.orders drop constraint orders_total_amount_probe;
  set local role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', a::text, true);

  r := public.set_order_total_amount(
    order_a,
    '100.00',
    (select row_version::text from public.orders where id = order_a)
  );
  perform pg_temp.ok(
    r->>'ok' = 'true'
      and r->>'total_amount' = '100.00'
      and r->>'paid_amount' = '0.00'
      and r->>'pending_amount' = '100.00'
      and r->>'collection_state' = 'unpaid',
    'zero collected allows a 100 total'
  );

  -- EXPAND: the previous 4-argument contract still records; checked and rolled back.
  begin
    r := public.record_order_payment(order_a, '100.00', paid_at, 'pay-100-old');
    perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '100.00', 'expand keeps the previous contract');
    raise exception 'phase46_expand_rollback';
  exception when others then
    if sqlerrm <> 'phase46_expand_rollback' then raise; end if;
  end;
  r := public.record_order_payment(order_a, '100.00', paid_at, 'pay-100-p1', 'cash', null, ta);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '100.00', 'real deposit is recorded');
  r := public.record_order_payment(order_a, '100.00', paid_at, 'pay-100-p1');
  perform pg_temp.ok(r->>'replayed' = 'true' and r->>'paid_amount' = '100.00', 'old contract replays the deposit without a second charge');

  r := public.set_order_total_amount(
    order_a,
    '99.99',
    (select row_version::text from public.orders where id = order_a)
  );
  perform pg_temp.ok(r->>'error' = 'total_below_paid', 'total below a real deposit stays rejected');
  perform pg_temp.ok(
    (select total_amount = 100 from public.orders where id = order_a),
    'rejected total does not change the order'
  );

  r := public.set_order_total_amount(
    order_a,
    '100.00',
    (select row_version::text from public.orders where id = order_a)
  );
  perform pg_temp.ok(
    r->>'ok' = 'true' and r->>'total_amount' = '100.00' and r->>'paid_amount' = '100.00',
    'total equal to the deposit is allowed'
  );

  r := public.set_order_total_amount(
    order_a,
    '150.00',
    (select row_version::text from public.orders where id = order_a)
  );
  perform pg_temp.ok(
    r->>'ok' = 'true' and r->>'total_amount' = '150.00' and r->>'pending_amount' = '50.00',
    'total above the deposit is allowed'
  );
end $$;
rollback;
