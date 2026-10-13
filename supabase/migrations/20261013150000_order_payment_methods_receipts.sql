-- P1 payment methods and private receipts. Forward-only: historical NULL means
-- "Sin especificar (histórico)"; never infer a method for existing money movements.
-- Normal tenant access uses authenticated JWT/memberships/RLS; no service role.
begin;

alter table public.order_files
  add constraint order_files_tenant_order_id_unique unique (tenant_id, order_id, id);
alter table public.order_payments
  add column payment_method text,
  add column receipt_file_id uuid,
  add constraint order_payments_method_check check (
    payment_method is null or payment_method in ('cash', 'card', 'bizum', 'transfer', 'other')
  ),
  add constraint order_payments_receipt_fk foreign key (tenant_id, order_id, receipt_file_id)
    references public.order_files (tenant_id, order_id, id),
  add constraint order_payments_receipt_unique unique (tenant_id, receipt_file_id);
comment on column public.order_payments.payment_method is
  'NULL only for pre-migration historical payments. Every new payment requires a method.';
comment on column public.order_payments.receipt_file_id is
  'Optional private R2 order_file. Immutable and retained after voiding.';

create or replace function public.tg_order_payment_details_guard()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if tg_op = 'UPDATE' then
    if new.payment_method is distinct from old.payment_method
      or new.receipt_file_id is distinct from old.receipt_file_id then
      raise exception 'order_payment_immutable' using errcode = '55000';
    end if;
    -- A historical row may keep payment_method NULL. Voiding changes only
    -- voided_at, voided_by and void_reason, and must remain possible.
    return new;
  end if;
  if tg_op = 'INSERT' and new.payment_method is null then
    raise exception 'invalid_payment_method' using errcode = '23514';
  end if;
  if new.receipt_file_id is not null then
    perform 1 from public.order_files
    where id = new.receipt_file_id and tenant_id = new.tenant_id
      and order_id = new.order_id and status = 'ready' and deleted_at is null
      and uploaded_by = auth.uid()
    for update;
    if not found then
      raise exception 'invalid_receipt' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;
create trigger trg_order_payment_details_guard before insert or update on public.order_payments
  for each row execute function public.tg_order_payment_details_guard();
revoke all on function public.tg_order_payment_details_guard() from public, anon, authenticated, service_role;

-- DB defense in depth, including privileged metadata mutations.
create or replace function public.tg_order_file_receipt_guard()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if exists(select 1 from public.order_payments
    where tenant_id = old.tenant_id and receipt_file_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'payment_receipt_protected' using errcode = '55000';
    end if;
    if new.deleted_at is distinct from old.deleted_at
      or new.status is distinct from old.status
      or new.original_name is distinct from old.original_name
      or new.content_type is distinct from old.content_type
      or new.size_bytes is distinct from old.size_bytes
      or new.etag is distinct from old.etag then
      raise exception 'payment_receipt_protected' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
create trigger trg_order_file_receipt_guard before update or delete on public.order_files
  for each row execute function public.tg_order_file_receipt_guard();
revoke all on function public.tg_order_file_receipt_guard() from public, anon, authenticated, service_role;

-- Retire the old contract. An in-flight tab may retry a payment that was
-- already stored; that retry replays and does not insert. A new call cannot
-- create money without a method.
create or replace function public.record_order_payment(
  p_order_id uuid, p_amount text, p_paid_at timestamptz, p_idempotency_key text
) returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_amount numeric(20,2);
  v_existing public.order_payments%rowtype;
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

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:_-]{8,80}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;

  v_amount := null;
  if p_amount is not null and p_amount ~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,2})?$' then
    v_amount := p_amount::numeric(20,2);
  end if;

  select *
    into v_existing
  from public.order_payments
  where tenant_id = v_order.tenant_id
    and order_id = v_order.id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_amount is not null and v_existing.amount = v_amount and v_existing.paid_at = p_paid_at then
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'replayed', true,
        'payment_id', v_existing.id
      ) || public.order_collection_snapshot(v_order);
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
  end if;

  return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
end;
$function$;
revoke all on function public.record_order_payment(uuid, text, timestamptz, text) from public, anon, service_role;
grant execute on function public.record_order_payment(uuid, text, timestamptz, text) to authenticated;

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
        'void_reason', p.void_reason,
        'payment_method', p.payment_method,
        'receipt', case when f.id is not null then pg_catalog.jsonb_build_object(
          'id', f.id, 'original_name', f.original_name
        ) else null end
      ) as payload,
      p.paid_at,
      p.created_at
    from public.order_payments p
    left join public.order_files f on f.id = p.receipt_file_id
      and f.tenant_id = p.tenant_id and f.order_id = p.order_id
      and f.status = 'ready' and f.deleted_at is null
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

create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount text,
  p_paid_at timestamptz,
  p_idempotency_key text,
  p_payment_method text,
  p_receipt_file_id uuid,
  p_tenant_id uuid
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_amount numeric(20,2);
  v_existing public.order_payments%rowtype;
  v_payment public.order_payments%rowtype;
