-- Order line-item calculator · atomic switch to a direct (manual) total.
--
-- Order Lines V1 (20261016130000) lets an order derive total_amount from its
-- lines (total_mode = 'items'). set_order_total_amount refuses that mode
-- (total_mode_items), so going back to a typed amount needed two calls
-- (replace_order_items_v1 with total_mode = 'manual', then
-- set_order_total_amount). If the second call failed, the order was already in
-- manual mode with the old total.
--
-- set_order_manual_total_v1 does both in ONE transaction and ONE UPDATE:
--   * total_mode -> 'manual' (when it was 'items') and total_amount -> p_total;
--   * order_items and items_* are kept untouched: the lines stay as reference
--     and no longer determine the total;
--   * same checks as set_order_total_amount: member, operative role, not
--     archived, row_version, amount format; tg_orders_total_amount_guard still
--     raises total_below_paid on that same UPDATE (nothing is written then);
--   * row_version goes up once; one 'order.total_changed' activity row.
-- On an order already in manual mode it behaves like set_order_total_amount.
--
-- Additive: no existing function, table or column changes.
-- Rollback: supabase/rollbacks/20261105100000_order_manual_total_switch_v1.sql

create or replace function public.set_order_manual_total_v1(
  p_order_id uuid,
  p_total text,
  p_expected_row_version text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_total numeric(20,2);
begin
  if auth.uid() is null or p_order_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or not public.is_tenant_member(v_order.tenant_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(
    v_order.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_order.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
  end if;

  if p_expected_row_version is null
     or p_expected_row_version !~ '^[0-9]+$'
     or v_order.row_version::text is distinct from p_expected_row_version then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'row_version', v_order.row_version::text
    );
  end if;

  if p_total is null then
    v_total := null;
  elsif p_total ~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,2})?$' then
    v_total := p_total::numeric(20,2);
  else
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if v_order.total_mode = 'manual' and v_total is not distinct from v_order.total_amount then
    return pg_catalog.jsonb_build_object('ok', true, 'changed', false, 'total_mode', v_order.total_mode)
      || public.order_collection_snapshot(v_order);
  end if;

  perform pg_catalog.set_config('gestcopy.order_items_write', '1', true);
  perform pg_catalog.set_config('gestcopy.order_total_write', '1', true);

  update public.orders
  set total_mode = 'manual',
      total_amount = v_total
  where id = v_order.id
    and tenant_id = v_order.tenant_id
  returning * into v_updated;

  perform pg_catalog.set_config('gestcopy.order_items_write', '', true);
  perform pg_catalog.set_config('gestcopy.order_total_write', '', true);

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    v_order.tenant_id,
    auth.uid(),
    'order.total_changed',
    'order',
    v_order.id,
    pg_catalog.jsonb_build_object(
      'total_amount', public.order_money_text(v_order.total_amount),
      'total_mode', v_order.total_mode
    ),
    pg_catalog.jsonb_build_object(
      'total_amount', public.order_money_text(v_updated.total_amount),
      'total_mode', v_updated.total_mode
    ),
    pg_catalog.jsonb_build_object('reference', v_order.reference, 'field', 'total_amount')
  );

  return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'total_mode', v_updated.total_mode)
    || public.order_collection_snapshot(v_updated);
exception
  when sqlstate '23514' then
    perform pg_catalog.set_config('gestcopy.order_items_write', '', true);
    perform pg_catalog.set_config('gestcopy.order_total_write', '', true);
    if sqlerrm = 'total_below_paid' then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_below_paid');
    end if;
    raise;
end;
$function$;

revoke all on function public.set_order_manual_total_v1(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_order_manual_total_v1(uuid, text, text) to authenticated;

comment on function public.set_order_manual_total_v1(uuid, text, text) is
  'SECURITY DEFINER. Sets a typed order total and, in the same UPDATE, leaves items mode (lines are kept as reference). Same checks as set_order_total_amount; total_below_paid still applies. Operative roles only; archived orders are read-only.';
