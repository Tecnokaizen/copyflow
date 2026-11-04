-- Order invoice tracking V1 · «Requiere factura» / «Factura entregada».
--
-- Only records two states of an order. It does not issue invoices, does not
-- talk to any invoicing system and never touches amounts, payments, delivery
-- or statuses.
--
-- 1. public.orders.invoice_required and public.orders.invoice_delivered:
--    nullable booleans. NULL means «Sin indicar», so every existing order
--    keeps an honest value without any data backfill.
-- 2. CHECK orders_invoice_delivered_requires_invoice: invoice_delivered can
--    only be true when invoice_required is true.
-- 3. change_order_invoice_v1: SECURITY INVOKER RPC, same contract as
--    change_order_notification_status_v2 (roles owner/admin/manager/staff,
--    tenant from the caller, archived guard, p_expected_version / GCO01,
--    idempotent no-op, app.order_write marker around the single UPDATE).
--    When invoice_required is not true, invoice_delivered is stored as NULL
--    (not applicable); invoice_delivered = true without invoice_required =
--    true is rejected with 22023.
--
-- Not touched: RLS policies (orders keeps its tenant policies), the INSERT
-- column grant of POST /api/orders (new columns default to NULL), existing
-- RPCs, guards, triggers and data.
--
-- Rollback: supabase/rollbacks/20261104120000_order_invoice_tracking_v1.sql

begin;

alter table public.orders
  add column if not exists invoice_required boolean,
  add column if not exists invoice_delivered boolean;

comment on column public.orders.invoice_required is
  'Requiere factura: true = Sí, false = No, NULL = Sin indicar. Only a recorded state; Gestcopy issues no invoice.';
comment on column public.orders.invoice_delivered is
  'Factura entregada: true/false only when invoice_required is true; NULL = Sin indicar or not applicable.';

alter table public.orders
  add constraint orders_invoice_delivered_requires_invoice
  check (invoice_delivered is not true or invoice_required is true);

create or replace function public.change_order_invoice_v1 (
  p_order_id          uuid,
  p_invoice_required  boolean,
  p_invoice_delivered boolean,
  p_tenant_id         uuid,
  p_expected_version  bigint
)
  returns jsonb
  language plpgsql
  set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_delivered boolean;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null or p_tenant_id is null then
    raise exception 'p_order_id and p_tenant_id are required'
      using errcode = '22023';
  end if;

  -- «Entregada: Sí» only makes sense when the order requires an invoice.
  if p_invoice_delivered is true and p_invoice_required is not true then
    raise exception 'invoice_delivered requires invoice_required'
      using errcode = '22023';
  end if;

  -- Not required or not indicated: delivery is not applicable.
  v_delivered := case when p_invoice_required is true then p_invoice_delivered else null end;

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

  -- Archived orders are read-only, also on idempotent no-op paths.
  if v_order.archived_at is not null then
    raise exception 'order is archived'
      using errcode = '42501';
  end if;

  if p_expected_version is null then
    raise exception 'p_expected_version is required'
      using errcode = '22023';
  end if;

  if v_order.row_version is distinct from p_expected_version then
    raise exception 'order has been modified since last read'
      using errcode = 'GCO01';
  end if;

  -- Same values: idempotent, no UPDATE.
  if (v_order.invoice_required, v_order.invoice_delivered)
     is not distinct from (p_invoice_required, v_delivered) then
    return pg_catalog.jsonb_build_object(
      'order',
      pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'invoice_required', v_order.invoice_required,
        'invoice_delivered', v_order.invoice_delivered
      )
    )
    || pg_catalog.jsonb_build_object('version', v_order.row_version::text);
  end if;

  perform pg_catalog.set_config('app.order_write', 'validated', true);
  update public.orders
  set
    invoice_required = p_invoice_required,
    invoice_delivered = v_delivered
  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_updated;

  if not found then
    raise exception 'could not update order'
      using errcode = 'P0001';
  end if;

  -- Clear the marker only after the FOUND check: PERFORM overwrites FOUND.
  perform pg_catalog.set_config('app.order_write', '', true);

  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'invoice_required', v_updated.invoice_required,
      'invoice_delivered', v_updated.invoice_delivered
    )
  )
  || pg_catalog.jsonb_build_object('version', v_updated.row_version::text);
end;
$function$;

comment on function public.change_order_invoice_v1(uuid, boolean, boolean, uuid, bigint) is
  'INVOKER. Records «Requiere factura» / «Factura entregada». Requires p_expected_version (GCO01 on stale rows); delivered is NULL unless required is true.';

revoke all on function public.change_order_invoice_v1(uuid, boolean, boolean, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.change_order_invoice_v1(uuid, boolean, boolean, uuid, bigint)
  to authenticated, postgres;

commit;
