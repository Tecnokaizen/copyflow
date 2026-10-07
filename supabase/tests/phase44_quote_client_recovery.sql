begin;
create function pg_temp.check_true(p boolean,label text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'phase44 client: %',label; end if; end $$;
do $$
declare ta uuid:='e4420000-0000-4000-8000-000000000011'; actor uuid:='e4420000-0000-4000-8000-000000000001';
  ca uuid; cb uuid; qid uuid:='e4420000-0000-4000-8000-000000000021'; r jsonb; v public.quote_versions%rowtype; q public.quotes%rowtype;
  h jsonb:='{"description":"Copias","issue_date":"2026-10-06","currency":"EUR","prices_include_tax":false,"contact_name":"Manual","contact_email":null,"contact_phone":"600111222","client_manual_fields":["contact_name","contact_email"]}';
  items jsonb:='[{"concept":"A4","quantity":"1","unit_price":"10"}]';
begin
  insert into auth.users(id,email,raw_user_meta_data) values(actor,'actor@phase44-client.test','{}');
  insert into public.profiles(id,full_name) values(actor,'Actor');
  insert into public.tenants(id,name,slug,active) values(ta,'Client change','phase44client',true);
  insert into public.memberships(tenant_id,user_id,role,active) values(ta,actor,'owner',true);
  perform public.seed_quote_statuses(ta); perform public.set_tenant_feature('phase44client','quotes',true,null);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.clients(tenant_id,name,contact_name,email,phone) values(ta,'A','Ana','a@example.test','600111222') returning id into ca;
  insert into public.clients(tenant_id,name,contact_name,email,phone) values(ta,'B','Bea','b@example.test','600333444') returning id into cb;
  execute 'set local role authenticated';
  r:=public.create_quote_draft_v1(ta,qid,ca,null,null,h,items,false);
  perform pg_temp.check_true(r->>'ok'='true','creation');
  select * into q from public.quotes where id=qid; select * into v from public.quote_versions where id=q.current_version_id;
  perform pg_temp.check_true(v.client_manual_fields=array['contact_name','contact_email'],'manual provenance persists');
  r:=public.change_quote_draft_client_v1(qid,q.row_version,cb,null,null,v.id,v.row_version,h||'{"contact_phone":"600333444"}',items);
  perform pg_temp.check_true(r->>'ok'='true','atomic client save');
  select * into q from public.quotes where id=qid; select * into v from public.quote_versions where id=q.current_version_id;
  perform pg_temp.check_true(q.client_id=cb and q.contact_name='Manual' and q.contact_phone='600333444','client and header committed together');
  perform pg_temp.check_true(v.client_manual_fields=array['contact_name','contact_email'] and v.client_snapshot->>'client_id'=cb::text,'new snapshot and manual flags coherent');
  perform pg_temp.check_true(v.client_snapshot->>'contact_email'='b@example.test','existing NULL inheritance remains');
  begin
    perform public.change_quote_draft_client_v1(qid,q.row_version,ca,null,null,v.id,v.row_version,h,
      '[{"concept":"Good","quantity":1,"unit_price":10},{"concept":"Bad","quantity":0,"unit_price":10}]');
    raise exception 'expected failure';
  exception when check_violation then null; end;
  perform pg_temp.check_true((select client_id=cb and row_version=q.row_version from public.quotes where id=qid),'failed item rolls back client association too');
  perform pg_temp.check_true((select row_version=v.row_version from public.quote_versions where id=v.id),'failed item rolls back draft');
  r:=public.change_quote_draft_client_v1(qid,q.row_version-1,ca,null,null,v.id,v.row_version,h,items);
  perform pg_temp.check_true(r->>'error'='conflict','quote CAS');
  r:=public.change_quote_draft_client_v1(qid,q.row_version,ca,null,null,v.id,v.row_version-1,h,items);
  perform pg_temp.check_true(r->>'error'='conflict','version CAS');
  r:=public.prepare_quote_version_v1(qid,v.id,v.row_version);
  perform pg_temp.check_true(r->>'ok'='true','prepare');
  select * into q from public.quotes where id=qid;
  r:=public.change_quote_draft_client_v1(qid,q.row_version,ca,null,null,v.id,(r->'version'->>'row_version')::bigint,h,items);
  perform pg_temp.check_true(r->>'error'='immutable_version','locked client remains immutable');
  r:=public.create_quote_version_v1(qid);
  perform pg_temp.check_true(r->'version'->'client_manual_fields'='["contact_name","contact_email"]'::jsonb,'real revision preserves manual provenance');
  execute 'reset role';
end $$;
rollback;
