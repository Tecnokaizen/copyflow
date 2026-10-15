-- Commercial operations v1: order totals, deposit ledger, quote internal notes,
-- contextual client activity. Economic source of truth is orders.total_amount
-- plus the sum of non-voided order_payments. payment_status_id stays a catalog
-- label and is not derived or overwritten here.
begin;

alter table public.orders
  add column total_amount numeric(20,2);

alter table public.orders
  add constraint orders_total_amount_nonnegative
  check (total_amount is null or total_amount >= 0);

comment on column public.orders.total_amount is
  'Operational order total. NULL means the amount is not defined yet. Money is numeric, never float. Economic truth is this column plus non-voided order_payments.';

comment on column public.orders.payment_status_id is
  'Tenant catalog label only. Not the source of truth for collected or pending amounts.';

create or replace function public.tg_orders_total_amount_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_paid numeric(20,2);
  v_allowed boolean := pg_catalog.current_setting('gestcopy.order_total_write', true) = '1';
begin
  if tg_op = 'INSERT' then
    if new.total_amount is not null and not v_allowed then
      raise exception 'total_amount_rpc_only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.total_amount is not distinct from old.total_amount then
    return new;
  end if;

  if not v_allowed then
    raise exception 'total_amount_rpc_only'
      using errcode = '42501';
  end if;

  select coalesce(pg_catalog.sum(p.amount), 0::numeric)::numeric(20,2)
    into v_paid
  from public.order_payments p
  where p.tenant_id = new.tenant_id
    and p.order_id = new.id
    and p.voided_at is null;

  if v_paid > 0 and (new.total_amount is null or new.total_amount < v_paid) then
    raise exception 'total_below_paid'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_orders_total_amount_guard on public.orders;
create trigger trg_orders_total_amount_guard
  before insert or update of total_amount on public.orders
  for each row
  execute function public.tg_orders_total_amount_guard();

revoke all on function public.tg_orders_total_amount_guard() from public, anon, authenticated, service_role;

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  amount numeric(20,2) not null,
  paid_at timestamptz not null,
  created_by uuid not null,
  idempotency_key text not null,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint order_payments_tenant_id_id_unique unique (tenant_id, id),
  constraint order_payments_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id),
  constraint order_payments_amount_positive check (amount > 0),
  constraint order_payments_idempotency_unique unique (tenant_id, order_id, idempotency_key),
  constraint order_payments_key_shape check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,80}$'),
  constraint order_payments_paid_at_finite check (isfinite(paid_at)),
  constraint order_payments_void_pair check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (
      voided_at is not null
      and voided_by is not null
      and void_reason is not null
      and pg_catalog.char_length(pg_catalog.btrim(void_reason)) between 1 and 500
    )
  )
);

comment on table public.order_payments is
  'Operational deposit ledger for an order. Rows are not deleted. Corrections void a movement. Valid collected amount is the sum of rows with voided_at is null.';

create index order_payments_order_idx
  on public.order_payments (tenant_id, order_id, created_at);

alter table public.order_payments enable row level security;

create policy order_payments_select_member
  on public.order_payments
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.order_payments from public, anon, authenticated, service_role;
grant select on public.order_payments to authenticated;

