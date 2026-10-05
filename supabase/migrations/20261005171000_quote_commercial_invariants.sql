begin;
-- Pure numeric fiscal function. Round each output at the line boundary.
create function public.quote_line_amounts_v1(
  p_quantity numeric,p_price numeric,p_discount numeric,p_tax numeric,p_inclusive boolean
) returns table(subtotal numeric,tax_amount numeric,total numeric)
language sql immutable set search_path='' as $$
  with line as (select p_quantity*p_price*(1-p_discount/100) as net),
  base as (select case when p_inclusive then net/(1+p_tax/100) else net end as base,net from line)
  select round(base,2),round(case when p_inclusive then net-base else base*p_tax/100 end,2),
    round(case when p_inclusive then net else base*(1+p_tax/100) end,2) from base;
$$;

create function public.tg_quote_version_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
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
create trigger quote_versions_guard before insert or update or delete on public.quote_versions
for each row execute function public.tg_quote_version_guard_v1();

create function public.tg_quote_item_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.quote_versions%rowtype;
begin
  if tg_op='UPDATE' and (new.id,new.tenant_id,new.quote_version_id,new.created_at)
    is distinct from (old.id,old.tenant_id,old.quote_version_id,old.created_at) then
    raise exception 'immutable_identity' using errcode='55000';
  end if;
  select * into v from public.quote_versions
    where id=case when tg_op='DELETE' then old.quote_version_id else new.quote_version_id end
    and tenant_id=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end for update;
  if not found then raise exception 'version_not_found' using errcode='23503'; end if;
  if v.state <> 'draft' then raise exception 'immutable_items' using errcode='55000'; end if;
  if tg_op='DELETE' then return old; end if;
  select a.subtotal,a.tax_amount,a.total into new.subtotal,new.tax_amount,new.total
    from public.quote_line_amounts_v1(new.quantity,new.unit_price,new.discount_percent,new.tax_rate,v.prices_include_tax) a;
  return new;
end;
$$;
create trigger quote_items_guard before insert or update or delete on public.quote_items
for each row execute function public.tg_quote_item_guard_v1();

create function public.tg_quote_items_rollup_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.quote_versions set row_version=row_version
    where id=case when tg_op='DELETE' then old.quote_version_id else new.quote_version_id end;
  return null;
end;
$$;
create trigger quote_items_rollup after insert or update or delete on public.quote_items
for each row execute function public.tg_quote_items_rollup_v1();

create function public.tg_quote_projection_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.quote_versions%rowtype;
begin
  if new.accepted_version_id is not null and not exists(
    select 1 from public.quote_versions where id=new.accepted_version_id and tenant_id=new.tenant_id
      and quote_id=new.id and state='sent'
  ) then raise exception 'accepted_version_must_be_sent' using errcode='23514'; end if;
  if new.current_version_id is null then
    new.subtotal:=0; new.tax_total:=0; new.total:=0;
  else
    select * into v from public.quote_versions where id=new.current_version_id
      and tenant_id=new.tenant_id and quote_id=new.id;
    if not found then raise exception 'current_version_not_found' using errcode='23503'; end if;
    new.subtotal:=v.subtotal; new.tax_total:=v.tax_total; new.total:=v.total;
    new.currency:=v.currency; new.prices_include_tax:=v.prices_include_tax; new.issue_date:=v.issue_date;
  end if;
  return new;
end;
$$;
create trigger quotes_commercial_projection before insert or update on public.quotes
for each row execute function public.tg_quote_projection_v1();

create function public.tg_quote_version_project_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.quotes set subtotal=new.subtotal,tax_total=new.tax_total,total=new.total
    where tenant_id=new.tenant_id and id=new.quote_id and current_version_id=new.id;
  return null;
end;
$$;
create trigger quote_version_project after update on public.quote_versions
for each row execute function public.tg_quote_version_project_v1();
-- Triggers cannot be invoked as RPCs, including by service_role.
revoke all on function public.tg_quote_version_guard_v1(),public.tg_quote_item_guard_v1(),
  public.tg_quote_items_rollup_v1(),public.tg_quote_projection_v1(),public.tg_quote_version_project_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.quote_line_amounts_v1(numeric,numeric,numeric,numeric,boolean) from public,anon,authenticated,service_role;
commit;
