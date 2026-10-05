begin;
-- Only controlled RPCs can write status; INSERT is still checked by the trigger.
revoke update(status_id) on public.quotes from authenticated;
create or replace function public.tg_quote_version_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.state='prepared' and new.state='sent'
    and current_setting('app.quote_transition',true)='send'
    and (to_jsonb(new)-array['state','sent_at','row_version'])=(to_jsonb(old)-array['state','sent_at','row_version']) then
    new.row_version:=old.row_version+1;
    return new;
  end if;
  if tg_op='UPDATE' and old.state in ('prepared','sent')
     and current_setting('app.quote_pdf_action',true)='finish'
     and old.pdf_file_id is null and new.pdf_file_id is not null
     and (to_jsonb(new)-'pdf_file_id')=(to_jsonb(old)-'pdf_file_id')
     and exists(select 1 from public.quote_files f where f.id=new.pdf_file_id
       and f.tenant_id=new.tenant_id and f.quote_id=new.quote_id and f.pdf_version_id=new.id
       and f.status='ready' and f.deleted_at is null and f.content_type='application/pdf') then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    if old.state <> 'draft' then raise exception 'immutable_version' using errcode='55000'; end if;
    if tg_op = 'DELETE' then return old; end if;
    if (new.id,new.tenant_id,new.quote_id,new.version_number,new.created_at,new.created_by)
       is distinct from (old.id,old.tenant_id,old.quote_id,old.version_number,old.created_at,old.created_by) then
      raise exception 'immutable_identity' using errcode='55000';
    end if;
    if new.state = 'sent' then raise exception 'explicit_send_required' using errcode='55000'; end if;
    if new.prices_include_tax is distinct from old.prices_include_tax
       and exists(select 1 from public.quote_items where quote_version_id=old.id) then
      raise exception 'replace_items_before_tax_mode' using errcode='55000';
    end if;
    new.row_version := old.row_version+1;
  end if;
  -- Totals are always derived from already rounded server-calculated lines.
  select coalesce(sum(i.subtotal),0),coalesce(sum(i.tax_amount),0),coalesce(sum(i.total),0)
    into new.subtotal,new.tax_total,new.total from public.quote_items i where i.quote_version_id=new.id;
  select coalesce(jsonb_agg(jsonb_build_object('tax_rate',t.tax_rate,'subtotal',t.subtotal,
    'tax_amount',t.tax_amount,'total',t.total) order by t.tax_rate),'[]'::jsonb)
    into new.tax_breakdown from (
      select tax_rate,sum(subtotal) subtotal,sum(tax_amount) tax_amount,sum(total) total
      from public.quote_items where quote_version_id=new.id group by tax_rate
    ) t;
  if tg_op='UPDATE' and new.state='prepared' then
    if not exists(select 1 from public.quote_items where quote_version_id=new.id) then
      raise exception 'items_required' using errcode='22023';
    end if;
    new.locked_at := pg_catalog.now();
    new.sent_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.tg_quote_version_project_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (to_jsonb(new)-array['pdf_file_id','state','sent_at','row_version'])=(to_jsonb(old)-array['pdf_file_id','state','sent_at','row_version']) then return null; end if;
  update public.quotes set subtotal=new.subtotal,tax_total=new.tax_total,total=new.total
    where tenant_id=new.tenant_id and id=new.quote_id and current_version_id=new.id;
  return null;
end $$;

create function public.tg_quote_commercial_state_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare code text; oldcode text; action text:=current_setting('app.quote_transition',true);
begin
 select s.code into code from public.quote_statuses s where s.id=new.status_id and s.tenant_id=new.tenant_id;
 if tg_op='INSERT' then
   if code in ('sent','accepted','rejected') or new.accepted_version_id is not null then
     raise exception 'controlled_transition_required' using errcode='23514';
   end if;
   return new;
 end if;
 select s.code into oldcode from public.quote_statuses s where s.id=old.status_id and s.tenant_id=old.tenant_id;
 if old.accepted_version_id is not null and new.accepted_version_id is distinct from old.accepted_version_id then
   raise exception 'accepted_version_immutable' using errcode='55000';
 end if;
 if new.accepted_version_id is distinct from old.accepted_version_id and action is distinct from 'accept' then
   raise exception 'controlled_transition_required' using errcode='23514';
 end if;
 if new.status_id is distinct from old.status_id then
   if code in ('sent','accepted','rejected') and action is distinct from
     (case code when 'sent' then 'send' when 'accepted' then 'accept' else 'reject' end) then
     raise exception 'controlled_transition_required' using errcode='23514';
   end if;
   if oldcode in ('sent','accepted','rejected') and action not in ('accept','reject','new_version') or
      oldcode in ('sent','accepted','rejected') and action is null then
     raise exception 'controlled_transition_required' using errcode='23514';
   end if;
 end if;
 if old.accepted_version_id is not null and new.current_version_id is distinct from old.current_version_id then
   raise exception 'accepted_version_immutable' using errcode='55000';
 end if;
 return new;
