-- Test-only legacy accepted record fixture. Never applied as a migration.
-- Owns no cloud files. Exercise controlled production send/accept separately in phase42/43.
create function pg_temp.accepted_quote_fixture(p_quote uuid) returns void
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v uuid; previous_action text:=current_setting('app.quote_transition',true);
begin
 select * into q from public.quotes where id=p_quote;
 if q.accepted_version_id is not null then return; end if;
 insert into public.quote_versions(tenant_id,quote_id,version_number,state,title,description,terms,locked_at,sent_at,created_by)
 values(q.tenant_id,q.id,coalesce((select max(version_number)+1 from public.quote_versions where quote_id=q.id),1),'sent',q.title,q.description,q.notes,now(),now(),auth.uid()) returning id into v;
 perform set_config('app.quote_transition','accept',true);
 update public.quotes set current_version_id=v,accepted_version_id=v,status_id=(select id from public.quote_statuses where tenant_id=q.tenant_id and code='accepted') where id=q.id;
 perform set_config('app.quote_transition',coalesce(previous_action,''),true);
end $$;
