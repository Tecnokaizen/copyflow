-- Real role/RLS/transaction tests; fixtures roll back.
begin;
create function pg_temp.check_true(p boolean,label text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'phase44: %',label; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected then return; end if;
    raise exception 'phase44 expected %, got %: %',expected,sqlstate,sqlerrm;
  end;
  raise exception 'phase44 unexpectedly succeeded';
end $$;
do $test$
declare
  ta uuid:='e4400000-0000-4000-8000-000000000011'; tb uuid:='e4400000-0000-4000-8000-000000000012';
  actor uuid:='e4400000-0000-4000-8000-000000000001'; other_actor uuid:='e4400000-0000-4000-8000-000000000002';
  qid uuid:='e4400000-0000-4000-8000-000000000031'; client uuid; svc uuid; member uuid;
  r jsonb; again jsonb; h jsonb; items jsonb; vid uuid; rv bigint; role_name text; enabled boolean; n integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(actor,'actor@phase44.test','{}'),(other_actor,'other@phase44.test','{}');
  insert into public.profiles(id,full_name) values(actor,'Actor'),(other_actor,'Other');
  insert into public.tenants(id,name,slug,active) values(ta,'Creation A','phase44a',true),(tb,'Creation B','phase44b',true);
  insert into public.memberships(tenant_id,user_id,role,active) values(ta,actor,'owner',true),(tb,actor,'owner',true),(ta,other_actor,'owner',true);
  perform public.seed_quote_statuses(ta); perform public.seed_quote_statuses(tb);
  perform public.set_tenant_feature('phase44a','quotes',true,null); perform public.set_tenant_feature('phase44b','quotes',true,null);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.clients(tenant_id,name,contact_name) values(tb,'Foreign','Hidden') returning id into client;
  insert into public.services(tenant_id,name) values(tb,'Foreign') returning id into svc;
  insert into public.team_members(tenant_id,name) values(tb,'Foreign') returning id into member;
  h:='{"description":"Copias","title":"Trabajo","issue_date":"2026-10-06","currency":"EUR","prices_include_tax":false,"contact_name":"Ana","billing_address":"Manual"}';
  items:='[{"concept":"Copias A4","quantity":"2","unit_price":"100","discount_percent":"10","tax_rate":"21"}]';
  perform set_config('request.jwt.claim.role','authenticated',true); perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  perform pg_temp.expect_error(format('insert into public.quotes(id,tenant_id,status_id,description) values(%L,%L,null,''hack'')',qid,ta),'42501');
  perform pg_temp.expect_error('select * from public.quote_draft_creations','42501');
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,client,null,null,h,items,false)->>'error'='invalid','client tenant check');
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,svc,null,h,items,false)->>'error'='invalid','service tenant check');
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,null,member,h,items,false)->>'error'='invalid','assignee tenant check');
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,null,null,h,'[]',true)->>'error'='items_required','empty prepare');
  -- Failure occurs after quote + draft INSERT; ALL effects including numbering roll back.
  perform pg_temp.expect_error(format('select public.create_quote_draft_v1(%L,%L,null,null,null,%L,%L,false)',ta,qid,h,
    '[{"concept":"Bad","quantity":"0","unit_price":"100"}]'),'23514');
  perform pg_temp.check_true(not exists(select 1 from public.quotes where id=qid),'no partial quote after error');
  execute 'reset role';
  perform pg_temp.check_true(not exists(select 1 from public.quote_draft_creations where creation_id=qid),'no partial receipt');
  perform pg_temp.check_true(not exists(select 1 from public.quote_number_counters where tenant_id=ta),'no consumed number');
  execute 'set local role authenticated';
  r:=public.create_quote_draft_v1(ta,qid,null,null,null,h,items,false);
  perform pg_temp.check_true(r->>'ok'='true' and r->>'quote_id'=qid::text,'creation acknowledgement');
  vid:=(r->'version'->>'id')::uuid; rv:=(r->'version'->>'row_version')::bigint;
  perform pg_temp.check_true((r->'version'->>'total')::numeric=217.80,'server totals in complete draft');
  perform pg_temp.check_true((select count(*)=1 from public.quote_items where quote_version_id=vid),'one valid line');
  again:=public.create_quote_draft_v1(ta,qid,null,null,null,h,items,false);
  perform pg_temp.check_true(again=r,'exact stable replay after lost response');
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,null,null,h||'{"title":"Changed"}',items,false)->>'error'='creation_conflict','changed request rejected');
  perform pg_temp.check_true(public.create_quote_draft_v1(tb,qid,null,null,null,h,items,false)->>'error'='creation_conflict','multi-membership tenant collision');
  perform set_config('request.jwt.claim.sub',other_actor::text,true);
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,null,null,h,items,false)->>'error'='creation_conflict','different actor rejected');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  again:=public.prepare_quote_version_v1(qid,vid,rv);
  perform pg_temp.check_true(again->>'ok'='true','prepare unchanged RPC');
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,null,null,h,items,false)=r,'replay stable after preparation');
  perform pg_temp.check_true(public.save_quote_draft_v1(qid,vid,rv,h,items)->>'error'='immutable_version','locked version remains immutable');
  execute 'reset role';
  perform pg_temp.check_true((select count(*)=1 from public.quote_draft_creations where creation_id=qid),'one private receipt');
  perform pg_temp.check_true((select last_number=1 from public.quote_number_counters where tenant_id=ta),'one number despite retries');
  -- Matrix: each normal operative role is permitted, all others/disabled feature/inactive membership denied.
  for role_name in select unnest(array['owner','admin','manager','staff','viewer']) loop
    for enabled in select unnest(array[true,false]) loop
      update public.memberships set role=role_name where tenant_id=ta and user_id=actor;
      perform public.set_tenant_feature('phase44a','quotes',enabled,null);
      execute 'set local role authenticated';
      again:=public.create_quote_draft_v1(ta,gen_random_uuid(),null,null,null,h,items,true);
      if role_name in ('owner','admin','manager','staff') and enabled then
        perform pg_temp.check_true(again->>'ok'='true' and again->'version'->>'state'='prepared','role permitted and atomic prepare');
      else perform pg_temp.check_true(again->>'error'='not_found','role or feature denied'); end if;
      execute 'reset role';
    end loop;
  end loop;
  update public.memberships set role='owner',active=false where tenant_id=ta and user_id=actor;
  perform public.set_tenant_feature('phase44a','quotes',true,null);
  execute 'set local role authenticated';
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,null,null,h,items,false)->>'error'='not_found','inactive membership cannot replay');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.check_true(public.create_quote_draft_v1(ta,qid,null,null,null,h,items,false)->>'error'='not_found','missing actor denied');
  execute 'set local role anon';
  perform pg_temp.expect_error(format('select public.create_quote_draft_v1(%L,%L,null,null,null,%L,%L,false)',ta,qid,h,items),'42501');
  execute 'reset role';
  execute 'set local role service_role';
  perform pg_temp.expect_error(format('select public.create_quote_draft_v1(%L,%L,null,null,null,%L,%L,false)',ta,qid,h,items),'42501');
  execute 'reset role';
end;
$test$;
rollback;