create or replace function public.tg_order_payments_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_paid numeric(20,2);
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('gestcopy.order_payments_purge', true) = '1' then
      return old;
    end if;
    raise exception 'order_payments_immutable'
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if old.voided_at is not null
       or new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.order_id is distinct from old.order_id
       or new.amount is distinct from old.amount
       or new.paid_at is distinct from old.paid_at
       or new.created_by is distinct from old.created_by
       or new.idempotency_key is distinct from old.idempotency_key
       or new.created_at is distinct from old.created_at
       or new.voided_at is null
       or new.voided_by is null
       or new.voided_by is distinct from auth.uid() then
      raise exception 'order_payment_immutable'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if new.created_by is distinct from auth.uid() or new.voided_at is not null then
    raise exception 'order_payment_actor'
      using errcode = '42501';
  end if;

  select *
    into v_order
  from public.orders
  where tenant_id = new.tenant_id
    and id = new.order_id
  for update;

  if not found then
    raise exception 'order_not_found'
      using errcode = 'P0002';
  end if;

  if v_order.archived_at is not null then
    raise exception 'order_archived'
      using errcode = '55000';
  end if;

  if v_order.total_amount is null then
    raise exception 'total_undefined'
      using errcode = 'P0001';
  end if;

  select coalesce(pg_catalog.sum(p.amount), 0::numeric)::numeric(20,2)
    into v_paid
  from public.order_payments p
  where p.tenant_id = new.tenant_id
    and p.order_id = new.order_id
    and p.voided_at is null;

  if v_paid + new.amount > v_order.total_amount then
    raise exception 'payment_exceeds_total'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_order_payments_guard on public.order_payments;
create trigger trg_order_payments_guard
  before insert or update or delete on public.order_payments
  for each row
  execute function public.tg_order_payments_guard();

revoke all on function public.tg_order_payments_guard() from public, anon, authenticated, service_role;

create or replace function public.tg_orders_purge_payments()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  perform pg_catalog.set_config('gestcopy.order_payments_purge', '1', true);
  delete from public.order_payments
  where tenant_id = old.tenant_id
    and order_id = old.id;
  perform pg_catalog.set_config('gestcopy.order_payments_purge', '', true);
  return old;
end;
$function$;

drop trigger if exists trg_orders_purge_payments on public.orders;
create trigger trg_orders_purge_payments
  before delete on public.orders
  for each row
  execute function public.tg_orders_purge_payments();

revoke all on function public.tg_orders_purge_payments() from public, anon, authenticated, service_role;

create or replace function public.order_money_text(p_amount numeric)
  returns text
  language sql
  immutable
  set search_path to ''
as $function$
  select case
    when p_amount is null then null
    else pg_catalog.trunc(p_amount)::text
      || '.'
      || pg_catalog.lpad(
        ((p_amount - pg_catalog.trunc(p_amount)) * 100)::integer::text,
        2,
        '0'
      )
  end;
$function$;

revoke all on function public.order_money_text(numeric) from public, anon, authenticated, service_role;

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

create or replace function public.order_collection_v1(p_order_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null or p_order_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where id = p_order_id;

  if not found or not public.is_tenant_member(v_order.tenant_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object('ok', true) || public.order_collection_snapshot(v_order);
end;
$function$;

revoke all on function public.order_collection_v1(uuid) from public, anon, service_role;
grant execute on function public.order_collection_v1(uuid) to authenticated;

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

create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount text,
  p_paid_at timestamptz,
  p_idempotency_key text
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
    if v_existing.amount = v_amount and v_existing.paid_at = p_paid_at then
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'replayed', true,
        'payment_id', v_existing.id
      ) || public.order_collection_snapshot(v_order);
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
  end if;

  insert into public.order_payments (
    tenant_id, order_id, amount, paid_at, created_by, idempotency_key
  ) values (
    v_order.tenant_id, v_order.id, v_amount, p_paid_at, auth.uid(), p_idempotency_key
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
      'paid_at', v_payment.paid_at
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
    if found and v_existing.amount = v_amount and v_existing.paid_at = p_paid_at then
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'replayed', true,
        'payment_id', v_existing.id
      ) || public.order_collection_snapshot(v_order);
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
  when sqlstate '23514' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'payment_exceeds_total');
  when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_undefined');
  when sqlstate '55000' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
end;
$function$;

revoke all on function public.record_order_payment(uuid, text, timestamptz, text) from public, anon, service_role;
grant execute on function public.record_order_payment(uuid, text, timestamptz, text) to authenticated;

