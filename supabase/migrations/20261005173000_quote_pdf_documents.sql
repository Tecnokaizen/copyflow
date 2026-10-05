begin;
-- A reservation lives in the existing quota-accounted metadata table, not a blob store.
alter table public.quote_files add column pdf_version_id uuid;
alter table public.quote_files add constraint quote_files_pdf_version_fk
  foreign key (tenant_id,quote_id,pdf_version_id) references public.quote_versions(tenant_id,quote_id,id);
create unique index quote_files_one_pdf_per_version on public.quote_files(pdf_version_id) where pdf_version_id is not null;

create or replace function public.tg_quote_version_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
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

-- Document linking does not change operational quote concurrency tokens.
create or replace function public.tg_quote_version_project_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (to_jsonb(new)-'pdf_file_id')=(to_jsonb(old)-'pdf_file_id') then return null; end if;
  update public.quotes set subtotal=new.subtotal,tax_total=new.tax_total,total=new.total
    where tenant_id=new.tenant_id and id=new.quote_id and current_version_id=new.id;
  return null;
end $$;
-- No draft can be assigned a PDF, even by a trusted SQL writer.
create function public.tg_quote_pdf_integrity_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.pdf_file_id is not null and (new.state not in ('prepared','sent') or not exists(
    select 1 from public.quote_files f where f.id=new.pdf_file_id and f.tenant_id=new.tenant_id
      and f.quote_id=new.quote_id and f.pdf_version_id=new.id and f.status='ready'
      and f.deleted_at is null and f.content_type='application/pdf'
  )) then raise exception 'invalid_official_pdf' using errcode='23514'; end if;
  return new;
end $$;
create trigger quote_pdf_integrity before insert or update on public.quote_versions
for each row execute function public.tg_quote_pdf_integrity_v1();

create function public.tg_quote_pdf_file_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.pdf_version_id is not null then
    if tg_op='DELETE' then
      if old.status='ready' or old.upload_expires_at >= now() then
        raise exception 'official_pdf_protected' using errcode='55000'; end if;
      return old;
    end if;
    if new.pdf_version_id is distinct from old.pdf_version_id
      or new.deleted_at is distinct from old.deleted_at
      or new.content_type is distinct from old.content_type
      or new.size_bytes is distinct from old.size_bytes
      or new.original_name is distinct from old.original_name
      or new.upload_expires_at is distinct from old.upload_expires_at
      or (new.status is distinct from old.status and current_setting('app.quote_pdf_action',true) is distinct from 'finish') then
      raise exception 'official_pdf_protected' using errcode='55000'; end if;
  elsif tg_op='UPDATE' and new.pdf_version_id is not null
    and current_setting('app.quote_pdf_action',true) is distinct from 'reserve' then
    raise exception 'official_pdf_protected' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger quote_pdf_file_guard before update or delete on public.quote_files
for each row execute function public.tg_quote_pdf_file_guard_v1();

