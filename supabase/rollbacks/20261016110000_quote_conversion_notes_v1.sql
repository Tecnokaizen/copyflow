-- Rollback for 20261016110000_quote_conversion_notes_v1.sql (#108).
--
-- Restores convert_quote_to_order exactly as in 20261007190056 (same
-- signature, grants and no comment), so new conversions leave orders.notes
-- NULL again. The migration changes no table and no data.
--
-- What it deliberately does NOT do:
--   * touch orders converted while #108 was active: the copied notes belong
--     to those orders and stay (the team may have edited them since).
-- Verified on a database with main + #108: afterwards convert_quote_to_order
-- (body, grants, comment) equals main.
-- Then: supabase migration repair --status reverted 20261016110000
begin;

create or replace function public.convert_quote_to_order (
  p_quote_id uuid, p_store_id uuid, p_service_id uuid, p_assigned_team_member_id uuid,
  p_priority text, p_due_at timestamptz, p_expected_row_version bigint
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
  v_version public.quote_versions%rowtype;
begin
  v_quote:=public.quote_commercial_lock_v1(p_quote_id);
  if v_quote.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if not exists(select 1 from public.quote_statuses s where s.id=v_quote.status_id and s.code='accepted')
    or v_quote.accepted_version_id is null then return jsonb_build_object('ok',false,'error','invalid_state'); end if;
  select * into v_version from public.quote_versions where id=v_quote.accepted_version_id
    and tenant_id=v_quote.tenant_id and quote_id=v_quote.id and state='sent' for update;
  if not found then return jsonb_build_object('ok',false,'error','invalid_state'); end if;
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
      'replayed', true,
      'order_id', v_order.id,
      'reference', v_order.reference,
      'total_amount', public.order_money_text(v_order.total_amount)
    );
  end if;

  if p_expected_row_version is null or v_quote.row_version<>p_expected_row_version then
    return jsonb_build_object('ok',false,'error','conflict','row_version',v_quote.row_version);
  end if;
  if p_priority is null or p_priority not in ('normal','high','urgent') or
    (p_due_at is not null and not isfinite(p_due_at)) then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if (p_store_id is not null and not exists(select 1 from public.stores where id=p_store_id and tenant_id=v_quote.tenant_id and active)) or
    (p_service_id is not null and not exists(select 1 from public.services where id=p_service_id and tenant_id=v_quote.tenant_id and active)) or
    (p_assigned_team_member_id is not null and not exists(select 1 from public.team_members where id=p_assigned_team_member_id and tenant_id=v_quote.tenant_id and active)) then
    return jsonb_build_object('ok',false,'error','invalid_relation');
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

  v_title := nullif(pg_catalog.btrim(coalesce(v_version.title, '')), '');
  if v_title is null then
    v_plain := coalesce(v_version.description, '');
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

  perform pg_catalog.set_config('gestcopy.order_total_write', '1', true);

  insert into public.orders (
    tenant_id,
    title,
    description,
    client_id,
    service_id,
    assigned_team_member_id,
    status_id,
    store_id,
    priority,
    due_at,
    notes,
    total_amount,
    created_by,
    metadata
  ) values (
    v_quote.tenant_id,
    v_title,
    v_version.description,
    v_quote.client_id,
    p_service_id,
    p_assigned_team_member_id,
    v_status_id,
    p_store_id,
    p_priority,
    p_due_at,
    null,
    v_version.total,
    auth.uid(),
    pg_catalog.jsonb_build_object(
      'source', 'quote',
      'quote_id', v_quote.id,
      'quote_reference', v_quote.reference,
      'quote_version_id', v_version.id
    )
  )
  returning * into v_order;

  perform pg_catalog.set_config('gestcopy.order_total_write', '', true);

  update public.quotes
  set converted_order_id = v_order.id
  where id = v_quote.id
    and tenant_id = v_quote.tenant_id
    and converted_order_id is null;

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    v_order.tenant_id,
    auth.uid(),
    'order.total_changed',
    'order',
    v_order.id,
    pg_catalog.jsonb_build_object('total_amount', null),
    pg_catalog.jsonb_build_object('total_amount', public.order_money_text(v_order.total_amount)),
    pg_catalog.jsonb_build_object(
      'reference', v_order.reference,
      'field', 'total_amount',
      'source', 'quote_conversion',
      'quote_id', v_quote.id
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'created', true,
    'replayed', false,
    'order_id', v_order.id,
    'reference', v_order.reference,
    'total_amount', public.order_money_text(v_order.total_amount)
  );
end;
$function$;

revoke all on function public.convert_quote_to_order(uuid,uuid,uuid,uuid,text,timestamptz,bigint) from public, anon, service_role;
grant execute on function public.convert_quote_to_order(uuid,uuid,uuid,uuid,text,timestamptz,bigint) to authenticated;

comment on function public.convert_quote_to_order(uuid,uuid,uuid,uuid,text,timestamptz,bigint) is null;

commit;