create or replace function public.void_order_payment(
  p_payment_id uuid,
  p_reason text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_payment public.order_payments%rowtype;
  v_order public.orders%rowtype;
  v_reason text;
begin
  if auth.uid() is null or p_payment_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_payment
  from public.order_payments
  where id = p_payment_id;

  if not found or not public.is_tenant_member(v_payment.tenant_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where id = v_payment.order_id
    and tenant_id = v_payment.tenant_id
  for update;

  if not found then
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

  select *
    into v_payment
  from public.order_payments
  where id = p_payment_id
    and tenant_id = v_order.tenant_id
  for update;

  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));
  if pg_catalog.char_length(v_reason) < 1 or pg_catalog.char_length(v_reason) > 500 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  if v_payment.voided_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'already_voided');
  end if;

  update public.order_payments
  set voided_at = pg_catalog.now(),
      voided_by = auth.uid(),
      void_reason = v_reason
  where id = v_payment.id
    and tenant_id = v_payment.tenant_id
    and voided_at is null;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'already_voided');
  end if;

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    v_order.tenant_id,
    auth.uid(),
    'order.payment_voided',
    'order',
    v_order.id,
    pg_catalog.jsonb_build_object('amount', public.order_money_text(v_payment.amount)),
    pg_catalog.jsonb_build_object('voided', true),
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

  return pg_catalog.jsonb_build_object('ok', true, 'payment_id', v_payment.id)
    || public.order_collection_snapshot(v_order);
end;
$function$;

revoke all on function public.void_order_payment(uuid, text) from public, anon, service_role;
grant execute on function public.void_order_payment(uuid, text) to authenticated;

-- Conversion inherits the accepted version total exactly. Replay does not rewrite it.
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

alter table public.quotes
  add column internal_notes text;

alter table public.quotes
  add constraint quotes_internal_notes_length
  check (internal_notes is null or pg_catalog.char_length(internal_notes) <= 8000);

comment on column public.quotes.internal_notes is
  'Team-only notes. Not a commercial revision, not part of quote_versions, and not included in the customer PDF.';

comment on column public.quotes.notes is
  'Commercial terms shown to the customer. Distinct from internal_notes.';

revoke update (internal_notes) on public.quotes from authenticated, anon, public;

create or replace function public.tg_quote_internal_notes_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if tg_op = 'UPDATE'
     and new.internal_notes is distinct from old.internal_notes
     and pg_catalog.current_setting('gestcopy.quote_internal_notes', true) is distinct from '1' then
    raise exception 'internal_notes_rpc_only'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_quote_internal_notes_guard on public.quotes;
create trigger trg_quote_internal_notes_guard
  before update of internal_notes on public.quotes
  for each row
  execute function public.tg_quote_internal_notes_guard();

revoke all on function public.tg_quote_internal_notes_guard() from public, anon, authenticated, service_role;

create or replace function public.update_quote_internal_notes(
  p_quote_id uuid,
  p_notes text,
  p_expected_row_version text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_quote public.quotes%rowtype;
  v_notes text;
  v_updated public.quotes%rowtype;
begin
  if auth.uid() is null or p_quote_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_quote
  from public.quotes
  where id = p_quote_id
  for update;

  if not found
     or not public.has_tenant_role(
       v_quote.tenant_id,
       array['owner', 'admin', 'manager', 'staff']::text[]
     )
     or not public.tenant_has_feature(v_quote.tenant_id, 'quotes') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_expected_row_version is null
     or p_expected_row_version !~ '^[0-9]+$'
     or v_quote.row_version::text is distinct from p_expected_row_version then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'row_version', v_quote.row_version::text
    );
  end if;

  v_notes := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and pg_catalog.char_length(v_notes) > 8000 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_notes');
  end if;

  if v_notes is not distinct from v_quote.internal_notes then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'changed', false,
      'row_version', v_quote.row_version::text,
      'internal_notes', v_quote.internal_notes
    );
  end if;

  perform pg_catalog.set_config('gestcopy.quote_internal_notes', '1', true);

  update public.quotes
  set internal_notes = v_notes
  where id = v_quote.id
    and tenant_id = v_quote.tenant_id
  returning * into v_updated;

  perform pg_catalog.set_config('gestcopy.quote_internal_notes', '', true);

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    v_quote.tenant_id,
    auth.uid(),
    'quote.internal_notes_updated',
    'quote',
    v_quote.id,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'reference', v_quote.reference,
      'field', 'internal_notes'
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'changed', true,
    'row_version', v_updated.row_version::text,
    'internal_notes', v_updated.internal_notes
  );
