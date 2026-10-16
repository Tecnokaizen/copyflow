-- Rollback for 20261016090000_order_total_validation_p1.sql and
-- 20261016091000_order_payment_methods_receipts_expand.sql (PR #95 expand).
--
-- Use only if the expand itself must be withdrawn BEFORE the new app records any
-- payment with a method or a receipt (for example, migrations applied and the
-- previous app misbehaving). Rolling back the APPLICATION alone does not need
-- this script: the previous app works on the expanded schema.
--
-- What it does:
--   * refuses to run if any payment has payment_method or receipt_file_id;
--     from that point recovery is forward-only and the ledger is preserved;
--   * drops the receipt guards and the 7-argument record_order_payment;
--   * restores order_collection_snapshot and set_order_total_amount
--     (20261007190056) and soft_delete_order_file (20261014120000, with the R2
--     deletion outbox of #96), with their grants and comment;
--   * drops the new constraints and the two nullable columns.
-- Verified on a database with main + #95: afterwards functions, grants,
-- columns, constraints, triggers and comments equal those of main.
-- Then: supabase migration repair --status reverted 20261016091000 20261016090000
begin;
do $guard$
begin
  if exists (select 1 from public.order_payments where payment_method is not null or receipt_file_id is not null) then
    raise exception 'rollback_95_refused: payments with method or receipt exist; recover forward';
  end if;
end;
$guard$;

drop trigger if exists trg_order_payment_details_guard on public.order_payments;
drop function if exists public.tg_order_payment_details_guard();
drop trigger if exists trg_order_file_receipt_guard on public.order_files;
drop function if exists public.tg_order_file_receipt_guard();
drop function if exists public.record_order_payment(uuid, text, timestamptz, text, text, uuid, uuid);

create or replace function public.order_collection_snapshot(p_order public.orders)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path to ''
as $function$
declare
  v_paid numeric(20,2);
  v_rows jsonb;
begin
  select coalesce(pg_catalog.sum(p.amount), 0::numeric)::numeric(20,2)
    into v_paid
  from public.order_payments p
  where p.tenant_id = p_order.tenant_id
    and p.order_id = p_order.id
    and p.voided_at is null;

  select coalesce(
    pg_catalog.jsonb_agg(rows.payload order by rows.paid_at, rows.created_at),
    '[]'::jsonb
  )
    into v_rows
  from (
    select
      pg_catalog.jsonb_build_object(
        'id', p.id,
        'amount', public.order_money_text(p.amount),
        'paid_at', p.paid_at,
        'created_at', p.created_at,
        'created_by', p.created_by,
        'voided_at', p.voided_at,
        'voided_by', p.voided_by,
        'void_reason', p.void_reason
      ) as payload,
      p.paid_at,
      p.created_at
    from public.order_payments p
    where p.tenant_id = p_order.tenant_id
      and p.order_id = p_order.id
  ) rows;

  return pg_catalog.jsonb_build_object(
    'total_amount', public.order_money_text(p_order.total_amount),
    'paid_amount', public.order_money_text(v_paid),
    'pending_amount', case
      when p_order.total_amount is null then null
      else public.order_money_text(p_order.total_amount - v_paid)
    end,
    'collection_state', case
      when p_order.total_amount is null then 'undefined'
      when v_paid = 0 then 'unpaid'
      when v_paid = p_order.total_amount then 'paid'
      else 'partial'
    end,
    'row_version', p_order.row_version::text,
    'payments', v_rows
  );
end;
$function$;

revoke all on function public.order_collection_snapshot(public.orders) from public, anon, authenticated, service_role;

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
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_below_paid');
end;
$function$;

revoke all on function public.set_order_total_amount(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_order_total_amount(uuid, text, text) to authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_order_file(
  p_order_id uuid,
  p_file_id uuid,
  p_issued_at bigint,
  p_signature text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_file public.order_files%ROWTYPE;
  v_updated public.order_files%ROWTYPE;
  v_not_before timestamptz;
  v_deletion_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF p_order_id IS NULL
     OR p_file_id IS NULL
     OR p_issued_at IS NULL
     OR p_signature IS NULL
  THEN
    RAISE EXCEPTION 'required arguments missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_tenant_role(
    v_order.tenant_id,
    ARRAY['owner', 'admin', 'manager', 'staff']::text[]
  ) THEN
    RAISE EXCEPTION 'tenant access denied'
      USING ERRCODE = '42501';
  END IF;

  IF v_order.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'order is archived'
      USING ERRCODE = '42501';
  END IF;

  IF NOT files_private.verify_files_capability(
    'delete',
    v_user_id,
    v_order.tenant_id,
    p_order_id,
    p_file_id,
    p_issued_at,
    p_signature
  ) THEN
    RAISE EXCEPTION 'invalid capability'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_file
  FROM public.order_files
  WHERE id = p_file_id
    AND order_id = p_order_id
    AND tenant_id = v_order.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'file not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- A pending upload may still receive a PUT until its presign expires.
  v_not_before := CASE
    WHEN v_file.status = 'pending'
      THEN v_file.upload_expires_at + interval '5 minutes'
    ELSE pg_catalog.now()
  END;

  IF v_file.deleted_at IS NOT NULL THEN
    v_deletion_id := files_private.enqueue_storage_deletion(
      'order', v_file.tenant_id, v_file.order_id, v_file.id,
      v_file.storage_key, 'user_delete', v_file.deleted_by, v_not_before
    );

    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id,
      'storage_key', v_file.storage_key,
      'replay', true,
      'storage_deletion_id', v_deletion_id
    );
  END IF;

  PERFORM pg_catalog.set_config('app.order_file_action', 'delete', true);

  UPDATE public.order_files
  SET
    deleted_at = pg_catalog.now(),
    deleted_by = v_user_id
  WHERE id = v_file.id
    AND tenant_id = v_file.tenant_id
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not delete file'
      USING ERRCODE = 'P0001';
  END IF;

  v_deletion_id := files_private.enqueue_storage_deletion(
    'order', v_updated.tenant_id, v_updated.order_id, v_updated.id,
    v_updated.storage_key, 'user_delete', v_user_id, v_not_before
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id,
    'storage_key', v_updated.storage_key,
    'replay', false,
    'storage_deletion_id', v_deletion_id
  );
END;
$function$;

COMMENT ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text) IS
  'Controlled soft-delete. HMAC capability + marker. Idempotent. Enqueues the R2 deletion in the same transaction; never touches R2.';

REVOKE ALL ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_order_file(uuid, uuid, bigint, text)
  TO authenticated, postgres;


alter table public.order_payments
  drop constraint if exists order_payments_receipt_unique,
  drop constraint if exists order_payments_receipt_fk,
  drop constraint if exists order_payments_method_check,
  drop column if exists receipt_file_id,
  drop column if exists payment_method;
alter table public.order_files
  drop constraint if exists order_files_tenant_order_id_unique;

commit;
