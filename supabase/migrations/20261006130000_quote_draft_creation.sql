begin;
-- Private receipts preserve the original operation after later edits/transitions.
-- No new direct write grants on quotes, and no service-role path.
create table public.quote_draft_creations (
  creation_id uuid primary key,
  tenant_id uuid not null,
  actor_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,creation_id) references public.quotes(tenant_id,id) on delete cascade
);
alter table public.quote_draft_creations enable row level security;
revoke all on public.quote_draft_creations from public,anon,authenticated,service_role;

create function public.create_quote_draft_v1(
  p_tenant_id uuid,p_creation_id uuid,p_client_id uuid,p_service_id uuid,p_assignee_id uuid,
  p_header jsonb,p_items jsonb,p_prepare boolean default false
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); receipt public.quote_draft_creations%rowtype;
  request_body jsonb; r jsonb; v public.quote_versions%rowtype; draft_id uuid;
begin
  if actor is null or not public.has_tenant_role(p_tenant_id,array['owner','admin','manager','staff'])
    or not public.tenant_has_feature(p_tenant_id,'quotes')
    or not exists(select 1 from public.tenants where id=p_tenant_id and active) then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;
  if p_creation_id is null or p_prepare is null or p_header is null or jsonb_typeof(p_header)<>'object'
    or p_items is null or jsonb_typeof(p_items)<>'array' then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  request_body:=jsonb_build_object('client_id',p_client_id,'service_id',p_service_id,'assignee_id',p_assignee_id,
    'header',p_header,'items',p_items,'prepare',p_prepare);
  -- Serializes missing-row creation, including requests served by different HTTP workers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creation_id::text,0));
  select * into receipt from public.quote_draft_creations where creation_id=p_creation_id;
  if found then
    if receipt.tenant_id<>p_tenant_id or receipt.actor_id<>actor or receipt.request<>request_body then
      return jsonb_build_object('ok',false,'error','creation_conflict');
    end if;
    return receipt.result;
  end if;
  if exists(select 1 from public.quotes where id=p_creation_id) then
    return jsonb_build_object('ok',false,'error','creation_conflict');
  end if;
  if (p_client_id is not null and not exists(select 1 from public.clients where tenant_id=p_tenant_id and id=p_client_id))
    or (p_service_id is not null and not exists(select 1 from public.services where tenant_id=p_tenant_id and id=p_service_id))
    or (p_assignee_id is not null and not exists(select 1 from public.team_members where tenant_id=p_tenant_id and id=p_assignee_id)) then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  if jsonb_array_length(p_items)>500 or nullif(btrim(p_header->>'description'),'') is null
    or (p_header->>'currency') is null or (p_header->>'currency')!~'^[A-Z]{3}$'
    or (p_header->>'issue_date') is null or (p_header->>'issue_date')!~'^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(p_header->'prices_include_tax') is distinct from 'boolean' then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  if p_prepare and jsonb_array_length(p_items)=0 then
    return jsonb_build_object('ok',false,'error','items_required');
  end if;
  select id into draft_id from public.quote_statuses where tenant_id=p_tenant_id and code='draft' and active;
  if draft_id is null then raise exception 'Missing draft status' using errcode='23514'; end if;
  insert into public.quotes(id,tenant_id,status_id,client_id,service_id,assigned_team_member_id,title,description,notes,valid_until)
  values(p_creation_id,p_tenant_id,draft_id,p_client_id,p_service_id,p_assignee_id,p_header->>'title',
    p_header->>'description',p_header->>'terms',(p_header->>'valid_until')::date);
  r:=public.ensure_quote_draft_v1(p_creation_id);
  if r->>'ok' is distinct from 'true' then raise exception 'Draft creation failed' using errcode='23514'; end if;
  select * into v from public.quote_versions where id=(r->'version'->>'id')::uuid;
  r:=public.save_quote_draft_v1(p_creation_id,v.id,v.row_version,p_header,p_items);
  if r->>'ok' is distinct from 'true' then raise exception 'Draft save failed' using errcode='23514'; end if;
  if p_prepare then
    r:=public.prepare_quote_version_v1(p_creation_id,v.id,(r->'version'->>'row_version')::bigint);
    if r->>'ok' is distinct from 'true' then raise exception 'Preparation failed' using errcode='23514'; end if;
  end if;
  -- A stable creation acknowledgement, never a replacement for GET of current detail.
  r:=jsonb_build_object('ok',true,'quote_id',p_creation_id,'version',r->'version');
  insert into public.quote_draft_creations(creation_id,tenant_id,actor_id,request,result)
    values(p_creation_id,p_tenant_id,actor,request_body,r);
  return r;
end;
$$;
revoke all on function public.create_quote_draft_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.create_quote_draft_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