end;
$function$;

comment on function public.update_quote_internal_notes(uuid, text, text) is
  'DEFINER: edits team-only notes without creating a commercial revision or copying the note body into activity_log.';

revoke all on function public.update_quote_internal_notes(uuid, text, text) from public, anon, service_role;
grant execute on function public.update_quote_internal_notes(uuid, text, text) to authenticated;

create or replace function public.list_client_activity(p_client_id uuid)
  returns table (
    id uuid,
    action text,
    entity_type text,
    entity_id uuid,
    user_id uuid,
    team_member_id uuid,
    previous_values jsonb,
    new_values jsonb,
    metadata jsonb,
    created_at timestamptz
  )
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null or p_client_id is null then
    raise exception 'not found'
      using errcode = 'P0002';
  end if;

  select c.tenant_id
    into v_tenant_id
  from public.clients c
  where c.id = p_client_id
    and public.is_tenant_member(c.tenant_id);

  if v_tenant_id is null then
    raise exception 'not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    al.id,
    al.action,
    al.entity_type,
    al.entity_id,
    al.user_id,
    al.team_member_id,
    al.previous_values,
    al.new_values,
    al.metadata,
    al.created_at
  from public.activity_log al
  where al.tenant_id = v_tenant_id
    and al.entity_type = 'client'
    and al.entity_id = p_client_id
  order by al.created_at asc, al.id asc;
end;
$function$;

comment on function public.list_client_activity(uuid) is
  'DEFINER: contextual history of one client. Same membership gate as list_order_activity. Does not return another tenant.';

revoke all on function public.list_client_activity(uuid) from public, anon, service_role;
grant execute on function public.list_client_activity(uuid) to authenticated;

create or replace function public.list_client_quotes(p_client_id uuid, p_page integer)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path to ''
as $function$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := 20;
  v_tenant uuid;
  v_total bigint;
  v_rows jsonb;
begin
  if auth.uid() is null or p_client_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select c.tenant_id
    into v_tenant
  from public.clients c
  where c.id = p_client_id
    and public.is_tenant_member(c.tenant_id);

  if v_tenant is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select count(*)
    into v_total
  from public.quotes q
  where q.tenant_id = v_tenant
    and q.client_id = p_client_id;

  select coalesce(pg_catalog.jsonb_agg(item.row order by item.created_at desc, item.id desc), '[]'::jsonb)
    into v_rows
  from (
    select
      q.created_at,
      q.id,
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'reference', q.reference,
        'status_name', s.name,
        'status_code', s.code,
        'total', pg_catalog.trunc(q.total)::text
          || '.'
          || pg_catalog.lpad(
            ((q.total - pg_catalog.trunc(q.total)) * 100)::integer::text,
            2,
            '0'
          ),
        'currency', q.currency,
        'issue_date', q.issue_date,
        'valid_until', q.valid_until,
        'created_at', q.created_at
      ) as row
    from public.quotes q
    join public.quote_statuses s
      on s.tenant_id = q.tenant_id
      and s.id = q.status_id
    where q.tenant_id = v_tenant
      and q.client_id = p_client_id
    order by q.created_at desc, q.id desc
    limit v_size
    offset (v_page - 1) * v_size
  ) item;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'page', v_page,
    'page_size', v_size,
    'total', v_total,
    'has_more', v_page * v_size < v_total,
    'quotes', v_rows
  );
end;
$function$;

comment on function public.list_client_quotes(uuid, integer) is
  'INVOKER: quotes of one client through existing quotes RLS. Page size 20. total is the full count, never a silent truncation.';

revoke all on function public.list_client_quotes(uuid, integer) from public, anon, service_role;
grant execute on function public.list_client_quotes(uuid, integer) to authenticated;

commit;
