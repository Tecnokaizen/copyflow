begin;
-- Private receipts preserve the original operation after later edits/transitions.
-- No new direct write grants on quotes, and no service-role path.
create table public.quote_draft_creations (
  creation_id uuid primary key,
  tenant_id uuid not null,
  actor_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,creation_id) references public.quotes(tenant_id,id) on delete cascade
);
create index quote_draft_creations_pending on public.quote_draft_creations(tenant_id,actor_id,created_at desc) where acknowledged_at is null;
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

-- Recovery returns only a small acknowledgement, never the original request/result.
-- Exact lookup works after ACK and beyond the recent-list window, for URL recovery.
create function public.recover_quote_draft_creations_v1(p_tenant_id uuid,p_creation_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); receipts jsonb;
begin
  if actor is null or not public.has_tenant_role(p_tenant_id,array['owner','admin','manager','staff'])
    or not public.tenant_has_feature(p_tenant_id,'quotes')
    or not exists(select 1 from public.tenants where id=p_tenant_id and active) then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('operation_id',r.creation_id,'quote_id',r.creation_id,
    'reference',r.reference,'created_at',r.created_at,'acknowledged_at',r.acknowledged_at) order by r.created_at desc),'[]')
    into receipts from (
      select r.creation_id,q.reference,r.created_at,r.acknowledged_at
      from public.quote_draft_creations r join public.quotes q on q.tenant_id=r.tenant_id and q.id=r.creation_id
      where r.tenant_id=p_tenant_id and r.actor_id=actor
        and ((p_creation_id is not null and r.creation_id=p_creation_id)
          or (p_creation_id is null and r.acknowledged_at is null and r.created_at>=now()-interval '48 hours'))
      order by r.created_at desc
      limit 10
    ) r;
  return jsonb_build_object('ok',true,'receipts',receipts);
end $$;
create function public.ack_quote_draft_creation_v1(p_tenant_id uuid,p_creation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.quote_draft_creations%rowtype;
begin
  if actor is null or not public.has_tenant_role(p_tenant_id,array['owner','admin','manager','staff'])
    or not public.tenant_has_feature(p_tenant_id,'quotes')
    or not exists(select 1 from public.tenants where id=p_tenant_id and active) then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;
  -- Same lock order as creation; idempotent even if ACK arrives during commit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creation_id::text,0));
  select * into r from public.quote_draft_creations
    where creation_id=p_creation_id and tenant_id=p_tenant_id and actor_id=actor for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  update public.quote_draft_creations set acknowledged_at=coalesce(acknowledged_at,now()) where creation_id=r.creation_id
    returning * into r;
  return jsonb_build_object('ok',true,'quote_id',r.creation_id,'acknowledged_at',r.acknowledged_at);
end $$;
revoke all on function public.recover_quote_draft_creations_v1(uuid,uuid),public.ack_quote_draft_creation_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.recover_quote_draft_creations_v1(uuid,uuid),public.ack_quote_draft_creation_v1(uuid,uuid) to authenticated;

-- Optional provenance is separate from commercial contact values; NULL inheritance stays unchanged.
-- NULL metadata marks pre-hotfix drafts, whose populated values are preserved conservatively by the editor.
alter table public.quote_versions add column client_manual_fields text[]
  check (client_manual_fields <@ array['contact_name','contact_email','contact_phone','billing_name','tax_id']::text[]);
