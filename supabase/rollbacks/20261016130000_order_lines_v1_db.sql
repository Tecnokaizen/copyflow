-- Rollback for 20261016130000_order_lines_v1_db.sql (Order Lines V1 · PR A).
--
-- Removes order_items, the order-level columns (total_mode, prices_include_tax,
-- items_*), their guards, replace_order_items_v1 and the helper functions, and
-- restores set_order_total_amount exactly as in 20261016090000.
--
-- It REFUSES to run when it would lose data: any order line, or any order that
-- uses lines (items mode, VAT-included flag or non-zero items_* amounts). Move
-- those orders back to manual mode first; total_amount is never modified here.
--
-- It never touches tg_orders_total_amount_guard (owned by the P0 hotfix
-- 20261016123500, which cannot be rolled back): the vulnerable version is never
-- restored by this script.
-- It does not delete 'order.items_replaced' rows from activity_log (history).
-- Then: supabase migration repair --status reverted 20261016130000
begin;

do $guard$
begin
  if exists (select 1 from public.order_items) then
    raise exception 'rollback refused: order_items still has rows';
  end if;
  if exists (
    select 1 from public.orders
    where total_mode <> 'manual'
       or prices_include_tax
       or items_subtotal <> 0
       or items_tax_total <> 0
       or items_total <> 0
  ) then
    raise exception 'rollback refused: some orders use order lines';
  end if;
end
$guard$;

drop trigger if exists trg_orders_items_guard on public.orders;
drop trigger if exists trg_orders_purge_items on public.orders;
drop table public.order_items;

drop function public.replace_order_items_v1(uuid, text, jsonb, text, boolean);
drop function public.order_item_payload_error_v1(jsonb);
drop function public.order_items_refresh_totals_v1(uuid, uuid);
drop function public.tg_order_items_rollup_v1();
drop function public.tg_order_item_guard_v1();
drop function public.tg_orders_items_guard_v1();
drop function public.tg_orders_purge_items_v1();

alter table public.orders
  drop constraint orders_items_mode_total,
  drop constraint orders_items_amounts_nonnegative,
  drop constraint orders_total_mode_check,
  drop column items_total,
  drop column items_tax_total,
  drop column items_subtotal,
  drop column prices_include_tax,
  drop column total_mode;

create or replace function public.set_order_total_amount(
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

  if v_total is not distinct from v_order.total_amount then
    return pg_catalog.jsonb_build_object('ok', true, 'changed', false)
      || public.order_collection_snapshot(v_order);
  end if;

  perform pg_catalog.set_config('gestcopy.order_total_write', '1', true);

  update public.orders
  set total_amount = v_total
  where id = v_order.id
    and tenant_id = v_order.tenant_id
  returning * into v_updated;

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
    pg_catalog.jsonb_build_object('total_amount', public.order_money_text(v_order.total_amount)),
    pg_catalog.jsonb_build_object('total_amount', public.order_money_text(v_updated.total_amount)),
    pg_catalog.jsonb_build_object('reference', v_order.reference, 'field', 'total_amount')
  );

  return pg_catalog.jsonb_build_object('ok', true, 'changed', true)
    || public.order_collection_snapshot(v_updated);
exception
  when sqlstate '23514' then
    perform pg_catalog.set_config('gestcopy.order_total_write', '', true);
    if sqlerrm = 'total_below_paid' then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_below_paid');
    end if;
    raise;
end;
$function$;

revoke all on function public.set_order_total_amount(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_order_total_amount(uuid, text, text) to authenticated;

commit;
