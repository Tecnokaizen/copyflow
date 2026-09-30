-- Rich Text V1.
-- quotes.description and quotes.notes are copied onto the order unchanged,
-- so canonical HTML survives conversion.
-- orders.title stays plain text. The previous fallback
-- left(btrim(description), 120) would copy tags into the title when
-- quotes.title is null. This replacement derives that fallback from
-- tag-stripped text. No backfill and no new columns.
-- Kiosk RPCs are unchanged: submit_kiosk_order still measures
-- char_length(btrim(p_description)) on the raw string.

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
  v_plain text;
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
    v_plain := coalesce(v_quote.description, '');
    v_plain := regexp_replace(v_plain, '<br[[:space:]]*/?>', ' ', 'gi');
    v_plain := regexp_replace(
      v_plain,
      '</(p|div|li|h[1-6]|tr|blockquote|ul|ol)>',
      ' ',
      'gi'
    );
    v_plain := regexp_replace(v_plain, '<[^>]*>', '', 'g');
    v_plain := replace(v_plain, '&nbsp;', ' ');
    v_plain := replace(v_plain, '&#160;', ' ');
    v_plain := replace(v_plain, '&amp;', '&');
    v_plain := replace(v_plain, '&lt;', '<');
    v_plain := replace(v_plain, '&gt;', '>');
    v_plain := replace(v_plain, '&quot;', '"');
    v_plain := replace(v_plain, '&#39;', '''');
    v_plain := regexp_replace(v_plain, '[[:space:]]+', ' ', 'g');
    v_title := nullif(pg_catalog.left(pg_catalog.btrim(v_plain), 120), '');
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
  'Copies quote description and notes unchanged. Derives orders.title from plain text when quotes.title is null.';