alter function public.save_quote_draft_v1(uuid,uuid,bigint,jsonb,jsonb) rename to save_quote_draft_content_v1;
revoke all on function public.save_quote_draft_content_v1(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.save_quote_draft_v1(p_quote_id uuid,p_version_id uuid,p_expected_row_version bigint,p_header jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; fields text[]; v public.quote_versions%rowtype;
begin
  if p_header ? 'client_manual_fields' then
    if jsonb_typeof(p_header->'client_manual_fields') is distinct from 'array' then
      return jsonb_build_object('ok',false,'error','invalid');
    end if;
    select coalesce(array_agg(x),'{}') into fields from jsonb_array_elements_text(p_header->'client_manual_fields') x;
    if not (fields <@ array['contact_name','contact_email','contact_phone','billing_name','tax_id']::text[]) or array_position(fields,null) is not null then
      return jsonb_build_object('ok',false,'error','invalid');
    end if;
  end if;
  r:=public.save_quote_draft_content_v1(p_quote_id,p_version_id,p_expected_row_version,p_header,p_items);
  if r->>'ok' is distinct from 'true' then return r; end if;
  if fields is not null then
    update public.quote_versions set client_manual_fields=fields where id=p_version_id returning * into v;
    r:=jsonb_build_object('ok',true,'version',to_jsonb(v));
  end if;
  return r;
end $$;
revoke all on function public.save_quote_draft_v1(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_quote_draft_v1(uuid,uuid,bigint,jsonb,jsonb) to authenticated;

-- Changing an editable client and its commercial header is one transaction, with both CAS tokens.
create function public.change_quote_draft_client_v1(p_quote_id uuid,p_expected_quote_row_version bigint,
  p_client_id uuid,p_service_id uuid,p_assignee_id uuid,p_version_id uuid,p_expected_version_row_version bigint,p_header jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v public.quote_versions%rowtype; r jsonb;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if q.row_version is distinct from p_expected_quote_row_version then
    return jsonb_build_object('ok',false,'error','conflict','row_version',q.row_version);
  end if;
  select * into v from public.quote_versions where id=p_version_id and quote_id=q.id and tenant_id=q.tenant_id for update;
  if not found or v.id is distinct from q.current_version_id then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if v.state<>'draft' then return jsonb_build_object('ok',false,'error','immutable_version'); end if;
  if v.row_version is distinct from p_expected_version_row_version then
    return jsonb_build_object('ok',false,'error','conflict','row_version',v.row_version);
  end if;
  if (p_client_id is not null and not exists(select 1 from public.clients where tenant_id=q.tenant_id and id=p_client_id))
    or (p_service_id is not null and not exists(select 1 from public.services where tenant_id=q.tenant_id and id=p_service_id))
    or (p_assignee_id is not null and not exists(select 1 from public.team_members where tenant_id=q.tenant_id and id=p_assignee_id)) then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  update public.quotes set client_id=p_client_id,service_id=p_service_id,assigned_team_member_id=p_assignee_id where id=q.id;
  r:=public.save_quote_draft_v1(q.id,v.id,v.row_version,p_header,p_items);
  if r->>'ok' is distinct from 'true' then raise exception 'Draft client save failed' using errcode='23514'; end if;
  return r;
end $$;
revoke all on function public.change_quote_draft_client_v1(uuid,bigint,uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.change_quote_draft_client_v1(uuid,bigint,uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) to authenticated;

-- A real revision retains manual provenance, including overrides equal to the old master.
create or replace function public.create_quote_version_v1(p_quote_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; src public.quote_versions%rowtype; v public.quote_versions%rowtype; n integer;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if q.accepted_version_id is not null or q.converted_order_id is not null or exists(
    select 1 from public.quote_statuses where id=q.status_id and code='accepted') then
    return jsonb_build_object('ok',false,'error','immutable_version');
  end if;
  if exists(select 1 from public.quote_versions where quote_id=q.id and state='draft') then
    return jsonb_build_object('ok',false,'error','draft_exists');
  end if;
  select * into src from public.quote_versions where quote_id=q.id and state in ('prepared','sent')
    order by version_number desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','history_required'); end if;
  select max(version_number)+1 into n from public.quote_versions where quote_id=q.id;
  insert into public.quote_versions(tenant_id,quote_id,version_number,title,description,terms,issue_date,valid_until,
    currency,prices_include_tax,seller_snapshot,client_snapshot,created_by,client_manual_fields)
  values(q.tenant_id,q.id,n,src.title,src.description,src.terms,src.issue_date,src.valid_until,
    src.currency,src.prices_include_tax,src.seller_snapshot,src.client_snapshot,auth.uid(),src.client_manual_fields) returning * into v;
  insert into public.quote_items(tenant_id,quote_version_id,position,concept,description,quantity,unit,unit_price,discount_percent,tax_rate)
  select tenant_id,v.id,position,concept,description,quantity,unit,unit_price,discount_percent,tax_rate
  from public.quote_items where quote_version_id=src.id order by position;
  perform set_config('app.quote_transition','new_version',true);
  -- Restore the cloned commercial contact header as the editable aggregate projection.
  update public.quotes set status_id=(select id from public.quote_statuses where tenant_id=q.tenant_id and code='draft'),
    sent_at=null,rejected_at=null,current_version_id=v.id,title=v.title,description=v.description,notes=v.terms,valid_until=v.valid_until,
    contact_name=v.client_snapshot->>'contact_name',contact_email=v.client_snapshot->>'contact_email',
    contact_phone=v.client_snapshot->>'contact_phone',billing_name=v.client_snapshot->>'billing_name',
    tax_id=v.client_snapshot->>'tax_id',billing_address=v.client_snapshot->>'billing_address' where id=q.id;
  perform set_config('app.quote_transition','',true);
  select * into v from public.quote_versions where id=v.id;
  return jsonb_build_object('ok',true,'version',to_jsonb(v));
end;
$$;
notify pgrst, 'reload schema';
commit;