begin
  if auth.uid() is null or p_order_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where id = p_order_id and tenant_id = p_tenant_id
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

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:_-]{8,80}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;

  if p_amount is null or p_amount !~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,2})?$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_amount := p_amount::numeric(20,2);
  if v_amount <= 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_paid_at is null or not pg_catalog.isfinite(p_paid_at)
     or p_paid_at < timestamptz '2000-01-01'
     or p_paid_at > pg_catalog.now() + interval '1 day' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_paid_at');
  end if;

  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'bizum', 'transfer', 'other') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  end if;

  if v_order.total_amount is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_undefined');
  end if;

  select *
    into v_existing
  from public.order_payments
  where tenant_id = v_order.tenant_id
    and order_id = v_order.id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.amount = v_amount and v_existing.paid_at = p_paid_at
       and v_existing.payment_method = p_payment_method
       and v_existing.receipt_file_id is not distinct from p_receipt_file_id then
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'replayed', true,
        'payment_id', v_existing.id
      ) || public.order_collection_snapshot(v_order);
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
  end if;

  -- Lock the order first, then the file. Deletion uses the same lock order.
  if p_receipt_file_id is not null then
    perform 1 from public.order_files
    where id = p_receipt_file_id and tenant_id = v_order.tenant_id
      and order_id = v_order.id and status = 'ready' and deleted_at is null
      and uploaded_by = auth.uid()
    for update;
    if not found then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_receipt');
    end if;
    if exists(select 1 from public.order_payments
      where tenant_id = v_order.tenant_id and receipt_file_id = p_receipt_file_id) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'receipt_already_used');
    end if;
  end if;

  insert into public.order_payments (
    tenant_id, order_id, amount, paid_at, created_by, idempotency_key, payment_method, receipt_file_id
  ) values (
    v_order.tenant_id, v_order.id, v_amount, p_paid_at, auth.uid(), p_idempotency_key, p_payment_method, p_receipt_file_id
  )
  returning * into v_payment;

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    v_order.tenant_id,
    auth.uid(),
    'order.payment_recorded',
    'order',
    v_order.id,
    null,
    pg_catalog.jsonb_build_object(
      'amount', public.order_money_text(v_payment.amount),
      'paid_at', v_payment.paid_at,
      'payment_method', v_payment.payment_method,
      'receipt_file_id', v_payment.receipt_file_id
    ),
    pg_catalog.jsonb_build_object(
      'reference', v_order.reference,
      'payment_id', v_payment.id,
      'field', 'payment'
    )
  );

  select *
    into v_order
  from public.orders
  where id = v_order.id
    and tenant_id = v_order.tenant_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'payment_id', v_payment.id
  ) || public.order_collection_snapshot(v_order);
exception
  when unique_violation then
    select *
      into v_existing
    from public.order_payments
    where tenant_id = v_order.tenant_id
      and order_id = v_order.id
      and idempotency_key = p_idempotency_key;
    if found and v_existing.amount = v_amount and v_existing.paid_at = p_paid_at
       and v_existing.payment_method = p_payment_method
       and v_existing.receipt_file_id is not distinct from p_receipt_file_id then
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'replayed', true,
        'payment_id', v_existing.id
      ) || public.order_collection_snapshot(v_order);
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
  when sqlstate '23514' then
    if sqlerrm = 'invalid_payment_method' then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
    end if;
    if sqlerrm = 'payment_exceeds_total' then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'payment_exceeds_total');
    end if;
    raise;
  when sqlstate 'P0001' then
    if sqlerrm = 'invalid_receipt' then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_receipt');
    end if;
    if sqlerrm = 'total_undefined' then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_undefined');
    end if;
    raise;
  when sqlstate '55000' then
    if sqlerrm = 'order_archived' then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
    end if;
    raise;
end;
$function$;
revoke all on function public.record_order_payment(uuid, text, timestamptz, text, text, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.record_order_payment(uuid, text, timestamptz, text, text, uuid, uuid)
  to authenticated;

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
  WHERE id = p_order_id
  FOR UPDATE;

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

  IF v_file.deleted_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id,
      'storage_key', v_file.storage_key,
      'replay', true
    );
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_payments
    WHERE tenant_id = v_order.tenant_id AND receipt_file_id = p_file_id) THEN
    RAISE EXCEPTION 'payment_receipt_protected' USING ERRCODE = '55000';
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
    RETURN pg_catalog.jsonb_build_object(
      'id', v_file.id,
      'storage_key', v_file.storage_key,
      'replay', true
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id,
    'storage_key', v_updated.storage_key,
    'replay', false
  );
END;
$function$;
-- Metadata deletion is committed before deleting the blob in R2. Replay allows
-- a failed R2 deletion to be retried while attachment to a payment is blocked.
comment on function public.soft_delete_order_file(uuid, uuid, bigint, text) is
  'Order/file locks serialize with payment insertion. Receipts protected even when voided. API deletes metadata before R2.';
commit;
