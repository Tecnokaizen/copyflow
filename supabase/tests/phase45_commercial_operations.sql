-- Local only. Commercial operations: payments, exact conversion total, internal notes, client activity.
begin;
create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase45: %', label;
  end if;
end $$;
create function pg_temp.boom(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected then
      return;
    end if;
    raise exception 'phase45 expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'phase45 unexpectedly succeeded: %', statement;
end $$;
create function pg_temp.sig(purpose text, actor uuid, tenant uuid, quote uuid, file uuid, issued bigint) returns text
language sql as $$
  select encode(extensions.hmac(
    convert_to('files-v1-quote|' || purpose || '|' || actor || '|' || tenant || '|' || quote || '|' || file || '|' || issued, 'UTF8'),
    convert_to('phase45-commercial-secret-32-characters', 'UTF8'),
    'sha256'
  ), 'hex')
$$;

do $$
declare
  a uuid := 'e4500000-0000-4000-8000-000000000001';
  b uuid := 'e4500000-0000-4000-8000-000000000002';
  viewer uuid := 'e4500000-0000-4000-8000-000000000003';
  staff uuid := 'e4500000-0000-4000-8000-000000000004';
  ta uuid := 'e4500000-0000-4000-8000-000000000011';
  tb uuid := 'e4500000-0000-4000-8000-000000000012';
  client_a uuid := 'e4500000-0000-4000-8000-000000000021';
  client_a2 uuid := 'e4500000-0000-4000-8000-000000000022';
  client_b uuid := 'e4500000-0000-4000-8000-000000000023';
  order_a uuid := 'e4500000-0000-4000-8000-000000000031';
  order_b uuid := 'e4500000-0000-4000-8000-000000000032';
  plan uuid := 'e4500000-0000-4000-8000-000000000041';
  file uuid := 'e4500000-0000-4000-8000-000000000051';
  q uuid;
  q_other uuid;
  v uuid;
  r jsonb;
  r2 jsonb;
  snap jsonb;
  paid_at timestamptz := '2026-10-07T10:00:00Z';
  issued bigint := extract(epoch from now())::bigint;
  version_before jsonb;
  versions_before integer;
  n integer;
  i integer;
begin
  if exists(select 1 from vault.secrets where name = 'files_signing_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'files_signing_secret' limit 1),
      'phase45-commercial-secret-32-characters'
    );
  else
    perform vault.create_secret('phase45-commercial-secret-32-characters', 'files_signing_secret');
  end if;

  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase45.test', '{}'),
    (b, 'b@phase45.test', '{}'),
    (viewer, 'viewer@phase45.test', '{}'),
    (staff, 'staff@phase45.test', '{}');
  insert into public.profiles (id, full_name) values
    (a, 'Ana'), (b, 'Bruno'), (viewer, 'Vero'), (staff, 'Sara');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase45 A', 'phase45a', true),
    (tb, 'Phase45 B', 'phase45b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true),
    (ta, viewer, 'viewer', true),
    (ta, staff, 'staff', true),
    (tb, b, 'owner', true);
  insert into public.order_statuses (tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
  values
    (ta, 'Recibido', 'received', true, 1, true, false, false, false),
    (tb, 'Recibido', 'received', true, 1, true, false, false, false);
  perform public.seed_quote_statuses(ta);
  perform public.seed_quote_statuses(tb);
  perform public.set_tenant_feature('phase45a', 'quotes', true, null);
  perform public.set_tenant_feature('phase45b', 'quotes', true, null);
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (plan, 'phase45', 'Phase45', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
  select plan, id, true, 500 from public.features where code = 'storage_bytes';
  insert into public.subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
  values (ta, plan, 'active', now(), now() + interval '30 days');

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;

  insert into public.clients (id, tenant_id, name) values
    (client_a, ta, 'Cliente A'),
    (client_a2, ta, 'Cliente A2');
  insert into public.orders (id, tenant_id, title, status_id, client_id)
  select order_a, ta, 'Pedido A', id, client_a
  from public.order_statuses where tenant_id = ta and is_initial;

  perform set_config('request.jwt.claim.sub', b::text, true);
  insert into public.clients (id, tenant_id, name) values (client_b, tb, 'Cliente B');
  insert into public.orders (id, tenant_id, title, status_id, client_id)
  select order_b, tb, 'Pedido B', id, client_b
  from public.order_statuses where tenant_id = tb and is_initial;

  perform set_config('request.jwt.claim.sub', a::text, true);

  perform pg_temp.ok(
    (select data_type = 'numeric' from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'total_amount'),
    'total_amount is numeric'
  );
  perform pg_temp.ok(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'quote_versions' and column_name = 'internal_notes'
    ),
    'versions have no internal notes'
  );

  r := public.record_order_payment(order_a, '100.00', paid_at, 'pay-undefined');
  perform pg_temp.ok(r->>'error' = 'total_undefined', 'payment without total is rejected');

  r := public.set_order_total_amount(order_a, '200.00', (select row_version::text from public.orders where id = order_a));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'total_amount' = '200.00' and r->>'paid_amount' = '0.00' and r->>'pending_amount' = '200.00' and r->>'collection_state' = 'unpaid', 'exact total');
  perform pg_temp.ok(jsonb_typeof(r->'total_amount') = 'string', 'total is text');

  r := public.record_order_payment(order_a, '0', paid_at, 'pay-zero');
  perform pg_temp.ok(r->>'error' = 'invalid_amount', 'zero rejected');
  r := public.record_order_payment(order_a, '-1.00', paid_at, 'pay-negative');
  perform pg_temp.ok(r->>'error' = 'invalid_amount', 'negative rejected');

  r := public.record_order_payment(order_a, '100.00', paid_at, 'pay-100-a');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'replayed' = 'false' and r->>'paid_amount' = '100.00' and r->>'pending_amount' = '100.00' and r->>'collection_state' = 'partial', 'first deposit');
  r2 := public.record_order_payment(order_a, '100.00', paid_at, 'pay-100-a');
  perform pg_temp.ok(r2->>'replayed' = 'true' and r2->>'payment_id' = r->>'payment_id', 'idempotent retry');
  perform pg_temp.ok((select count(*) = 1 from public.order_payments where order_id = order_a and idempotency_key = 'pay-100-a'), 'retry does not duplicate');
  r2 := public.record_order_payment(order_a, '90.00', paid_at, 'pay-100-a');
  perform pg_temp.ok(r2->>'error' = 'idempotency_mismatch', 'same key different amount');

  r := public.record_order_payment(order_a, '50.00', paid_at + interval '1 hour', 'pay-50-a');
  perform pg_temp.ok(r->>'paid_amount' = '150.00' and r->>'pending_amount' = '50.00', 'multiple payments sum');
  r := public.record_order_payment(order_a, '50.01', paid_at, 'pay-over');
  perform pg_temp.ok(r->>'error' = 'payment_exceeds_total', 'cannot exceed total');
  perform pg_temp.ok((select coalesce(sum(amount), 0) = 150 from public.order_payments where order_id = order_a and voided_at is null), 'ledger unchanged after excess');

  r := public.set_order_total_amount(order_a, '149.99', (select row_version::text from public.orders where id = order_a));
  perform pg_temp.ok(r->>'error' = 'total_below_paid', 'cannot reduce total below collected');
  r := public.set_order_total_amount(order_a, null, (select row_version::text from public.orders where id = order_a));
  perform pg_temp.ok(r->>'error' = 'total_below_paid', 'cannot clear total after payments');
  perform pg_temp.ok((select total_amount = 200 from public.orders where id = order_a), 'total preserved');

  r := public.void_order_payment(
    (select id from public.order_payments where order_id = order_a and idempotency_key = 'pay-50-a'),
    'corrección de caja'
  );
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '100.00' and r->>'pending_amount' = '100.00', 'void restores pending');
  perform pg_temp.ok((select count(*) = 2 from public.order_payments where order_id = order_a), 'void keeps history');
  perform pg_temp.ok(
    (select count(*) = 1 from public.activity_log where entity_id = order_a and action = 'order.payment_voided'),
    'void is audited'
  );
  perform pg_temp.ok(
    not exists (
      select 1 from public.activity_log
      where entity_id = order_a
        and action = 'order.payment_voided'
        and (previous_values::text ilike '%corrección%' or new_values::text ilike '%corrección%')
    ),
    'void activity keeps the amount, not a free-form rewrite'
  );

  perform pg_temp.boom(format('delete from public.order_payments where order_id = %L', order_a), '42501');
  reset role;
  perform pg_temp.boom(format('delete from public.order_payments where order_id = %L', order_a), '55000');
  perform pg_temp.boom(format('update public.orders set total_amount = 10 where id = %L', order_a), '42501');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', a::text, true);

  perform set_config('request.jwt.claim.sub', b::text, true);
  r := public.order_collection_v1(order_a);
  perform pg_temp.ok(r->>'error' = 'not_found', 'tenant B cannot read tenant A collection');
  r := public.record_order_payment(order_a, '10.00', paid_at, 'cross-tenant');
  perform pg_temp.ok(r->>'error' = 'not_found', 'tenant B cannot pay tenant A order');
  perform pg_temp.ok(
    (select count(*) = 0 from public.order_payments where order_id = order_a and idempotency_key = 'cross-tenant'),
    'cross-tenant insert did not land'
  );
  perform pg_temp.boom(
    format('insert into public.order_payments (tenant_id, order_id, amount, paid_at, created_by, idempotency_key) values (%L, %L, 10, now(), %L, ''direct-b'')', tb, order_a, b),
    '42501'
  );
  perform pg_temp.ok((select count(*) = 0 from public.order_payments where tenant_id = ta and created_by = b), 'no cross-tenant rows visible or created');

  perform set_config('request.jwt.claim.sub', viewer::text, true);
  r := public.order_collection_v1(order_a);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '100.00', 'viewer can read collection');
  r := public.record_order_payment(order_a, '10.00', paid_at, 'viewer-pay');
  perform pg_temp.ok(r->>'error' = 'forbidden', 'viewer cannot record payments');
  r := public.set_order_total_amount(order_a, '300.00', (select row_version::text from public.orders where id = order_a));
  perform pg_temp.ok(r->>'error' = 'forbidden', 'viewer cannot change total');

  perform set_config('request.jwt.claim.sub', staff::text, true);
  r := public.record_order_payment(order_a, '25.00', paid_at + interval '2 hour', 'staff-pay');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '125.00' and r->>'pending_amount' = '75.00', 'staff can record a payment');

  perform set_config('request.jwt.claim.sub', a::text, true);
  perform pg_temp.ok(
    (select count(*) >= 1 from public.activity_log where entity_id = order_a and action = 'order.total_changed'),
    'total changes are audited'
  );
  perform pg_temp.ok(
    (select count(*) >= 1 from public.activity_log where entity_id = order_a and action = 'order.payment_recorded'),
    'payments are audited'
  );

  -- Client activity stays inside the client and the tenant.
  perform pg_temp.ok(
    (select count(*) = 1 from public.list_client_activity(client_a) where action = 'client.created'),
    'client.created is listed'
  );
  update public.clients set name = 'Cliente A editado' where id = client_a;
  perform pg_temp.ok(
    (select count(*) = 1 from public.list_client_activity(client_a) where action = 'client.updated'),
    'client.updated is listed'
  );
  perform pg_temp.ok(
    not exists (select 1 from public.list_client_activity(client_a) where entity_id is distinct from client_a),
    'client activity is only that client'
  );
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform pg_temp.boom(format('select * from public.list_client_activity(%L)', client_a), 'P0002');
  perform set_config('request.jwt.claim.sub', a::text, true);

  -- Quotes linked by quotes.client_id, paginated, hidden from the other client and from viewers via RLS.
  insert into public.quotes (tenant_id, status_id, description, client_id)
  select ta, id, 'Otro cliente', client_a2 from public.quote_statuses where tenant_id = ta and code = 'draft'
  returning id into q_other;
  for i in 1..21 loop
    insert into public.quotes (tenant_id, status_id, description, client_id)
    select ta, id, 'Presupuesto ' || i, client_a from public.quote_statuses where tenant_id = ta and code = 'draft';
  end loop;
  r := public.list_client_quotes(client_a, 1);
  perform pg_temp.ok(r->>'ok' = 'true' and (r->>'total')::int = 21 and jsonb_array_length(r->'quotes') = 20 and r->>'has_more' = 'true', 'first page is not a silent truncation');
  r2 := public.list_client_quotes(client_a, 2);
  perform pg_temp.ok((r2->>'total')::int = 21 and jsonb_array_length(r2->'quotes') = 1 and r2->>'has_more' = 'false', 'second page returns the remainder');
  perform pg_temp.ok(
    not exists (
      select 1 from jsonb_array_elements(r->'quotes') item
      where item->>'id' = q_other::text
    ),
    'other client quotes are excluded'
  );
  perform set_config('request.jwt.claim.sub', viewer::text, true);
  r := public.list_client_quotes(client_a, 1);
  perform pg_temp.ok((r->>'total')::int = 0 and jsonb_array_length(r->'quotes') = 0, 'viewer RLS hides quotes');
  perform set_config('request.jwt.claim.sub', b::text, true);
  r := public.list_client_quotes(client_a, 1);
  perform pg_temp.ok(r->>'error' = 'not_found', 'other tenant cannot list client quotes');
  perform set_config('request.jwt.claim.sub', a::text, true);

  -- Accepted conversion copies the stored numeric total and replay does not change it.
  insert into public.quotes (tenant_id, status_id, description, title, client_id)
  select ta, id, 'Trabajo exacto', 'Trabajo exacto', client_a
  from public.quote_statuses where tenant_id = ta and code = 'draft'
  returning id into q;
  r := public.ensure_quote_draft_v1(q);
  v := (r->'version'->>'id')::uuid;
  r := public.save_quote_draft_v1(
    q, v, 0,
    '{"title":"Trabajo exacto"}',
    '[{"concept":"Copias","quantity":3,"unit_price":33.33,"tax_rate":0}]'
  );
  perform pg_temp.ok(r->'version'->>'total' = '99.99', 'draft total is exact 99.99');
  r := public.prepare_quote_version_v1(q, v, (r->'version'->>'row_version')::bigint);
  perform pg_temp.ok(r->>'ok' = 'true', 'prepared');
  r := public.reserve_quote_pdf_v1(q, v, file, 100, issued, pg_temp.sig('create', a, ta, q, file, issued));
  perform pg_temp.ok(r->'file'->>'id' = file::text, 'pdf reserved');
  r := public.finish_quote_pdf_v1(q, v, file, 'etag', issued, pg_temp.sig('complete', a, ta, q, file, issued));
  perform pg_temp.ok(r->'file'->>'status' = 'ready', 'pdf finished');
  r := public.transition_quote_v1(q, v, (select row_version from public.quotes where id = q), 'send');
  perform pg_temp.ok(r->>'ok' = 'true', 'sent');
  r := public.transition_quote_v1(q, v, (select row_version from public.quotes where id = q), 'accept');
  perform pg_temp.ok(r->>'ok' = 'true', 'accepted');

  select to_jsonb(x) into version_before from public.quote_versions x where id = v;
  select count(*) into versions_before from public.quote_versions where quote_id = q;
  r := public.convert_quote_to_order(q, null, null, null, 'normal', null, (select row_version from public.quotes where id = q));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'created' = 'true' and r->>'total_amount' = '99.99', 'conversion inherits accepted total');
  perform pg_temp.ok(
    (select o.total_amount = ver.total and o.total_amount = 99.99
      from public.orders o
      join public.quotes qq on qq.converted_order_id = o.id
      join public.quote_versions ver on ver.id = qq.accepted_version_id
      where qq.id = q),
    'order total equals accepted version numeric'
  );
  r2 := public.convert_quote_to_order(q, null, null, null, 'normal', null, 0);
  perform pg_temp.ok(
    r2->>'replayed' = 'true'
    and r2->>'order_id' = r->>'order_id'
    and r2->>'total_amount' = '99.99'
    and (select total_amount = 99.99 from public.orders where id = (r->>'order_id')::uuid),
    'conversion retry keeps the same order and total'
  );

  r := public.update_quote_internal_notes(q, 'INTERNAL_NOTE_SECRET_phase45', (select row_version::text from public.quotes where id = q));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'changed' = 'true', 'internal notes saved after acceptance');
  perform pg_temp.ok((select count(*) = versions_before from public.quote_versions where quote_id = q), 'internal notes do not create a revision');
  perform pg_temp.ok((select to_jsonb(x) = version_before from public.quote_versions x where id = v), 'snapshot unchanged');
  perform pg_temp.ok(
    position('INTERNAL_NOTE_SECRET_phase45' in coalesce(public.quote_pdf_source_v1(ta, q, v)::text, '')) = 0,
    'internal notes are absent from the PDF source'
  );
  select count(*) into n from public.activity_log
  where entity_id = q and action = 'quote.internal_notes_updated';
  perform pg_temp.ok(n = 1, 'internal notes activity exists');
  perform pg_temp.ok(
    not exists (
      select 1 from public.activity_log
      where entity_id = q
        and action = 'quote.internal_notes_updated'
        and (
          previous_values::text like '%INTERNAL_NOTE_SECRET_phase45%'
          or new_values::text like '%INTERNAL_NOTE_SECRET_phase45%'
          or metadata::text like '%INTERNAL_NOTE_SECRET_phase45%'
        )
    ),
    'activity does not copy the note'
  );
  perform pg_temp.boom(
    format('update public.quotes set internal_notes = %L where id = %L', 'direct', q),
    '42501'
  );
  perform pg_temp.ok(
    (select internal_notes = 'INTERNAL_NOTE_SECRET_phase45' from public.quotes where id = q),
    'direct update did not replace the note'
  );
  perform pg_temp.ok(
    (select notes is distinct from internal_notes from public.quotes where id = q),
    'commercial notes stay separate'
  );
end $$;
rollback;
