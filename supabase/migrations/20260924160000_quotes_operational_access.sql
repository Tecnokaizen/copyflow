-- Quotes operational access. Additive upgrade; keep the applied Quotes V1 migration intact.
begin;

alter policy quotes_select_admin
  on public.quotes
  to authenticated
  using (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'staff']::text[])
  );

alter policy quotes_insert_admin
  on public.quotes
  to authenticated
  with check (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'staff']::text[])
  );

alter policy quotes_update_admin
  on public.quotes
  to authenticated
  using (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'staff']::text[])
  )
  with check (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'staff']::text[])
  );

create or replace function public.convert_quote_to_order (
  p_quote_id uuid
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_quote public.quotes%rowtype;
  v_order public.orders%rowtype;
  v_status_id uuid;
  v_status_count integer;
  v_title text;
begin
  if auth.uid() is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select q.* into v_quote
  from public.quotes q
  where q.id = p_quote_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(v_quote.tenant_id, array['owner', 'admin', 'manager', 'staff']::text[])
     or not public.tenant_has_feature(v_quote.tenant_id, 'quotes') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_quote.converted_order_id is not null then
    select o.* into v_order
    from public.orders o
    where o.id = v_quote.converted_order_id
      and o.tenant_id = v_quote.tenant_id;

    if not found then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'created', false,
      'order_id', v_order.id,
      'reference', v_order.reference
    );
  end if;

  select pg_catalog.count(*)::integer into v_status_count
  from public.order_statuses os
  where os.tenant_id = v_quote.tenant_id
    and os.active is true
    and os.is_initial is true;

  if v_status_count <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_initial_status');
  end if;

  select os.id into v_status_id
  from public.order_statuses os
  where os.tenant_id = v_quote.tenant_id
    and os.active is true
    and os.is_initial is true
  limit 1;

  v_title := nullif(pg_catalog.btrim(coalesce(v_quote.title, '')), '');
  if v_title is null then
    v_title := nullif(pg_catalog.left(pg_catalog.btrim(v_quote.description), 120), '');
  end if;

  if v_title is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.orders (
    tenant_id,
    title,
    description,
    client_id,
    service_id,
    assigned_team_member_id,
    status_id,
    priority,
    notes,
    created_by,
    metadata
  ) values (
    v_quote.tenant_id,
    v_title,
    v_quote.description,
    v_quote.client_id,
    v_quote.service_id,
    v_quote.assigned_team_member_id,
    v_status_id,
    'normal',
    v_quote.notes,
    auth.uid(),
    pg_catalog.jsonb_build_object(
      'source', 'quote',
      'quote_id', v_quote.id,
      'quote_reference', v_quote.reference
    )
  )
  returning * into v_order;

  update public.quotes
  set converted_order_id = v_order.id
  where id = v_quote.id
    and tenant_id = v_quote.tenant_id
    and converted_order_id is null;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'created', true,
    'order_id', v_order.id,
    'reference', v_order.reference
  );
end;
$function$;

comment on function public.convert_quote_to_order(uuid) is
  'DEFINER so converted_order_id stays column-locked for authenticated. Locks the quote, reuses order insert triggers, returns the existing order when already converted.';

revoke all on function public.convert_quote_to_order(uuid) from public;
grant execute on function public.convert_quote_to_order(uuid) to authenticated;

-- Scoped history only: do not change activity_log RLS or list_activity_log.
create or replace function public.list_quote_activity(p_quote_id uuid)
  returns table (
    id uuid,
    created_at timestamptz,
    action text,
    entity_type text,
    entity_id uuid,
    user_id uuid,
    team_member_id uuid,
    previous_values jsonb,
    new_values jsonb,
    metadata jsonb
  )
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select q.tenant_id into v_tenant_id
  from public.quotes q
  where q.id = p_quote_id;

  -- An inaccessible quote is indistinguishable from a missing quote.
  if not found
     or not public.has_tenant_role(
       v_tenant_id, array['owner', 'admin', 'manager', 'staff']::text[]
     )
     or not public.tenant_has_feature(v_tenant_id, 'quotes') then
    return;
  end if;

  return query
  select al.id, al.created_at, al.action, al.entity_type, al.entity_id,
         al.user_id, al.team_member_id, al.previous_values, al.new_values, al.metadata
  from public.activity_log al
  where al.tenant_id = v_tenant_id
    and al.entity_type = 'quote'
    and al.entity_id = p_quote_id
  order by al.created_at desc, al.id desc
  limit 50;
end;
$function$;

comment on function public.list_quote_activity(uuid) is
  'DEFINER: latest 50 events for one quote, gated by active operational membership and quotes feature. No global Activity access.';

revoke all on function public.list_quote_activity(uuid) from public, anon;
grant execute on function public.list_quote_activity(uuid) to authenticated;

commit;
