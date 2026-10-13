-- Local only. Commercial operations: payments, exact conversion total, internal notes, client activity.
begin;
create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase46: %', label;
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
    raise exception 'phase46 expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'phase46 unexpectedly succeeded: %', statement;
end $$;
create function pg_temp.sig(purpose text, actor uuid, tenant uuid, quote uuid, file uuid, issued bigint) returns text
language sql as $$
  select encode(extensions.hmac(
    convert_to('files-v1|' || purpose || '|' || actor || '|' || tenant || '|' || quote || '|' || file || '|' || issued, 'UTF8'),
    convert_to('phase46-commercial-secret-32-characters', 'UTF8'),
    'sha256'
  ), 'hex')
$$;

do $$
declare
  a uuid := 'e4600000-0000-4000-8000-000000000001';
  b uuid := 'e4600000-0000-4000-8000-000000000002';
  viewer uuid := 'e4600000-0000-4000-8000-000000000003';
  staff uuid := 'e4600000-0000-4000-8000-000000000004';
  ta uuid := 'e4600000-0000-4000-8000-000000000011';
  tb uuid := 'e4600000-0000-4000-8000-000000000012';
  client_a uuid := 'e4600000-0000-4000-8000-000000000021';
  client_a2 uuid := 'e4600000-0000-4000-8000-000000000022';
  client_b uuid := 'e4600000-0000-4000-8000-000000000023';
  order_a uuid := 'e4600000-0000-4000-8000-000000000031';
  order_b uuid := 'e4600000-0000-4000-8000-000000000032';
  plan uuid := 'e4600000-0000-4000-8000-000000000041';
  file uuid := 'e4600000-0000-4000-8000-000000000051';
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
  receipt uuid := 'e4600000-0000-4000-8000-000000000061';
  pending uuid := 'e4600000-0000-4000-8000-000000000062';
  foreign_file uuid := 'e4600000-0000-4000-8000-000000000063';
  wrong_order uuid := 'e4600000-0000-4000-8000-000000000064';
  second_order uuid := 'e4600000-0000-4000-8000-000000000065';
  deletable uuid := 'e4600000-0000-4000-8000-000000000066';
  historical uuid := 'e4600000-0000-4000-8000-000000000067';
  historical_void uuid := 'e4600000-0000-4000-8000-000000000068';
  method text;
