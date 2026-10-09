-- Local/CI only. Transactional fixtures: no schema or production changes.
begin;
create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'Tamara RLS: %', label; end if; end $$;
do $$
declare
  staff uuid := 'ea460000-0000-4000-8000-000000000001';
  owner_a uuid := 'ea460000-0000-4000-8000-000000000002';
  owner_b uuid := 'ea460000-0000-4000-8000-000000000003';
  ta uuid := 'ea460000-0000-4000-8000-000000000011';
  tb uuid := 'ea460000-0000-4000-8000-000000000012';
  oa uuid := 'ea460000-0000-4000-8000-000000000021';
  ob uuid := 'ea460000-0000-4000-8000-000000000022';
  n integer;
  r jsonb;
  version text;
begin
  insert into auth.users(id, email, raw_user_meta_data) values (staff,'staff@tamara.test','{}'),(owner_a,'owner-a@tamara.test','{}'),(owner_b,'owner-b@tamara.test','{}');
  insert into public.profiles(id, full_name) values(staff,'Personal'),(owner_a,'Owner A'),(owner_b,'Owner B');
  insert into public.tenants(id,name,slug,active) values(ta,'Tamara A','tamara-rls-a',true),(tb,'Tamara B','tamara-rls-b',true);
  insert into public.memberships(tenant_id,user_id,role,active) values(ta,owner_a,'owner',true),(ta,staff,'staff',true),(tb,owner_b,'owner',true);
  insert into public.tenant_settings(tenant_id,business_name) values(ta,'A'),(tb,'B');
  insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled) values(ta,'Recibido','received',true,1,true,false,false,false),(tb,'Recibido','received',true,1,true,false,false,false);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',owner_a::text,true);
  set local role authenticated;
  insert into public.orders(id,tenant_id,title,status_id,due_at) select oa,ta,'Entrega domingo',id,'2026-10-11T08:00:00Z' from public.order_statuses where tenant_id=ta;
  perform set_config('request.jwt.claim.sub',owner_b::text,true);
  insert into public.orders(id,tenant_id,title,status_id) select ob,tb,'Otro tenant',id from public.order_statuses where tenant_id=tb;
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform pg_temp.ok((select count(*)=1 from public.orders where id=oa),'staff reads own Sunday order');
  r := public.record_order_payment(oa,'30',now(),'tamara-payment-first');
  perform pg_temp.ok(r->>'error'='total_undefined','cannot record payment before total');
  select row_version::text into version from public.orders where id=oa;
  r := public.set_order_total_amount(oa,'85',version);
  perform pg_temp.ok((r->>'ok')::boolean,'staff can define canonical total');
  r := public.record_order_payment(oa,'30','2026-10-09T10:00:00Z','tamara-payment-first');
  perform pg_temp.ok(r->>'paid_amount'='30.00' and r->>'pending_amount'='55.00','canonical 85 total - 30 advance = 55 pending');
  r := public.record_order_payment(oa,'30','2026-10-09T10:00:00Z','tamara-payment-first');
  perform pg_temp.ok(r->>'paid_amount'='30.00','retry does not duplicate advance');
  r := public.record_order_payment(oa,'60',now(),'tamara-payment-excess');
  perform pg_temp.ok(r->>'error'='payment_exceeds_total','advance cannot exceed pending');
  r := public.set_order_total_amount(oa,'29',(select row_version::text from public.orders where id=oa));
  perform pg_temp.ok(r->>'error'='total_below_paid','cannot reduce total below advance');
  r := public.record_order_payment(ob,'30',now(),'tamara-payment-other');
  perform pg_temp.ok(r->>'error'='not_found','cannot record advance in other tenant');

  perform pg_temp.ok((select count(*)=0 from public.orders where id=ob),'staff cannot read other tenant');
  perform pg_temp.ok((select count(*)=1 from public.tenant_settings where tenant_id=ta),'staff reads own timezone');
  perform pg_temp.ok((select count(*)=0 from public.tenant_settings where tenant_id=tb),'settings tenant isolation');
  perform public.list_team_members(ta,null,true);
  begin
    perform public.list_team_members(tb,null,true);
    raise exception 'cross-tenant workload unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  perform pg_temp.ok((select count(*)=0 from public.activity_log),'no administrative activity metrics');
  update public.tenant_settings set business_name='Unauthorized' where tenant_id=ta;
  get diagnostics n = row_count;
  perform pg_temp.ok(n=0,'staff cannot change settings');
  update public.orders set title='Unauthorized' where id=ob;
  get diagnostics n = row_count;
  perform pg_temp.ok(n=0,'staff cannot mutate other tenant');
  reset role;
  update public.memberships set active=false where tenant_id=ta and user_id=staff;
  set local role authenticated;
  perform pg_temp.ok((select count(*)=0 from public.orders where id=oa),'inactive membership loses order access');
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  begin
    perform pg_temp.ok((select count(*)=0 from public.orders where id in(oa,ob)),'anonymous denied');
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
rollback;
