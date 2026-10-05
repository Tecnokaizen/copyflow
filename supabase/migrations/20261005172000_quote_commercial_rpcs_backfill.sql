begin;
-- A private helper filters authorization BEFORE taking the aggregate lock.
-- Every commercial RPC locks quote -> version, serializing numbering and writes.
create function public.quote_commercial_lock_v1(p_quote_id uuid) returns public.quotes
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype;
begin
  select * into q from public.quotes where id=p_quote_id and auth.uid() is not null
    and public.has_tenant_role(tenant_id,array['owner','admin','manager','staff'])
    and public.tenant_has_feature(tenant_id,'quotes') for update;
  return q;
end;
$$;

create function public.quote_client_snapshot_v1(p_quote_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('client_id',q.client_id,'name',c.name,
    'contact_name',coalesce(q.contact_name,c.contact_name),'contact_email',coalesce(q.contact_email,c.email),
    'contact_phone',coalesce(q.contact_phone,c.phone),'billing_name',coalesce(q.billing_name,c.company_name,c.name),
    'tax_id',coalesce(q.tax_id,c.tax_id),'billing_address',q.billing_address)
  from public.quotes q left join public.clients c on c.tenant_id=q.tenant_id and c.id=q.client_id
  where q.id=p_quote_id;
$$;
create function public.quote_seller_snapshot_v1(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tenant_id',t.id,'business_name',coalesce(s.business_name,t.name),
    'logo_url',s.logo_url,'branding',coalesce(s.branding,'{}'::jsonb))
  from public.tenants t left join public.tenant_settings s on s.tenant_id=t.id where t.id=p_tenant_id;
$$;

create function public.ensure_quote_draft_v1(p_quote_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v public.quote_versions%rowtype;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  select * into v from public.quote_versions where quote_id=q.id and state='draft';
  if found then return jsonb_build_object('ok',true,'created',false,'version',to_jsonb(v)); end if;
  if exists(select 1 from public.quote_versions where quote_id=q.id) then
    return jsonb_build_object('ok',false,'error','new_version_required');
  end if;
  insert into public.quote_versions(tenant_id,quote_id,version_number,title,description,terms,
    issue_date,valid_until,currency,prices_include_tax,client_snapshot,created_by)
  values(q.tenant_id,q.id,1,q.title,q.description,q.notes,q.issue_date,q.valid_until,q.currency,
    q.prices_include_tax,public.quote_client_snapshot_v1(q.id),auth.uid()) returning * into v;
  update public.quotes set current_version_id=v.id where id=q.id;
  return jsonb_build_object('ok',true,'created',true,'version',to_jsonb(v));
end;
$$;

create function public.save_quote_draft_v1(
  p_quote_id uuid,p_version_id uuid,p_expected_row_version bigint,p_header jsonb,p_items jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v public.quote_versions%rowtype;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  select * into v from public.quote_versions where id=p_version_id and quote_id=q.id and tenant_id=q.tenant_id for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if v.state <> 'draft' then return jsonb_build_object('ok',false,'error','immutable_version'); end if;
  if p_expected_row_version is null or v.row_version <> p_expected_row_version then
    return jsonb_build_object('ok',false,'error','conflict','row_version',v.row_version);
  end if;
  if p_header is null or jsonb_typeof(p_header)<>'object' or p_items is null
    or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>500 then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  -- Header is a full replacement. Money, snapshots, identity and state from clients are ignored.
  delete from public.quote_items where quote_version_id=v.id;
  update public.quotes set
    contact_name=p_header->>'contact_name',contact_email=p_header->>'contact_email',contact_phone=p_header->>'contact_phone',
    billing_name=p_header->>'billing_name',tax_id=p_header->>'tax_id',billing_address=p_header->>'billing_address',
    title=p_header->>'title',description=coalesce(p_header->>'description',v.description),
    notes=p_header->>'terms',valid_until=(p_header->>'valid_until')::date
  where id=q.id;
  update public.quote_versions set
    title=p_header->>'title',description=coalesce(p_header->>'description',v.description),terms=p_header->>'terms',
    issue_date=coalesce((p_header->>'issue_date')::date,v.issue_date),valid_until=(p_header->>'valid_until')::date,
    currency=coalesce(p_header->>'currency',v.currency),
    prices_include_tax=coalesce((p_header->>'prices_include_tax')::boolean,v.prices_include_tax),
    client_snapshot=public.quote_client_snapshot_v1(q.id)
  where id=v.id;
  insert into public.quote_items(tenant_id,quote_version_id,position,concept,description,quantity,unit,unit_price,discount_percent,tax_rate)
  select q.tenant_id,v.id,n::integer,j->>'concept',j->>'description',(j->>'quantity')::numeric,j->>'unit',
    (j->>'unit_price')::numeric,coalesce((j->>'discount_percent')::numeric,0),coalesce((j->>'tax_rate')::numeric,0)
  from jsonb_array_elements(p_items) with ordinality as x(j,n);
  update public.quotes set current_version_id=v.id where id=q.id;
  select * into v from public.quote_versions where id=v.id;
  return jsonb_build_object('ok',true,'version',to_jsonb(v));
end;
$$;

create function public.create_quote_version_v1(p_quote_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; src public.quote_versions%rowtype; v public.quote_versions%rowtype; n integer;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if exists(select 1 from public.quote_versions where quote_id=q.id and state='draft') then
    return jsonb_build_object('ok',false,'error','draft_exists');
  end if;
  select * into src from public.quote_versions where quote_id=q.id and state in ('prepared','sent')
    order by version_number desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','history_required'); end if;
  select max(version_number)+1 into n from public.quote_versions where quote_id=q.id;
  insert into public.quote_versions(tenant_id,quote_id,version_number,title,description,terms,issue_date,valid_until,
    currency,prices_include_tax,seller_snapshot,client_snapshot,created_by)
  values(q.tenant_id,q.id,n,src.title,src.description,src.terms,src.issue_date,src.valid_until,
    src.currency,src.prices_include_tax,src.seller_snapshot,src.client_snapshot,auth.uid()) returning * into v;
  insert into public.quote_items(tenant_id,quote_version_id,position,concept,description,quantity,unit,unit_price,discount_percent,tax_rate)
  select tenant_id,v.id,position,concept,description,quantity,unit,unit_price,discount_percent,tax_rate
  from public.quote_items where quote_version_id=src.id order by position;
  -- Restore the cloned commercial contact header as the editable aggregate projection.
  update public.quotes set current_version_id=v.id,title=v.title,description=v.description,notes=v.terms,valid_until=v.valid_until,
    contact_name=v.client_snapshot->>'contact_name',contact_email=v.client_snapshot->>'contact_email',
    contact_phone=v.client_snapshot->>'contact_phone',billing_name=v.client_snapshot->>'billing_name',
    tax_id=v.client_snapshot->>'tax_id',billing_address=v.client_snapshot->>'billing_address' where id=q.id;
  select * into v from public.quote_versions where id=v.id;
  return jsonb_build_object('ok',true,'version',to_jsonb(v));
end;
$$;

create function public.prepare_quote_version_v1(p_quote_id uuid,p_version_id uuid,p_expected_row_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v public.quote_versions%rowtype;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  select * into v from public.quote_versions where id=p_version_id and tenant_id=q.tenant_id and quote_id=q.id for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if v.state<>'draft' then return jsonb_build_object('ok',false,'error','immutable_version'); end if;
  if p_expected_row_version is null or v.row_version<>p_expected_row_version then
    return jsonb_build_object('ok',false,'error','conflict','row_version',v.row_version);
  end if;
  if not exists(select 1 from public.quote_items where quote_version_id=v.id) then
    return jsonb_build_object('ok',false,'error','items_required');
  end if;
  -- Recompute all lines on the server before locking the authoritative snapshot.
  update public.quote_items set unit_price=unit_price where quote_version_id=v.id;
  update public.quote_versions set state='prepared',seller_snapshot=public.quote_seller_snapshot_v1(q.tenant_id),
    client_snapshot=public.quote_client_snapshot_v1(q.id) where id=v.id returning * into v;
  update public.quotes set current_version_id=v.id where id=q.id;
  -- Deliberately no quote.status_id or sent_at change.
  return jsonb_build_object('ok',true,'version',to_jsonb(v));
end;
$$;

-- Private, idempotent operator helper: called only by this migration and SQL tests.
-- Legacy economic data does not exist: no invented lines, amounts or send timestamps.
create function public.backfill_quote_commercial_v1() returns void
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v uuid; code text; historical boolean;
begin
  for q in select * from public.quotes order by id for update loop
    if exists(select 1 from public.quote_versions where quote_id=q.id) then continue; end if;
    select s.code into code from public.quote_statuses s where s.id=q.status_id and s.tenant_id=q.tenant_id;
    historical:=code not in ('draft','pending');
    insert into public.quote_versions(tenant_id,quote_id,version_number,state,title,description,terms,issue_date,valid_until,
      currency,prices_include_tax,seller_snapshot,client_snapshot,created_by,created_at,locked_at,sent_at)
    values(q.tenant_id,q.id,1,case when historical then
      case when code in ('sent','accepted','rejected') then 'sent' else 'prepared' end else 'draft' end,
      q.title,q.description,q.notes,q.issue_date,q.valid_until,q.currency,q.prices_include_tax,
      public.quote_seller_snapshot_v1(q.tenant_id),public.quote_client_snapshot_v1(q.id),q.created_by,q.created_at,
      case when historical then q.created_at end,q.sent_at) returning id into v;
    update public.quotes set current_version_id=v,
      accepted_version_id=case when code='accepted' then v else null end where id=q.id;
  end loop;
end;
$$;

revoke all on function public.quote_commercial_lock_v1(uuid),public.quote_client_snapshot_v1(uuid),
  public.quote_seller_snapshot_v1(uuid),public.backfill_quote_commercial_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.ensure_quote_draft_v1(uuid),public.save_quote_draft_v1(uuid,uuid,bigint,jsonb,jsonb),
  public.create_quote_version_v1(uuid),public.prepare_quote_version_v1(uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.ensure_quote_draft_v1(uuid),public.save_quote_draft_v1(uuid,uuid,bigint,jsonb,jsonb),
  public.create_quote_version_v1(uuid),public.prepare_quote_version_v1(uuid,uuid,bigint) to authenticated;
select public.backfill_quote_commercial_v1();
commit;