begin
  if exists(select 1 from vault.secrets where name = 'files_signing_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'files_signing_secret' limit 1),
      'phase46-commercial-secret-32-characters'
    );
  else
    perform vault.create_secret('phase46-commercial-secret-32-characters', 'files_signing_secret');
  end if;

  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase46.test', '{}'),
    (b, 'b@phase46.test', '{}'),
    (viewer, 'viewer@phase46.test', '{}'),
    (staff, 'staff@phase46.test', '{}');
  insert into public.profiles (id, full_name) values
    (a, 'Ana'), (b, 'Bruno'), (viewer, 'Vero'), (staff, 'Sara');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase45 A', 'phase46a', true),
    (tb, 'Phase45 B', 'phase46b', true);
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
  perform public.set_tenant_feature('phase46a', 'quotes', true, null);
  perform public.set_tenant_feature('phase46b', 'quotes', true, null);
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (plan, 'phase46', 'Phase45', true, 99, 0, 0);
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


  r := public.set_order_total_amount(order_a, '200.00', (select row_version::text from public.orders where id = order_a));
  perform pg_temp.ok(r->>'ok' = 'true', 'define total');
  r := public.record_order_payment(order_a, '10.00', paid_at, 'no-method-old');
  perform pg_temp.ok(r->>'error' = 'invalid_payment_method', 'retired contract cannot create unspecified money');
  r := public.record_order_payment(order_a, '10.00', paid_at, 'no-method-new', null, null, ta);
  perform pg_temp.ok(r->>'error' = 'invalid_payment_method', 'method mandatory');
  r := public.record_order_payment(order_a, '10.00', paid_at, 'bad-method', 'crypto', null, ta);
  perform pg_temp.ok(r->>'error' = 'invalid_payment_method', 'unknown method rejected');
  perform pg_temp.ok((select count(*) = 0 from public.order_payments where order_id = order_a), 'invalid calls did not post money');

  reset role;
  alter table public.order_payments add constraint order_payments_phase46_unrelated check (amount <> 7.77);
  set local role authenticated;
  begin
    perform public.record_order_payment(order_a, '7.77', paid_at, 'unrelated-check', 'cash', null, ta);
    raise exception 'phase46: unrelated check became a payment result';
  exception when check_violation then
    if sqlerrm in ('payment_exceeds_total', 'invalid_payment_method', 'total_undefined', 'total_below_paid') then
      raise exception 'phase46: unrelated check reported as %', sqlerrm;
    end if;
  end;
  reset role;
  alter table public.order_payments drop constraint order_payments_phase46_unrelated;
  perform pg_temp.ok((select count(*) = 0 from public.order_payments where idempotency_key = 'unrelated-check'), 'unrelated check did not post money');

  reset role;
  insert into public.orders(id,tenant_id,title,status_id)
    select second_order,ta,'Segundo',id from public.order_statuses where tenant_id=ta and is_initial;
  perform set_config('request.jwt.claim.sub','',true);
  insert into public.order_files(id,tenant_id,order_id,original_name,content_type,size_bytes,storage_key,status,etag,completed_at,upload_expires_at,uploaded_by)
  values
    (receipt,ta,order_a,'bizum.pdf','application/pdf',12,'receipt/one','ready','etag',now(),now()+interval '5 minutes',a),
    (pending,ta,order_a,'pending.pdf','application/pdf',12,'receipt/pending','pending',null,null,now()+interval '5 minutes',a),
    (foreign_file,tb,order_b,'foreign.pdf','application/pdf',12,'receipt/foreign','ready','etag',now(),now()+interval '5 minutes',b),
    (wrong_order,ta,second_order,'wrong.pdf','application/pdf',12,'receipt/wrong','ready','etag',now(),now()+interval '5 minutes',a),
    (deletable,ta,order_a,'delete.pdf','application/pdf',12,'receipt/delete','ready','etag',now(),now()+interval '5 minutes',a);
  -- Simulate a pre-migration row: only fixture insertion bypasses the new-method
  -- guard. Enable it again before any business operations; everything rolls back.
  alter table public.order_payments disable trigger trg_order_payment_details_guard;
  perform set_config('request.jwt.claim.sub',a::text,true);
  insert into public.order_payments(id,tenant_id,order_id,amount,paid_at,created_by,idempotency_key)
    values
      (historical,ta,order_a,1,paid_at,a,'historic-key'),
      (historical_void,ta,order_a,2,paid_at,a,'historic-void-key');
  -- The rows exist as they did before the guard. Apply that guard now.
  drop trigger if exists trg_order_payment_details_guard on public.order_payments;
  create trigger trg_order_payment_details_guard
    before insert or update on public.order_payments
    for each row execute function public.tg_order_payment_details_guard();
  set local role authenticated;

  r := public.void_order_payment(historical_void, 'anulación de histórico');
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'paid_amount' = '1.00', 'historical null method voids after the guard is applied');
  perform pg_temp.ok((select payment_method is null and voided_at is not null from public.order_payments where id = historical_void), 'void keeps the unspecified historical method');
  reset role;
  perform pg_temp.boom(format('insert into public.order_payments(tenant_id,order_id,amount,paid_at,created_by,idempotency_key) values(%L,%L,1,%L,%L,''new-null-method'')', ta, order_a, paid_at, a), '23514');
  set local role authenticated;

  r := public.order_collection_v1(order_a);
  perform pg_temp.ok(r->>'paid_amount' = '1.00' and r->'payments'->0->>'payment_method' is null, 'historic payment intact and unspecified');
  foreach method in array array['cash','card','bizum','transfer','other'] loop
    r := public.record_order_payment(order_a,'1.00',paid_at,'method-'||method,method,null,ta);
    perform pg_temp.ok(r->>'ok'='true', 'all five payment methods accepted');
  end loop;
  r := public.record_order_payment(order_a,'10.00',paid_at,'pending-file','bizum',pending,ta);
  perform pg_temp.ok(r->>'error'='invalid_receipt','pending/failed COMPLETE cannot create payment');
  r := public.record_order_payment(order_a,'10.00',paid_at,'foreign-file','bizum',foreign_file,ta);
  perform pg_temp.ok(r->>'error'='invalid_receipt','foreign tenant receipt rejected');
  r := public.record_order_payment(order_a,'10.00',paid_at,'wrong-order','bizum',wrong_order,ta);
  perform pg_temp.ok(r->>'error'='invalid_receipt','same tenant different order rejected');
  r := public.record_order_payment(order_a,'10.00',paid_at,'wrong-context','bizum',null,tb);
  perform pg_temp.ok(r->>'error'='not_found','resolved context is mandatory');
  perform pg_temp.ok((select count(*)=7 from public.order_payments where order_id=order_a),'no payment from invalid receipts');

  r := public.record_order_payment(order_a,'10.00',paid_at,'receipt-key','bizum',receipt,ta);
  perform pg_temp.ok(r->>'ok'='true' and r->>'paid_amount'='16.00','payment with receipt');
  perform pg_temp.ok(exists(select 1 from jsonb_array_elements(r->'payments') p
    where p->>'id'=r->>'payment_id' and p->>'payment_method'='bizum'
    and p->'receipt'->>'id'=receipt::text and p->'receipt'->>'original_name'='bizum.pdf'), 'snapshot returns method and receipt metadata');
  perform pg_temp.ok(position('storage_key' in r::text)=0,'storage keys absent');
  r2 := public.record_order_payment(order_a,'10.00',paid_at,'receipt-key','bizum',receipt,ta);
  perform pg_temp.ok(r2->>'replayed'='true' and r2->>'payment_id'=r->>'payment_id','exact replay');
  r2 := public.record_order_payment(order_a,'10.00',paid_at,'receipt-key','card',receipt,ta);
  perform pg_temp.ok(r2->>'error'='idempotency_mismatch','method is part of idempotency');
  r2 := public.record_order_payment(order_a,'10.00',paid_at,'receipt-key','bizum',null,ta);
  perform pg_temp.ok(r2->>'error'='idempotency_mismatch','receipt is part of idempotency');
  r2 := public.record_order_payment(order_a,'10.00',paid_at,'receipt-second-key','bizum',receipt,ta);
  perform pg_temp.ok(r2->>'error'='receipt_already_used','one receipt cannot be reused for another movement');

  perform pg_temp.boom(format('select public.soft_delete_order_file(%L,%L,%s,%L)',order_a,receipt,issued,
    pg_temp.sig('delete',a,ta,order_a,receipt,issued)), '55000');
  reset role;
  perform pg_temp.boom(format('update public.order_payments set payment_method=''cash'' where id=%L',r->>'payment_id'),'55000');
  perform pg_temp.boom(format('update public.order_payments set receipt_file_id=null where id=%L',r->>'payment_id'),'55000');
  perform pg_temp.boom(format('delete from public.order_files where id=%L',receipt),'55000');
  set local role authenticated;
  r2 := public.void_order_payment((r->>'payment_id')::uuid,'corrección');
  perform pg_temp.ok(r2->>'ok'='true' and r2->>'paid_amount'='6.00','void only removes amount from sum');
  r2 := public.record_order_payment(order_a,'10.00',paid_at,'receipt-key','bizum',receipt,ta);
  perform pg_temp.ok(r2->>'replayed'='true' and r2->>'paid_amount'='6.00','replay of voided payment never creates new money');
  perform pg_temp.boom(format('select public.soft_delete_order_file(%L,%L,%s,%L)',order_a,receipt,issued,
    pg_temp.sig('delete',a,ta,order_a,receipt,issued)), '55000');

  -- Borrado reservado en DB: replay y rechazo de asociación posterior.
  r2 := public.soft_delete_order_file(order_a,deletable,issued,pg_temp.sig('delete',a,ta,order_a,deletable,issued));
  perform pg_temp.ok(r2->>'replay'='false','delete reservation');
  r2 := public.soft_delete_order_file(order_a,deletable,issued,pg_temp.sig('delete',a,ta,order_a,deletable,issued));
  perform pg_temp.ok(r2->>'replay'='true','retry for a failed blob deletion');
  r2 := public.record_order_payment(order_a,'1.00',paid_at,'deleted-receipt','cash',deletable,ta);
  perform pg_temp.ok(r2->>'error'='invalid_receipt','deleted file cannot attach');

  perform set_config('request.jwt.claim.sub',b::text,true);
  perform pg_temp.ok((select count(*)=0 from public.order_payments where tenant_id=ta),'RLS hides payments');
  perform pg_temp.ok((select count(*)=0 from public.order_files where tenant_id=ta),'RLS hides receipts');
  r2 := public.record_order_payment(order_a,'1.00',paid_at,'cross-tenant','cash',receipt,ta);
  perform pg_temp.ok(r2->>'error'='not_found','RPC refuses foreign member');
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  r2 := public.record_order_payment(order_a,'1.00',paid_at,'viewer-write','cash',null,ta);
  perform pg_temp.ok(r2->>'error'='forbidden','viewer cannot pay');
  perform pg_temp.boom(format('insert into public.order_payments(tenant_id,order_id,amount,paid_at,created_by,idempotency_key,payment_method) values(%L,%L,1,now(),%L,''direct-write'',''cash'')',ta,order_a,viewer),'42501');
  perform set_config('request.jwt.claim.sub',staff::text,true);
  r2 := public.record_order_payment(order_a,'1.00',paid_at,'staff-owned-file','cash',receipt,ta);
  perform pg_temp.ok(r2->>'error'='invalid_receipt','cannot take another uploader receipt');
  r2 := public.record_order_payment(order_a,'1.00',paid_at,'staff-no-receipt','cash',null,ta);
  perform pg_temp.ok(r2->>'ok'='true','staff can pay without receipt');
  reset role;
  perform pg_temp.ok(not has_function_privilege('anon','public.record_order_payment(uuid,text,timestamptz,text,text,uuid,uuid)','execute'),'anonymous RPC blocked');
  perform pg_temp.ok(not has_function_privilege('service_role','public.record_order_payment(uuid,text,timestamptz,text,text,uuid,uuid)','execute'),'service_role RPC blocked');
end $$;
rollback;