create function public.reserve_quote_pdf_v1(p_quote_id uuid,p_version_id uuid,p_file_id uuid,
  p_size_bytes bigint,p_issued_at bigint,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v public.quote_versions%rowtype; f public.quote_files%rowtype; r jsonb;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then raise exception 'quote not found' using errcode='P0002'; end if;
  select * into v from public.quote_versions where id=p_version_id and quote_id=q.id and tenant_id=q.tenant_id for update;
  if not found then raise exception 'version not found' using errcode='P0002'; end if;
  if v.state not in ('prepared','sent') then raise exception 'version_not_prepared' using errcode='55000'; end if;
  if not files_private.verify_quote_files_capability('create',auth.uid(),q.tenant_id,q.id,p_file_id,p_issued_at,p_signature)
    then raise exception 'invalid capability' using errcode='42501'; end if;
  select * into f from public.quote_files where pdf_version_id=v.id for update;
  if found then
    if f.deleted_at is not null then raise exception 'official_pdf_protected' using errcode='55000'; end if;
    if f.status='pending' and f.upload_expires_at < now() then raise exception 'upload expired' using errcode='22023'; end if;
    if f.size_bytes<>p_size_bytes and f.status='pending' then raise exception 'document_size_mismatch' using errcode='23514'; end if;
  else
    if v.pdf_file_id is not null then raise exception 'invalid_official_pdf' using errcode='23514'; end if;
    r:=public.create_quote_file_upload(q.id,p_file_id,
      regexp_replace(q.reference,'[^a-zA-Z0-9_-]','_','g')||'-v'||v.version_number::text||'.pdf',
      'application/pdf',p_size_bytes,now()+interval '1 hour',p_issued_at,p_signature);
    perform set_config('app.quote_pdf_action','reserve',true);
    update public.quote_files set pdf_version_id=v.id where id=p_file_id returning * into f;
    perform set_config('app.quote_pdf_action','',true);
  end if;
  return jsonb_build_object('file',public.quote_file_public_json(f),'storage_key',f.storage_key,
    'upload_expires_at',f.upload_expires_at,'linked',v.pdf_file_id=f.id);
end $$;

create function public.finish_quote_pdf_v1(p_quote_id uuid,p_version_id uuid,p_file_id uuid,
  p_etag text,p_issued_at bigint,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; v public.quote_versions%rowtype; f public.quote_files%rowtype; r jsonb;
begin
  q:=public.quote_commercial_lock_v1(p_quote_id);
  if q.id is null then raise exception 'quote not found' using errcode='P0002'; end if;
  select * into v from public.quote_versions where id=p_version_id and quote_id=q.id and tenant_id=q.tenant_id for update;
  if not found then raise exception 'version not found' using errcode='P0002'; end if;
  if v.state not in ('prepared','sent') then raise exception 'version_not_prepared' using errcode='55000'; end if;
  if not files_private.verify_quote_files_capability('complete',auth.uid(),q.tenant_id,q.id,p_file_id,p_issued_at,p_signature)
    then raise exception 'invalid capability' using errcode='42501'; end if;
  select * into f from public.quote_files where id=p_file_id and tenant_id=q.tenant_id
    and quote_id=q.id and pdf_version_id=v.id and deleted_at is null and content_type='application/pdf' for update;
  if not found then raise exception 'file not found' using errcode='P0002'; end if;
  if v.pdf_file_id is not null then
    if v.pdf_file_id<>f.id or f.status<>'ready' then raise exception 'official_pdf_protected' using errcode='55000'; end if;
    return jsonb_build_object('file',public.quote_file_public_json(f),'replayed',true);
  end if;
  perform set_config('app.quote_pdf_action','finish',true);
  r:=public.complete_quote_file_upload(q.id,f.id,p_etag,p_issued_at,p_signature);
  update public.quote_versions set pdf_file_id=f.id where id=v.id;
  perform set_config('app.quote_pdf_action','',true);
  insert into public.activity_log(tenant_id,user_id,action,entity_type,entity_id,metadata)
    values(q.tenant_id,auth.uid(),'quote.pdf_generated','quote',q.id,
      jsonb_build_object('quote_id',q.id,'reference',q.reference,'version_id',v.id,
        'version_number',v.version_number,'file_id',f.id,'total',v.total,'currency',v.currency));
  return jsonb_build_object('file',r->'file','replayed',false);
end $$;

-- Future preparations freeze fiscal settings too. Existing prepared snapshots stay intact.
create or replace function public.quote_seller_snapshot_v1(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tenant_id',t.id,'business_name',coalesce(s.business_name,t.name),
    'logo_url',s.logo_url,'branding',coalesce(s.branding,'{}'::jsonb),
    'tax_id',s.preferences->'quote_document'->>'tax_id',
    'billing_address',s.preferences->'quote_document'->>'billing_address',
    'email',s.preferences->'quote_document'->>'email','phone',s.preferences->'quote_document'->>'phone')
  from public.tenants t left join public.tenant_settings s on s.tenant_id=t.id where t.id=p_tenant_id;
$$;
revoke all on function public.tg_quote_pdf_integrity_v1(),public.tg_quote_pdf_file_guard_v1(),
  public.reserve_quote_pdf_v1(uuid,uuid,uuid,bigint,bigint,text),
  public.finish_quote_pdf_v1(uuid,uuid,uuid,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_quote_pdf_v1(uuid,uuid,uuid,bigint,bigint,text),
  public.finish_quote_pdf_v1(uuid,uuid,uuid,text,bigint,text) to authenticated;
-- PostgREST JSON numbers can lose numeric precision in JavaScript. This invoker
-- read preserves every commercial decimal as text, including tax_breakdown.
create function public.quote_pdf_source_v1(p_tenant_id uuid,p_quote_id uuid,p_version_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('reference',q.reference,'version',to_jsonb(v)||jsonb_build_object(
   'subtotal',v.subtotal::text,'tax_total',v.tax_total::text,'total',v.total::text,
   'tax_breakdown',(select coalesce(jsonb_agg(jsonb_build_object(
     'tax_rate',t->>'tax_rate','subtotal',t->>'subtotal','tax_amount',t->>'tax_amount','total',t->>'total')),'[]'::jsonb)
     from jsonb_array_elements(v.tax_breakdown) t)),
   'items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object(
     'quantity',i.quantity::text,'unit_price',i.unit_price::text,'discount_percent',i.discount_percent::text,
     'tax_rate',i.tax_rate::text,'subtotal',i.subtotal::text,'tax_amount',i.tax_amount::text,'total',i.total::text)
     order by i.position),'[]'::jsonb) from public.quote_items i where i.tenant_id=v.tenant_id and i.quote_version_id=v.id))
 from public.quotes q join public.quote_versions v on v.tenant_id=q.tenant_id and v.quote_id=q.id
 where q.tenant_id=p_tenant_id and q.id=p_quote_id and v.id=p_version_id and v.state in ('prepared','sent');
$$;
revoke all on function public.quote_pdf_source_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.quote_pdf_source_v1(uuid,uuid,uuid) to authenticated;
commit;