end $$;
create trigger quotes_commercial_state before insert or update on public.quotes
for each row execute function public.tg_quote_commercial_state_v1();

create function public.transition_quote_v1(p_quote_id uuid,p_version_id uuid,p_expected_row_version bigint,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v public.quote_versions%rowtype; code text; target text; sid uuid;
begin
 q:=public.quote_commercial_lock_v1(p_quote_id);
 if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if p_action not in ('send','accept','reject') or p_action is null then return jsonb_build_object('ok',false,'error','invalid'); end if;
 select * into v from public.quote_versions where id=p_version_id and quote_id=q.id and tenant_id=q.tenant_id for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if q.current_version_id is distinct from v.id then return jsonb_build_object('ok',false,'error','invalid_state'); end if;
 select s.code into code from public.quote_statuses s where s.id=q.status_id;
 target:=case p_action when 'send' then 'sent' when 'accept' then 'accepted' else 'rejected' end;
 if code=target and v.state='sent' and (target<>'accepted' or q.accepted_version_id=v.id) then
   return jsonb_build_object('ok',true,'replayed',true,'version',to_jsonb(v));
 end if;
 if p_expected_row_version is null or p_expected_row_version<>q.row_version then
   return jsonb_build_object('ok',false,'error','conflict','row_version',q.row_version);
 end if;
 if q.converted_order_id is not null or q.accepted_version_id is not null or
   (p_action='send' and (v.state<>'prepared' or code not in ('draft','pending'))) or
   (p_action<>'send' and (code<>'sent' or v.state<>'sent')) then
   return jsonb_build_object('ok',false,'error','invalid_state');
 end if;
 if p_action in ('send','accept') and not exists(select 1 from public.quote_files f
   where f.id=v.pdf_file_id and f.tenant_id=q.tenant_id and f.quote_id=q.id and f.pdf_version_id=v.id
     and f.status='ready' and f.deleted_at is null and f.completed_at is not null
     and f.size_bytes>0 and f.content_type='application/pdf') then
   return jsonb_build_object('ok',false,'error','pdf_required');
 end if;
 select s.id into sid from public.quote_statuses s where s.tenant_id=q.tenant_id and s.code=target and s.active;
 if sid is null then return jsonb_build_object('ok',false,'error','status_required'); end if;
 perform set_config('app.quote_transition',p_action,true);
 if p_action='send' then
   update public.quote_versions set state='sent',sent_at=now() where id=v.id returning * into v;
 end if;
 update public.quotes set status_id=sid,
   sent_at=case when p_action='send' then now() else sent_at end,
   accepted_at=case when p_action='accept' then now() else accepted_at end,
   rejected_at=case when p_action='reject' then now() else rejected_at end,
   accepted_version_id=case when p_action='accept' then v.id else accepted_version_id end
 where id=q.id;
 perform set_config('app.quote_transition','',true);
 return jsonb_build_object('ok',true,'replayed',false,'version',to_jsonb(v));
end $$;

create function public.set_editable_quote_status_v1(p_quote_id uuid,p_status_id uuid,p_expected_row_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; code text;
begin
 q:=public.quote_commercial_lock_v1(p_quote_id);
 if q.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
 select s.code into code from public.quote_statuses s where s.id=p_status_id and s.tenant_id=q.tenant_id and s.active;
 if code is null or code not in ('draft','pending','expired') or q.accepted_version_id is not null or exists(
   select 1 from public.quote_statuses s where s.id=q.status_id and s.code in ('sent','accepted','rejected')) then
   return jsonb_build_object('ok',false,'error','invalid_state');
 end if;
 if p_expected_row_version is null or q.row_version<>p_expected_row_version then
   return jsonb_build_object('ok',false,'error','conflict','row_version',q.row_version);
 end if;
 update public.quotes set status_id=p_status_id where id=q.id;
 return jsonb_build_object('ok',true);
end $$;
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
    currency,prices_include_tax,seller_snapshot,client_snapshot,created_by)
  values(q.tenant_id,q.id,n,src.title,src.description,src.terms,src.issue_date,src.valid_until,
    src.currency,src.prices_include_tax,src.seller_snapshot,src.client_snapshot,auth.uid()) returning * into v;
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

create or replace function public.tg_quotes_activity()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_old_name text;
  v_old_code text;
  v_new_name text;
  v_new_code text;
  v_order_reference text;
  v_old_client text;
  v_new_client text;
  v_old_service text;
  v_new_service text;
  v_old_assignee text;
  v_new_assignee text;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id, metadata
    ) values (
      new.tenant_id,
      v_actor,
      'quote.created',
      'quote',
      new.id,
      pg_catalog.jsonb_build_object('reference', new.reference)
    );
    return new;
  end if;

  if old.converted_order_id is null and new.converted_order_id is not null then
    select o.reference into v_order_reference
    from public.orders o
    where o.id = new.converted_order_id
      and o.tenant_id = new.tenant_id;

    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id,
      new_values, metadata
    ) values (
      new.tenant_id,
      v_actor,
      'quote.converted',
      'quote',
      new.id,
      pg_catalog.jsonb_build_object('order_reference', v_order_reference),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'order_reference', v_order_reference
      )
    );
    return new;
  end if;

  if old.status_id is distinct from new.status_id then
    select qs.name, qs.code into v_old_name, v_old_code
    from public.quote_statuses qs
    where qs.tenant_id = new.tenant_id
      and qs.id = old.status_id;

    select qs.name, qs.code into v_new_name, v_new_code
    from public.quote_statuses qs
    where qs.tenant_id = new.tenant_id
      and qs.id = new.status_id;

    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    ) values (
      new.tenant_id,
      v_actor,
      'quote.status_changed',
      'quote',
      new.id,
      pg_catalog.jsonb_build_object(
        'status_name', v_old_name,
        'status_code', v_old_code
      ),
      pg_catalog.jsonb_build_object(
        'status_name', v_new_name,
        'status_code', v_new_code
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'status',
        'version_id', new.current_version_id,
        'version_number', (select version_number from public.quote_versions where id=new.current_version_id),
        'from_status', v_old_code, 'to_status', v_new_code,
        'total', new.total::text, 'currency', new.currency
      )
    );
    return new;
  end if;

  if old.title is not distinct from new.title
     and old.description is not distinct from new.description
     and old.notes is not distinct from new.notes
     and old.valid_until is not distinct from new.valid_until
     and old.client_id is not distinct from new.client_id
     and old.service_id is not distinct from new.service_id
     and old.assigned_team_member_id is not distinct from new.assigned_team_member_id
     and old.archived_at is not distinct from new.archived_at then
    return new;
  end if;

  select c.name into v_old_client
  from public.clients c
  where c.tenant_id = new.tenant_id and c.id = old.client_id;
  select c.name into v_new_client
  from public.clients c
  where c.tenant_id = new.tenant_id and c.id = new.client_id;
  select s.name into v_old_service
  from public.services s
  where s.tenant_id = new.tenant_id and s.id = old.service_id;
  select s.name into v_new_service
  from public.services s
  where s.tenant_id = new.tenant_id and s.id = new.service_id;
  select tm.name into v_old_assignee
  from public.team_members tm
  where tm.tenant_id = new.tenant_id and tm.id = old.assigned_team_member_id;
  select tm.name into v_new_assignee
  from public.team_members tm
  where tm.tenant_id = new.tenant_id and tm.id = new.assigned_team_member_id;

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    new.tenant_id,
    v_actor,
    'quote.updated',
    'quote',
    new.id,
    pg_catalog.jsonb_build_object(
      'title', old.title,
      'description', old.description,
      'notes', old.notes,
      'valid_until', old.valid_until,
      'client_name', v_old_client,
      'service_name', v_old_service,
      'assigned_team_member_name', v_old_assignee
    ),
    pg_catalog.jsonb_build_object(
      'title', new.title,
      'description', new.description,
      'notes', new.notes,
      'valid_until', new.valid_until,
      'client_name', v_new_client,
      'service_name', v_new_service,
      'assigned_team_member_name', v_new_assignee
    ),
    pg_catalog.jsonb_build_object('reference', new.reference)
  );

  return new;
end;
$function$;


revoke all on function public.tg_quote_commercial_state_v1() from public,anon,authenticated,service_role;
revoke all on function public.transition_quote_v1(uuid,uuid,bigint,text),public.set_editable_quote_status_v1(uuid,uuid,bigint) from public,anon,service_role;
grant execute on function public.transition_quote_v1(uuid,uuid,bigint,text),public.set_editable_quote_status_v1(uuid,uuid,bigint) to authenticated;
commit;
