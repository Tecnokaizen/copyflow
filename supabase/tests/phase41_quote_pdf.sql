-- Local only; fixtures, secret and mutations roll back.
begin;
create function pg_temp.assert_pdf(p boolean,label text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'phase41: %',label; end if; end $$;
create function pg_temp.pdf_error(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlstate=expected then return; end if;
    raise exception 'phase41 expected %, got %: %',expected,sqlstate,sqlerrm; end;
  raise exception 'phase41 unexpectedly succeeded: %',statement;
end $$;
create function pg_temp.pdf_sig(purpose text,actor uuid,tenant uuid,quote uuid,file uuid,issued bigint) returns text
language sql as $$ select encode(extensions.hmac(convert_to('files-v1-quote|'||purpose||'|'||actor||'|'||tenant||'|'||quote||'|'||file||'|'||issued,'UTF8'),
  convert_to('phase41-pdf-files-secret-32-characters','UTF8'),'sha256'),'hex') $$;
do $$
declare
 a uuid:='e4100000-0000-4000-8000-000000000001'; b uuid:='e4100000-0000-4000-8000-000000000002';
 ta uuid:='e4100000-0000-4000-8000-000000000011'; tb uuid:='e4100000-0000-4000-8000-000000000012';
 q uuid; qb uuid; v uuid; vb uuid; v2 uuid; draft uuid; expired uuid:=gen_random_uuid(); file uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
 plan uuid:=gen_random_uuid();
 r jsonb; r2 jsonb; issued bigint:=extract(epoch from now())::bigint; sig text; oldversion jsonb; oldq bigint; n int;
begin
 if exists(select 1 from vault.secrets where name='files_signing_secret') then
  perform vault.update_secret((select id from vault.secrets where name='files_signing_secret' limit 1),'phase41-pdf-files-secret-32-characters');
 else perform vault.create_secret('phase41-pdf-files-secret-32-characters','files_signing_secret'); end if;
 insert into auth.users(id,email,raw_user_meta_data) values(a,'a@phase41.test','{}'),(b,'b@phase41.test','{}');
 insert into public.profiles(id,full_name) values(a,'A'),(b,'B');
 insert into public.tenants(id,name,slug,active) values(ta,'PDF A','phase41a',true),(tb,'PDF B','phase41b',true);
 insert into public.memberships(tenant_id,user_id,role,active) values(ta,a,'owner',true),(tb,b,'owner',true);
 insert into public.tenant_settings(tenant_id,business_name,preferences) values
   (ta,'Seller A','{"quote_document":{"tax_id":"TEST-TAX","billing_address":"Frozen address"}}'),(tb,'Seller B','{}');
 perform public.set_tenant_feature('phase41a','quotes',true,null); perform public.set_tenant_feature('phase41b','quotes',true,null);
 perform public.seed_quote_statuses(ta);perform public.seed_quote_statuses(tb);
 perform set_config('request.jwt.claim.role','authenticated',true);perform set_config('request.jwt.claim.sub',b::text,true);
 insert into public.quotes(tenant_id,status_id,description) select tb,id,'B' from public.quote_statuses where tenant_id=tb and code='draft' returning id into qb;
 r:=public.ensure_quote_draft_v1(qb);vb:=(r->'version'->>'id')::uuid;
 perform set_config('request.jwt.claim.sub',a::text,true);
 insert into public.quotes(tenant_id,status_id,description) select ta,id,'A' from public.quote_statuses where tenant_id=ta and code='draft' returning id into q;
 r:=public.ensure_quote_draft_v1(q);v:=(r->'version'->>'id')::uuid;
 sig:=pg_temp.pdf_sig('create',a,ta,q,file,issued);
 set local role authenticated;
 perform pg_temp.pdf_error(format('select public.reserve_quote_pdf_v1(%L,%L,%L,100,%s,%L)',q,v,file,issued,sig),'55000');
 perform pg_temp.pdf_error(format('select public.reserve_quote_pdf_v1(%L,%L,%L,100,%s,%L)',qb,vb,file,issued,sig),'P0002');
 r:=public.save_quote_draft_v1(q,v,0,'{"title":"Commercial"}','[{"concept":"Item","quantity":1,"unit_price":100,"tax_rate":21}]');
 r:=public.prepare_quote_version_v1(q,v,(r->'version'->>'row_version')::bigint);
 perform pg_temp.assert_pdf(r->>'ok'='true','prepared');
 select to_jsonb(x) into oldversion from public.quote_versions x where id=v;
 select row_version into oldq from public.quotes where id=q;
 perform pg_temp.assert_pdf(oldversion->'seller_snapshot'->>'tax_id'='TEST-TAX','fiscal snapshot frozen');
 r:=public.quote_pdf_source_v1(ta,q,v);
 perform pg_temp.assert_pdf(jsonb_typeof(r->'version'->'total')='string' and r->'version'->>'total'='121.00','exact totals as text');
 perform pg_temp.assert_pdf(jsonb_typeof(r->'version'->'tax_breakdown'->0->'tax_amount')='string','exact tax breakdown as text');
 perform pg_temp.assert_pdf(jsonb_typeof(r->'items'->0->'unit_price')='string','exact item price as text');
 perform pg_temp.assert_pdf(public.quote_pdf_source_v1(tb,q,v) is null,'source host tenant mismatch');
 reset role;
 insert into public.plans(id,code,name,active,sort_order,price_monthly,price_yearly) values(plan,'phase41','PDF quota',true,99,0,0);
 insert into public.plan_features(plan_id,feature_id,enabled,limit_value) select plan,id,true,99 from public.features where code='storage_bytes';
 insert into public.subscriptions(tenant_id,plan_id,status,current_period_start,current_period_end) values(ta,plan,'active',now(),now()+interval '30 days');
 set local role authenticated;
 perform pg_temp.pdf_error(format('select public.reserve_quote_pdf_v1(%L,%L,%L,100,%s,%L)',q,v,file,issued,sig),'P0001');
 perform pg_temp.assert_pdf(not exists(select 1 from public.quote_files where quote_id=q),'quota failure reserves nothing');
 perform pg_temp.assert_pdf((select pdf_file_id is null from public.quote_versions where id=v),'quota failure links nothing');
 reset role;update public.plan_features set limit_value=100 where plan_id=plan;
 set local role authenticated;
 r:=public.reserve_quote_pdf_v1(q,v,file,100,issued,sig);
 r2:=public.reserve_quote_pdf_v1(q,v,other,100,issued,pg_temp.pdf_sig('create',a,ta,q,other,issued));
 perform pg_temp.assert_pdf(r->'file'->>'id'=r2->'file'->>'id','retry one reservation');
 perform pg_temp.assert_pdf((select count(*)=1 from public.quote_files where quote_id=q),'one file');
 reset role;
 perform pg_temp.assert_pdf((public.tenant_storage_usage(ta)->>'reserved_bytes')::bigint=100,'shared quota pending');
 set local role authenticated;
 perform pg_temp.assert_pdf((select pdf_file_id is null from public.quote_versions where id=v),'pending not linked');
 perform pg_temp.pdf_error(format('select public.reserve_quote_pdf_v1(%L,%L,%L,100,%s,%L)',q,v,other,issued,'bad'),'42501');
 sig:=pg_temp.pdf_sig('complete',a,ta,q,file,issued);
 perform pg_temp.pdf_error(format('select public.complete_quote_file_upload(%L,%L,%L,%s,%L)',q,file,'etag',issued,sig),'55000');
 perform pg_temp.pdf_error(format('select public.finish_quote_pdf_v1(%L,%L,%L,%L,%s,%L)',q,v,other,'etag',issued,pg_temp.pdf_sig('complete',a,ta,q,other,issued)),'P0002');
 r:=public.finish_quote_pdf_v1(q,v,file,'etag',issued,sig);
 perform pg_temp.assert_pdf(r->>'replayed'='false' and r->'file'->>'status'='ready','atomic finish');
 perform pg_temp.assert_pdf((select pdf_file_id=file from public.quote_versions where id=v),'PDF linked');
 perform pg_temp.assert_pdf((select (to_jsonb(x)-'pdf_file_id')=(oldversion-'pdf_file_id') from public.quote_versions x where id=v),'all immutable version fields preserved');
 perform pg_temp.assert_pdf((select row_version=oldq from public.quotes where id=q),'operational row_version preserved');
 r:=public.finish_quote_pdf_v1(q,v,file,'etag',issued,sig);
 perform pg_temp.assert_pdf(r->>'replayed'='true','finish replay');
 select count(*) into n from public.activity_log where entity_id=q and action='quote.pdf_generated';
 perform pg_temp.assert_pdf(n=1,'single PDF activity');
 perform pg_temp.pdf_error(format('select public.soft_delete_quote_file(%L,%L,%s,%L)',q,file,issued,pg_temp.pdf_sig('delete',a,ta,q,file,issued)),'55000');
 reset role;
 perform pg_temp.assert_pdf((public.tenant_storage_usage(ta)->>'ready_bytes')::bigint=100,'shared quota ready');
 perform pg_temp.pdf_error(format('update public.quote_versions set pdf_file_id=%L where id=%L',other,v),'23514');
 perform pg_temp.pdf_error(format('update public.quote_files set content_type=''image/png'' where id=%L',file),'55000');
 perform pg_temp.pdf_error(format('delete from public.quote_files where id=%L',file),'55000');
 update public.memberships set role='viewer' where tenant_id=ta and user_id=a;
 set local role authenticated;
 perform pg_temp.assert_pdf(not exists(select 1 from public.quote_files where id=file),'viewer cannot download/select');
 perform pg_temp.pdf_error(format('select public.reserve_quote_pdf_v1(%L,%L,%L,100,%s,%L)',q,v,other,issued,pg_temp.pdf_sig('create',a,ta,q,other,issued)),'P0002');
 reset role;update public.memberships set role='owner' where tenant_id=ta and user_id=a;
 perform public.set_tenant_feature('phase41a','quotes',false,null);
 set local role authenticated;
 perform pg_temp.assert_pdf(not exists(select 1 from public.quote_versions where id=v),'feature-off cannot select');
 perform pg_temp.pdf_error(format('select public.finish_quote_pdf_v1(%L,%L,%L,%L,%s,%L)',q,v,file,'etag',issued,sig),'P0002');
 reset role;perform public.set_tenant_feature('phase41a','quotes',true,null);
 perform set_config('request.jwt.claim.sub',b::text,true);
 set local role authenticated;
 perform pg_temp.assert_pdf(not exists(select 1 from public.quote_files where id=file),'tenant B cannot download A');
 perform pg_temp.pdf_error(format('select public.finish_quote_pdf_v1(%L,%L,%L,%L,%s,%L)',qb,v,file,'etag',issued,sig),'P0002');
 reset role;
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 r:=public.create_quote_version_v1(q);v2:=(r->'version'->>'id')::uuid;
 r:=public.prepare_quote_version_v1(q,v2,(select row_version from public.quote_versions where id=v2));
 perform pg_temp.assert_pdf(r->>'ok'='true','second prepared version');
 reset role;
 update public.plan_features set limit_value=200 where plan_id=plan;
 perform set_config('request.jwt.claim.sub','',true);
 insert into public.quote_files(id,tenant_id,quote_id,pdf_version_id,original_name,content_type,size_bytes,storage_key,status,uploaded_by,upload_expires_at)
 values(expired,ta,q,v2,'expired.pdf','application/pdf',100,'quotes/'||ta||'/'||q||'/'||expired,'pending',a,now()-interval '1 minute');
 perform pg_temp.assert_pdf(public.purge_expired_quote_file(expired),'existing cleanup purges expired PDF reservation');
 perform pg_temp.assert_pdf((select pdf_file_id is null from public.quote_versions where id=v2),'cleanup never leaves linked incomplete file');
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 r:=public.reserve_quote_pdf_v1(q,v2,expired,100,issued,pg_temp.pdf_sig('create',a,ta,q,expired,issued));
 perform pg_temp.assert_pdf(r->'file'->>'id'=expired::text,'retry after cleanup may reserve again');
 reset role;
 perform set_config('request.jwt.claim.sub','',true);
 insert into public.quote_files(id,tenant_id,quote_id,original_name,content_type,size_bytes,storage_key,status,uploaded_by,upload_expires_at)
 values(other,ta,q,'ordinary-expired.pdf','application/pdf',100,'quotes/'||ta||'/'||q||'/'||other,'pending',a,now()-interval '1 minute');
 perform pg_temp.assert_pdf(public.purge_expired_quote_file(other),'ordinary attachments still purge');
 perform pg_temp.assert_pdf(not exists(select 1 from public.quote_files where id=other),'PDF guard must not cancel ordinary DELETE');
 raise notice 'phase41 PASS: auth, frozen snapshots, quota, idempotency, integrity, protected delete, activity';
end $$;
rollback;
