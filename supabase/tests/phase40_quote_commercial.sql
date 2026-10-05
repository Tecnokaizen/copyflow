-- Real authenticated RLS/RPC tests. All fixture data is rolled back.
begin;
create function pg_temp.check_true(p boolean, label text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'phase40: %',label; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected then return; end if;
    raise exception 'phase40: expected %, got %: %',expected,sqlstate,sqlerrm;
  end;
  raise exception 'phase40: statement unexpectedly succeeded: %',statement;
end $$;

do $test$
declare
  ta uuid:='e4000000-0000-4000-8000-000000000011';
  tb uuid:='e4000000-0000-4000-8000-000000000012';
  actor uuid:='e4000000-0000-4000-8000-000000000001';
  other_actor uuid:='e4000000-0000-4000-8000-000000000002';
  qa uuid; qb uuid; va uuid; vb uuid; v2 uuid; client uuid;
  draft_a uuid; draft_b uuid; status uuid; legacy uuid; legacy_v uuid; role_quote uuid; role_version uuid; file_a uuid; file_b uuid;
  r jsonb; h jsonb; items jsonb; rv bigint; old_ref text; old_counter integer; order_id uuid; order_ref text; order_counter bigint; order_status uuid; role_name text; enabled boolean;
  amount record; v_code text; cnt integer;
begin
  -- Arithmetic is numeric; assertions use exact equality, including fractional rounding.
  select * into amount from public.quote_line_amounts_v1(2,105,0,21,false);
  perform pg_temp.check_true((amount.subtotal,amount.tax_amount,amount.total)=(210::numeric,44.10::numeric,254.10::numeric),'excluded IVA');
  select * into amount from public.quote_line_amounts_v1(1,121,0,21,true);
  perform pg_temp.check_true((amount.subtotal,amount.tax_amount,amount.total)=(100::numeric,21::numeric,121::numeric),'included IVA');
  select * into amount from public.quote_line_amounts_v1(2,100,10,21,false);
  perform pg_temp.check_true((amount.subtotal,amount.tax_amount,amount.total)=(180::numeric,37.80::numeric,217.80::numeric),'discount excluded');
  select * into amount from public.quote_line_amounts_v1(2,121,10,21,true);
  perform pg_temp.check_true((amount.subtotal,amount.tax_amount,amount.total)=(180::numeric,37.80::numeric,217.80::numeric),'discount included');
  select * into amount from public.quote_line_amounts_v1(1,0.025,0,0,false);
  perform pg_temp.check_true(amount.total=0.03,'round half cent away from zero');

  insert into auth.users(id,email,raw_user_meta_data) values
    (actor,'actor@phase40.test','{}'),(other_actor,'other@phase40.test','{}');
  insert into public.profiles(id,full_name) values(actor,'Actor'),(other_actor,'Other');
  insert into public.tenants(id,name,slug,active) values(ta,'Commercial A','phase40a',true),(tb,'Commercial B','phase40b',true);
  insert into public.memberships(tenant_id,user_id,role,active) values(ta,actor,'owner',true),(tb,other_actor,'owner',true);
  insert into public.tenant_settings(tenant_id,business_name) values(ta,'Seller A'),(tb,'Seller B');
  perform public.seed_quote_statuses(ta); perform public.seed_quote_statuses(tb);
  perform public.set_tenant_feature('phase40a','quotes',true,null);
  perform public.set_tenant_feature('phase40b','quotes',true,null);
  select id into draft_a from public.quote_statuses where tenant_id=ta and code='draft';
  select id into draft_b from public.quote_statuses where tenant_id=tb and code='draft';
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',other_actor::text,true);
  insert into public.quotes(tenant_id,status_id,description) values(tb,draft_b,'Other') returning id into qb;
  r:=public.ensure_quote_draft_v1(qb); vb:=(r->'version'->>'id')::uuid;
  r:=public.save_quote_draft_v1(qb,vb,0,'{"description":"Other"}',
    '[{"concept":"Hidden other tenant line","quantity":1,"unit_price":999}]');
  perform pg_temp.check_true(r->>'ok'='true','other tenant has actual items');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.order_statuses(tenant_id,name,code,is_initial) values(ta,'Received','received',true) returning id into order_status;
  insert into public.orders(tenant_id,status_id,title) values(ta,order_status,'Existing order') returning id,reference into order_id,order_ref;
  select last_number into order_counter from public.order_number_counters where tenant_id=ta;
  insert into public.clients(tenant_id,name,contact_name) values(ta,'ANFRE','Raquel Horcajo') returning id into client;
  insert into public.quotes(tenant_id,status_id,description,client_id) values(ta,draft_a,'Commercial',client) returning id,reference into qa,old_ref;
  select last_number into old_counter from public.quote_number_counters where tenant_id=ta;
  execute 'set local role authenticated';
  r:=public.ensure_quote_draft_v1(qa); va:=(r->'version'->>'id')::uuid; rv:=(r->'version'->>'row_version')::bigint;
  perform pg_temp.check_true(r->>'ok'='true','ensure draft');
  r:=public.ensure_quote_draft_v1(qa);
  perform pg_temp.check_true(r->>'created'='false' and (r->'version'->>'id')::uuid=va,'ensure idempotent');
  perform pg_temp.check_true(not exists(select 1 from public.quote_versions where id=vb),'cross-tenant SELECT versions');
  perform pg_temp.check_true(public.ensure_quote_draft_v1(qb)->>'error'='not_found','cross-tenant ensure');
  perform pg_temp.check_true(public.create_quote_version_v1(qb)->>'error'='not_found','cross-tenant clone');
  perform pg_temp.check_true(public.prepare_quote_version_v1(qa,vb,0)->>'error'='not_found','cross-tenant prepare version');
  perform pg_temp.check_true(public.save_quote_draft_v1(qa,vb,0,'{}','[]')->>'error'='not_found','cross-tenant save version');
  perform pg_temp.expect_error(format('insert into public.quote_versions(tenant_id,quote_id,version_number) values(%L,%L,2)',ta,qa),'42501');
  perform pg_temp.expect_error(format('update public.quote_versions set title=''hack'' where id=%L',va),'42501');
  perform pg_temp.expect_error(format('delete from public.quote_versions where id=%L',va),'42501');
  perform pg_temp.expect_error(format('insert into public.quote_items(tenant_id,quote_version_id,position,concept,quantity,unit_price) values(%L,%L,1,''hack'',1,1)',ta,va),'42501');
  perform pg_temp.expect_error(format('update public.quote_items set concept=''hack'' where quote_version_id=%L',va),'42501');
  perform pg_temp.expect_error(format('delete from public.quote_items where quote_version_id=%L',va),'42501');
  perform pg_temp.check_true(public.prepare_quote_version_v1(qa,va,rv)->>'error'='items_required','empty prepare rejected');
  h:=jsonb_build_object('title','CONGRESO MATERIAS PRIMAS','description','Commercial','contact_name','Raquel Horcajo',
    'billing_name','ANFRE','currency','EUR','prices_include_tax',true,'issue_date','2026-10-05','total',999999);
  items:='[{"concept":"Roll Up 85x205","quantity":2,"unit_price":105,"tax_rate":21,"total":999},
    {"concept":"Block notas A5","quantity":60,"unit_price":5.05,"tax_rate":21},
    {"concept":"Identificadores","quantity":60,"unit_price":1.10,"tax_rate":21},
    {"concept":"Cartulina impresa","quantity":60,"unit_price":0.85,"tax_rate":21}]';
  r:=public.save_quote_draft_v1(qa,va,rv,h,items);
  perform pg_temp.check_true(r->>'ok'='true' and (r->'version'->>'total')::numeric=630,'fixture and client totals ignored');
  perform pg_temp.check_true((r->'version'->>'subtotal')::numeric=520.66 and (r->'version'->>'tax_total')::numeric=109.34
    and jsonb_array_length(r->'version'->'tax_breakdown')=1
    and (r->'version'->'tax_breakdown'->0->>'total')::numeric=630,'rounded fixture tax breakdown');
  rv:=(r->'version'->>'row_version')::bigint;
  perform pg_temp.check_true((select count(*)=4 from public.quote_items where quote_version_id=va),'four items');
  perform pg_temp.check_true((select total=630 from public.quotes where id=qa),'draft totals projection');
  perform pg_temp.check_true(not exists(select 1 from public.quote_items where quote_version_id=vb),'cross-tenant SELECT items');
  perform pg_temp.check_true(public.save_quote_draft_v1(qa,va,0,h,items)->>'error'='conflict','stale save');
  perform pg_temp.check_true(public.prepare_quote_version_v1(qa,va,0)->>'error'='conflict','stale prepare');
  perform pg_temp.check_true(public.create_quote_version_v1(qa)->>'error'='draft_exists','one draft RPC');
  perform pg_temp.expect_error('select public.backfill_quote_commercial_v1()','42501');
  -- Role x feature matrix, including actual SELECT and all mutation RPCs.
  execute 'reset role';
  foreach role_name in array array['owner','admin','manager','staff','viewer'] loop
    update public.memberships set role=role_name where tenant_id=ta and user_id=actor;
    foreach enabled in array array[true,false] loop
      perform set_config('request.jwt.claim.role','',true);
      perform public.set_tenant_feature('phase40a','quotes',enabled,null);
      perform set_config('request.jwt.claim.role','authenticated',true);
      execute 'set local role authenticated';
      select count(*) into cnt from public.quote_versions where id=va;
      perform pg_temp.check_true(cnt=case when enabled and role_name<>'viewer' then 1 else 0 end,'matrix version SELECT '||role_name||enabled);
      select count(*) into cnt from public.quote_items where quote_version_id=va;
      perform pg_temp.check_true(cnt=case when enabled and role_name<>'viewer' then 4 else 0 end,'matrix item SELECT '||role_name||enabled);
      r:=public.ensure_quote_draft_v1(qa);
      if enabled and role_name<>'viewer' then
        perform pg_temp.check_true(r->>'ok'='true','matrix ensure');
        r:=public.save_quote_draft_v1(qa,va,rv,h,items);
        perform pg_temp.check_true(r->>'ok'='true','matrix save');
        rv:=(r->'version'->>'row_version')::bigint;
        insert into public.quotes(tenant_id,status_id,description) values(ta,draft_a,'Role lifecycle') returning id into role_quote;
        r:=public.ensure_quote_draft_v1(role_quote); role_version:=(r->'version'->>'id')::uuid;
        r:=public.save_quote_draft_v1(role_quote,role_version,0,'{"description":"Role lifecycle"}',
          '[{"concept":"Role line","quantity":1,"unit_price":10}]');
        r:=public.prepare_quote_version_v1(role_quote,role_version,(r->'version'->>'row_version')::bigint);
        perform pg_temp.check_true(r->>'ok'='true','matrix prepare '||role_name);
        r:=public.create_quote_version_v1(role_quote);
        perform pg_temp.check_true(r->>'ok'='true','matrix clone '||role_name);
        role_version:=(r->'version'->>'id')::uuid;
      else
        perform pg_temp.check_true(r->>'error'='not_found','matrix denied ensure');
        perform pg_temp.check_true(public.save_quote_draft_v1(qa,va,rv,h,items)->>'error'='not_found','matrix denied save');
        perform pg_temp.check_true(public.prepare_quote_version_v1(qa,va,rv)->>'error'='not_found','matrix denied prepare');
        perform pg_temp.check_true(public.create_quote_version_v1(qa)->>'error'='not_found','matrix denied clone');
      end if;
      execute 'reset role';
    end loop;
  end loop;
  update public.memberships set role='owner' where tenant_id=ta and user_id=actor;
  perform set_config('request.jwt.claim.role','',true);
  perform public.set_tenant_feature('phase40a','quotes',true,null);
  perform set_config('request.jwt.claim.role','authenticated',true);
  -- Revoked membership and anonymous sessions cannot reach commercial state.
  update public.memberships set active=false where tenant_id=ta and user_id=actor;
  execute 'set local role authenticated';
  perform pg_temp.check_true(public.ensure_quote_draft_v1(qa)->>'error'='not_found','inactive membership');
  perform pg_temp.check_true(not exists(select 1 from public.quote_versions where id=va),'inactive RLS');
  execute 'reset role';
  update public.memberships set active=true where tenant_id=ta and user_id=actor;
  execute 'set local role anon';
  perform pg_temp.expect_error(format('select public.ensure_quote_draft_v1(%L)',qa),'42501');
  execute 'reset role';
  -- Future PDF identity is constrained by tenant AND quote.
  perform set_config('request.jwt.claim.sub','',true);
  insert into public.quote_files(tenant_id,quote_id,original_name,size_bytes,storage_key,status,upload_expires_at)
    values(ta,qa,'a.pdf',100,'phase40/a','pending',now()+interval '1 hour') returning id into file_a;
  insert into public.quote_files(tenant_id,quote_id,original_name,size_bytes,storage_key,status,upload_expires_at)
    values(tb,qb,'b.pdf',100,'phase40/b','pending',now()+interval '1 hour') returning id into file_b;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform pg_temp.expect_error(format('update public.quote_versions set pdf_file_id=%L where id=%L',file_b,va),'23503');
  update public.quote_versions set pdf_file_id=file_a where id=va returning row_version into rv;
  perform pg_temp.expect_error(format('update public.quote_versions set pdf_file_id=%L where id=%L',file_a,role_version),'23503');
  perform pg_temp.expect_error(format('update public.quotes set current_version_id=%L where id=%L',va,role_quote),'23503');
  -- Constraints reject cross-tenant/same-tenant-other-quote relationships even as database owner.
  perform pg_temp.expect_error(format('insert into public.quote_versions(tenant_id,quote_id,version_number,state,locked_at) values(%L,%L,2,''prepared'',now())',ta,qb),'23503');
  perform pg_temp.expect_error(format('insert into public.quote_versions(tenant_id,quote_id,version_number) values(%L,%L,2)',ta,qa),'23505');
  perform pg_temp.expect_error(format('insert into public.quote_versions(tenant_id,quote_id,version_number,state,locked_at) values(%L,%L,1,''sent'',now())',ta,qa),'23505');
  perform pg_temp.expect_error(format('insert into public.quote_items(tenant_id,quote_version_id,position,concept,quantity,unit_price) values(%L,%L,1,''Cross'',1,1)',ta,vb),'23503');
  perform pg_temp.expect_error(format('update public.quotes set current_version_id=%L where id=%L',vb,qa),'23503');
  perform pg_temp.expect_error(format('update public.quotes set accepted_version_id=%L where id=%L',va,qa),'23514');
  select last_number into old_counter from public.quote_number_counters where tenant_id=ta;
  execute 'set local role authenticated';
  r:=public.prepare_quote_version_v1(qa,va,rv);
  perform pg_temp.check_true(r->>'ok'='true' and r->'version'->>'state'='prepared','prepare');
  perform pg_temp.check_true((select status_id=draft_a and sent_at is null from public.quotes where id=qa),'prepared does not send quote');
  perform pg_temp.check_true(r->'version'->'client_snapshot'->>'billing_name'='ANFRE' and
    r->'version'->'seller_snapshot'->>'business_name'='Seller A','commercial snapshots');
  perform pg_temp.check_true(public.save_quote_draft_v1(qa,va,rv,h,items)->>'error'='immutable_version','locked RPC');
  perform pg_temp.check_true(public.ensure_quote_draft_v1(qa)->>'error'='new_version_required','locked history cannot reopen');
  r:=public.create_quote_version_v1(qa); v2:=(r->'version'->>'id')::uuid; rv:=(r->'version'->>'row_version')::bigint;
  perform pg_temp.check_true(r->>'ok'='true' and (r->'version'->>'version_number')::int=2 and
    (r->'version'->>'total')::numeric=630 and r->'version'->>'state'='draft','clone commercial history');
  perform pg_temp.check_true((select state='prepared' and total=630 from public.quote_versions where id=va),'clone preserves history');
  -- Two independently rounded half-cent lines must sum to .06, not .05.
  r:=public.save_quote_draft_v1(qa,v2,rv,h||'{"prices_include_tax":false}',
    '[{"concept":"A","quantity":1,"unit_price":0.025},{"concept":"B","quantity":1,"unit_price":0.025}]');
  perform pg_temp.check_true((r->'version'->>'total')::numeric=0.06,'document sums rounded lines');
  rv:=(r->'version'->>'row_version')::bigint;
  r:=public.save_quote_draft_v1(qa,v2,rv,h||'{"prices_include_tax":false}',
    '[{"concept":"Discount","quantity":2,"unit_price":100,"discount_percent":10,"tax_rate":21,"subtotal":1,"tax_amount":1,"total":1}]');
  perform pg_temp.check_true((r->'version'->>'subtotal')::numeric=180 and (r->'version'->>'tax_total')::numeric=37.80
    and (r->'version'->>'total')::numeric=217.80,'server discount/excluded calculation');
  rv:=(r->'version'->>'row_version')::bigint;
  r:=public.save_quote_draft_v1(qa,v2,rv,h,
    '[{"concept":"Discount","quantity":2,"unit_price":121,"discount_percent":10,"tax_rate":21}]');
  perform pg_temp.check_true((r->'version'->>'subtotal')::numeric=180 and (r->'version'->>'tax_total')::numeric=37.80
    and (r->'version'->>'total')::numeric=217.80,'server discount/included calculation');
  rv:=(r->'version'->>'row_version')::bigint;
  perform pg_temp.expect_error(format('select public.save_quote_draft_v1(%L,%L,%s,%L,%L)',qa,v2,rv,h,
    '[{"concept":"Invalid","quantity":0,"unit_price":1}]'),'23514');
  perform pg_temp.check_true((select total=217.80 and row_version=rv from public.quote_versions where id=v2),'failed save is atomic');
  execute 'reset role';
  perform pg_temp.expect_error(format('update public.quote_versions set title=''mutated'' where id=%L',va),'55000');
  perform pg_temp.expect_error(format('delete from public.quote_versions where id=%L',va),'55000');
  perform pg_temp.expect_error(format('update public.quote_items set quantity=3 where quote_version_id=%L',va),'55000');
  perform pg_temp.expect_error(format('delete from public.quote_items where quote_version_id=%L',va),'55000');
  perform pg_temp.expect_error(format('insert into public.quote_items(tenant_id,quote_version_id,position,concept,quantity,unit_price) values(%L,%L,5,''late'',1,1)',ta,va),'55000');
  perform pg_temp.expect_error(format('update public.quotes set accepted_version_id=%L where id=%L',va,qa),'23514');
  -- Sent fixture only: future sending action is intentionally outside this implementation.
  execute 'alter table public.quote_versions disable trigger quote_versions_guard';
  update public.quote_versions set state='sent',sent_at=now() where id=va;
  execute 'alter table public.quote_versions enable trigger quote_versions_guard';
  update public.quotes set accepted_version_id=va where id=qa;
  perform pg_temp.expect_error(format('update public.quotes set accepted_version_id=%L where id=%L',va,qb),'23514');
  perform pg_temp.expect_error(format('update public.quote_versions set title=''mutated'' where id=%L',va),'55000');
  perform pg_temp.expect_error(format('delete from public.quote_versions where id=%L',va),'55000');
  perform pg_temp.expect_error(format('update public.quote_items set concept=''mutated'' where quote_version_id=%L',va),'55000');
  perform pg_temp.expect_error(format('delete from public.quote_items where quote_version_id=%L',va),'55000');
  perform pg_temp.expect_error(format('insert into public.quote_items(tenant_id,quote_version_id,position,concept,quantity,unit_price) values(%L,%L,5,''late'',1,1)',ta,va),'55000');
  update public.quotes set total=999 where id=qa;
  perform pg_temp.check_true((select total=217.80 from public.quotes where id=qa),'projection cannot be forged');
  perform pg_temp.check_true((select reference=old_ref from public.quotes where id=qa) and
    (select last_number=old_counter from public.quote_number_counters where tenant_id=ta),'no renumbering by RPCs');

  -- Existing statuses backfill to v1 without invented economic data; replay is idempotent.
  perform set_config('request.jwt.claim.role','',true);
  foreach v_code in array array['draft','pending','sent','accepted','rejected'] loop
    select id into status from public.quote_statuses where tenant_id=ta and quote_statuses.code=v_code;
    if status is null then
      insert into public.quote_statuses(tenant_id,name,code) values(ta,v_code,v_code) returning id into status;
    end if;
    insert into public.quotes(tenant_id,status_id,description) values(ta,status,'Legacy '||v_code) returning id,reference into legacy,old_ref;
    select last_number into old_counter from public.quote_number_counters where tenant_id=ta;
    perform public.backfill_quote_commercial_v1();
    select id into legacy_v from public.quote_versions where quote_id=legacy;
    perform pg_temp.check_true((select version_number=1 and total=0 and tax_total=0 and subtotal=0 and
      state=case when v_code in ('draft','pending') then 'draft' else 'sent' end from public.quote_versions where id=legacy_v),'backfill '||v_code);
    perform pg_temp.check_true(not exists(select 1 from public.quote_items where quote_version_id=legacy_v),'backfill no invented lines');
    perform pg_temp.check_true((select reference=old_ref and status_id=status from public.quotes where id=legacy) and
      (select last_number=old_counter from public.quote_number_counters where tenant_id=ta),'backfill no renumbering');
    if v_code='accepted' then
      perform pg_temp.check_true((select accepted_version_id=legacy_v from public.quotes where id=legacy),'accepted backfill link');
    end if;
    perform public.backfill_quote_commercial_v1();
    perform pg_temp.check_true((select count(*)=1 from public.quote_versions where quote_id=legacy),'idempotent backfill');
    if v_code='sent' then
      perform set_config('request.jwt.claim.role','authenticated',true);
      execute 'set local role authenticated';
      r:=public.create_quote_version_v1(legacy);
      perform pg_temp.check_true(r->>'ok'='true' and r->'version'->>'state'='draft' and
        (r->'version'->>'version_number')::int=2,'clone sent historical version');
      execute 'reset role';
      perform set_config('request.jwt.claim.role','',true);
    end if;
  end loop;
  perform pg_temp.check_true((select reference=order_ref from public.orders where id=order_id) and
    (select last_number=order_counter from public.order_number_counters where tenant_id=ta),'orders not renumbered');
  raise notice 'phase40 commercial SQL PASS';
end;
$test$;
rollback;
