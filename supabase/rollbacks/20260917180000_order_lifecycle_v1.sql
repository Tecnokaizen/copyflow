\set ON_ERROR_STOP on

-- Rollback for 20260917180000_order_lifecycle_v1.sql
-- Restores pre-lifecycle change_order_status from 20260907171432_remote_schema.sql.
-- Leaves Kiosk objects and tg_activity_log_order_created untouched.

begin;

drop trigger if exists trg_orders_activity_log_archived on public.orders;
drop function if exists public.tg_activity_log_order_archived();

drop trigger if exists trg_orders_lifecycle_guard on public.orders;
drop function if exists public.tg_orders_lifecycle_guard();

drop function if exists public.archive_order(uuid, uuid);

create or replace function public.change_order_status (
  p_order_id  uuid,
  p_status_id uuid,
  p_tenant_id uuid
)
  returns jsonb
  language plpgsql
  set search_path to ''
  as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_order public.orders%rowtype;
  v_new_status public.order_statuses%rowtype;
  v_updated public.orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null or p_status_id is null or p_tenant_id is null then
    raise exception 'p_order_id, p_status_id and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  select *
  into v_new_status
  from public.order_statuses
  where id = p_status_id
    and tenant_id = p_tenant_id
    and active = true;

  if not found then
    raise exception 'invalid order status'
      using errcode = '22023';
  end if;

  if v_order.status_id is not distinct from v_new_status.id then
    return pg_catalog.jsonb_build_object(
      'order', pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'status_id', v_order.status_id,
        'ready_at', v_order.ready_at,
        'delivered_at', v_order.delivered_at
      ),
      'status', pg_catalog.jsonb_build_object(
        'id', v_new_status.id,
        'tenant_id', v_new_status.tenant_id,
        'code', v_new_status.code,
        'name', v_new_status.name,
        'is_ready', v_new_status.is_ready,
        'is_closed', v_new_status.is_closed,
        'is_cancelled', v_new_status.is_cancelled
      )
    );
  end if;

  update public.orders
  set
    status_id = v_new_status.id,
    updated_at = v_now,
    ready_at = case
      when v_new_status.is_ready is true and ready_at is null then v_now
      else ready_at
    end,
    delivered_at = case
      when v_new_status.is_closed is true
        and v_new_status.is_cancelled is not true
        and delivered_at is null then v_now
      else delivered_at
    end
  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_updated;

  if not found then
    raise exception 'could not update order'
      using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'order', pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'status_id', v_updated.status_id,
      'ready_at', v_updated.ready_at,
      'delivered_at', v_updated.delivered_at
    ),
    'status', pg_catalog.jsonb_build_object(
      'id', v_new_status.id,
      'tenant_id', v_new_status.tenant_id,
      'code', v_new_status.code,
      'name', v_new_status.name,
      'is_ready', v_new_status.is_ready,
      'is_closed', v_new_status.is_closed,
      'is_cancelled', v_new_status.is_cancelled
    )
  );
end;
$function$;

comment on function public.change_order_status(uuid, uuid, uuid) is
  'INVOKER. p_tenant_id solo desde getCurrentContext() en servidor. Log vía trigger, misma transacción.';

commit;
