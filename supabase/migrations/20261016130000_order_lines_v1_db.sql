-- Order Lines V1 · PR A — database layer (ADR #104).
--
-- Adds order lines (public.order_items), the order-level columns that describe
-- how orders.total_amount is obtained, the integrity guards and the single
-- write path replace_order_items_v1. Additive only: no existing order changes
-- (every new column defaults to 'manual' / false / 0, total_amount is untouched).
--
-- Economic model
--   * orders.total_amount stays THE operational amount used by collections
--     (order_payments, total_below_paid, payment_exceeds_total) and invoicing.
--   * total_mode = 'manual' (default): today's behaviour. Lines never change
--     total_amount; items_* are informational.
--   * total_mode = 'items': total_amount is DERIVED (= items_total). It cannot be
--     written by set_order_total_amount nor by a direct UPDATE; only the lines
--     write path can, atomically, and tg_orders_total_amount_guard keeps
--     enforcing total_below_paid on that same UPDATE.
--   * Line amounts reuse public.quote_line_amounts_v1 (same rounding and
--     VAT-included/excluded rules as quotes). prices_include_tax lives on the
--     order, like quote_versions.prices_include_tax.
--
-- Performance: per line the BEFORE ROW guard does O(1) work (one primary-key
-- lookup + the pure amount function). The order aggregate is NOT recomputed per
-- line: replace_order_items_v1 runs DELETE + INSERT with the aggregate trigger
-- muted and refreshes the order once (one aggregate query, one UPDATE). The
-- statement-level AFTER triggers (transition tables) keep the aggregate correct
-- for any other writer: once per statement, never once per row.
--
-- Write path: authenticated gets SELECT only. Every write needs the
-- transaction-local flag gestcopy.order_items_write = '1', which only the
-- SECURITY DEFINER functions below set.
--
-- Not touched: quotes, convert_quote_to_order (PR B), record_order_payment,
-- void_order_payment, tg_orders_total_amount_guard, Kiosk, UI.
-- Depends on 20261016123500_order_total_guard_null_bypass (P0 hotfix): this migration
-- relies on the NULL-safe flag handling of tg_orders_total_amount_guard and refuses
-- to run without it (precondition below). It does not redefine that guard.
-- Rollback: supabase/rollbacks/20261016130000_order_lines_v1_db.sql
begin;

-- Precondition: the total guard must be the NULL-safe version (P0 hotfix
-- 20261016123500). Items mode relies on `NULL = not allowed`; without it a fresh
-- connection could skip total_amount_rpc_only and total_below_paid.
do $precondition$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = 'public.tg_orders_total_amount_guard()'::pg_catalog.regprocedure
      and p.prosrc like '%coalesce(%order_total_write%'
  ) then
    raise exception 'Order Lines V1 requires 20261016123500_order_total_guard_null_bypass to be applied first';
  end if;
end
$precondition$;

-- ---------------------------------------------------------------------------
-- 1. Order-level columns
-- ---------------------------------------------------------------------------
alter table public.orders
  add column total_mode text not null default 'manual',
  add column prices_include_tax boolean not null default false,
  add column items_subtotal numeric(20,2) not null default 0,
  add column items_tax_total numeric(20,2) not null default 0,
  add column items_total numeric(20,2) not null default 0;

alter table public.orders
  add constraint orders_total_mode_check
    check (total_mode in ('manual', 'items')),
  add constraint orders_items_amounts_nonnegative
    check (items_subtotal >= 0 and items_tax_total >= 0 and items_total >= 0),
  add constraint orders_items_mode_total
    check (total_mode = 'manual' or (total_amount is not null and total_amount = items_total));

comment on column public.orders.total_mode is
  'How total_amount is obtained. manual: set by set_order_total_amount (legacy behaviour). items: derived from order_items (= items_total), read-only for manual writes.';
comment on column public.orders.prices_include_tax is
  'VAT-included (true) or VAT-excluded (false) unit prices for every order line. Same meaning as quote_versions.prices_include_tax.';
comment on column public.orders.items_subtotal is
  'Sum of order_items.subtotal. Informational when total_mode = manual.';
comment on column public.orders.items_tax_total is
  'Sum of order_items.tax_amount. Informational when total_mode = manual.';
comment on column public.orders.items_total is
  'Sum of order_items.total. Equals total_amount when total_mode = items.';

-- ---------------------------------------------------------------------------
-- 2. Lines
-- ---------------------------------------------------------------------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  position integer not null check (position > 0),
  concept text not null
    check (pg_catalog.char_length(pg_catalog.btrim(concept)) > 0 and pg_catalog.char_length(concept) <= 500),
  description text check (description is null or pg_catalog.char_length(description) <= 5000),
  quantity numeric(18,6) not null check (quantity > 0),
  unit text check (unit is null or pg_catalog.char_length(unit) <= 40),
  unit_price numeric(18,6) not null check (unit_price >= 0),
  discount_percent numeric(9,6) not null default 0 check (discount_percent between 0 and 100),
  tax_rate numeric(9,6) not null default 0 check (tax_rate between 0 and 100),
  subtotal numeric(20,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(20,2) not null default 0 check (tax_amount >= 0),
  total numeric(20,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default pg_catalog.now(),
  constraint order_items_order_fk
    foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  constraint order_items_position_unique unique (tenant_id, order_id, position),
  constraint order_items_finite check (quantity <> 'NaN'::numeric and unit_price <> 'NaN'::numeric)
);

comment on table public.order_items is
  'Order lines. Amounts are computed by the database (quote_line_amounts_v1), never accepted from clients. Written only by replace_order_items_v1.';

alter table public.order_items enable row level security;

create policy order_items_select_member
  on public.order_items
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.order_items from public, anon, authenticated, service_role;
grant select on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row guard: O(1) per line
-- ---------------------------------------------------------------------------
create or replace function public.tg_order_item_guard_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_order_id uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_inclusive boolean;
  v_archived timestamptz;
begin
  -- Deleting the order itself purges its lines (see tg_orders_purge_items_v1).
  if tg_op = 'DELETE'
     and pg_catalog.current_setting('gestcopy.order_items_purge', true) = '1' then
    return old;
  end if;

  if pg_catalog.current_setting('gestcopy.order_items_write', true) is distinct from '1' then
    raise exception 'order_items_rpc_only'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (new.id, new.tenant_id, new.order_id, new.created_at)
       is distinct from (old.id, old.tenant_id, old.order_id, old.created_at) then
    raise exception 'immutable_identity'
      using errcode = '55000';
  end if;

  select o.prices_include_tax, o.archived_at
    into v_inclusive, v_archived
  from public.orders o
  where o.tenant_id = v_tenant
    and o.id = v_order_id;

  if not found then
    raise exception 'order_not_found'
      using errcode = 'P0002';
  end if;

  if v_archived is not null then
    raise exception 'order_archived'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select a.subtotal, a.tax_amount, a.total
    into new.subtotal, new.tax_amount, new.total
  from public.quote_line_amounts_v1(
    new.quantity, new.unit_price, new.discount_percent, new.tax_rate, v_inclusive
  ) a;

  return new;
end;
$function$;

drop trigger if exists trg_order_items_guard on public.order_items;
create trigger trg_order_items_guard
  before insert or update or delete on public.order_items
  for each row
  execute function public.tg_order_item_guard_v1();

-- ---------------------------------------------------------------------------
-- 4. Aggregate refresh: one aggregate query + one UPDATE per order
-- ---------------------------------------------------------------------------
create or replace function public.order_items_refresh_totals_v1(
  p_tenant_id uuid,
  p_order_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_subtotal numeric(20,2);
  v_tax numeric(20,2);
  v_total numeric(20,2);
  v_prev_items text := pg_catalog.current_setting('gestcopy.order_items_write', true);
  v_prev_total text := pg_catalog.current_setting('gestcopy.order_total_write', true);
begin
  select
    coalesce(pg_catalog.sum(i.subtotal), 0::numeric)::numeric(20,2),
    coalesce(pg_catalog.sum(i.tax_amount), 0::numeric)::numeric(20,2),
    coalesce(pg_catalog.sum(i.total), 0::numeric)::numeric(20,2)
    into v_subtotal, v_tax, v_total
  from public.order_items i
  where i.tenant_id = p_tenant_id
    and i.order_id = p_order_id;

  perform pg_catalog.set_config('gestcopy.order_items_write', '1', true);
  perform pg_catalog.set_config('gestcopy.order_total_write', '1', true);

  -- In items mode total_amount follows items_total; tg_orders_total_amount_guard
  -- raises total_below_paid on this very UPDATE when collections exceed it.
  update public.orders o
  set items_subtotal = v_subtotal,
      items_tax_total = v_tax,
      items_total = v_total,
      total_amount = case when o.total_mode = 'items' then v_total else o.total_amount end
  where o.tenant_id = p_tenant_id
    and o.id = p_order_id
    and (
      (o.items_subtotal, o.items_tax_total, o.items_total)
        is distinct from (v_subtotal, v_tax, v_total)
      or (o.total_mode = 'items' and o.total_amount is distinct from v_total)
    );

  perform pg_catalog.set_config('gestcopy.order_items_write', coalesce(v_prev_items, ''), true);
  perform pg_catalog.set_config('gestcopy.order_total_write', coalesce(v_prev_total, ''), true);
end;
$function$;

-- Statement-level: runs once per INSERT/UPDATE/DELETE statement, never per row.
create or replace function public.tg_order_items_rollup_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  r record;
begin
  -- replace_order_items_v1 refreshes the order once, itself. A purge deletes the
  -- order, so there is nothing left to refresh.
  if pg_catalog.current_setting('gestcopy.order_items_bulk', true) = '1'
     or pg_catalog.current_setting('gestcopy.order_items_purge', true) = '1' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    for r in select distinct t.tenant_id, t.order_id from new_rows t loop
      perform public.order_items_refresh_totals_v1(r.tenant_id, r.order_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for r in select distinct t.tenant_id, t.order_id from old_rows t loop
      perform public.order_items_refresh_totals_v1(r.tenant_id, r.order_id);
    end loop;
  else
    for r in
      select t.tenant_id, t.order_id from new_rows t
      union
      select t.tenant_id, t.order_id from old_rows t
    loop
      perform public.order_items_refresh_totals_v1(r.tenant_id, r.order_id);
    end loop;
  end if;

  return null;
end;
$function$;

-- Transition tables cannot be shared by several events: one trigger per event.
drop trigger if exists trg_order_items_rollup_ins on public.order_items;
create trigger trg_order_items_rollup_ins
  after insert on public.order_items
  referencing new table as new_rows
  for each statement
  execute function public.tg_order_items_rollup_v1();

drop trigger if exists trg_order_items_rollup_upd on public.order_items;
create trigger trg_order_items_rollup_upd
  after update on public.order_items
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.tg_order_items_rollup_v1();

drop trigger if exists trg_order_items_rollup_del on public.order_items;
create trigger trg_order_items_rollup_del
  after delete on public.order_items
  referencing old table as old_rows
  for each statement
  execute function public.tg_order_items_rollup_v1();

-- ---------------------------------------------------------------------------
-- 5. Orders: new columns are write-protected (authenticated has table-level
--    INSERT/UPDATE on orders, so a column grant alone would not hold).
-- ---------------------------------------------------------------------------
create or replace function public.tg_orders_items_guard_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  -- A never-set custom GUC is NULL: NULL must mean "not allowed", never "skip the check".
  v_allowed boolean := coalesce(pg_catalog.current_setting('gestcopy.order_items_write', true) = '1', false);
begin
  if tg_op = 'INSERT' then
    if (new.total_mode, new.prices_include_tax, new.items_subtotal, new.items_tax_total, new.items_total)
         is distinct from ('manual'::text, false, 0::numeric, 0::numeric, 0::numeric)
       and not v_allowed then
      raise exception 'order_items_columns_rpc_only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.total_mode, new.prices_include_tax, new.items_subtotal, new.items_tax_total, new.items_total)
       is distinct from
     (old.total_mode, old.prices_include_tax, old.items_subtotal, old.items_tax_total, old.items_total)
     and not v_allowed then
    raise exception 'order_items_columns_rpc_only'
      using errcode = '42501';
  end if;

  -- VAT mode changes the amount of every existing line.
  if new.prices_include_tax is distinct from old.prices_include_tax
     and exists (
       select 1 from public.order_items i
       where i.tenant_id = old.tenant_id and i.order_id = old.id
     ) then
    raise exception 'replace_items_before_tax_mode'
      using errcode = '55000';
  end if;

  -- Items mode: total_amount is derived and only the lines write path may move it.
  if new.total_mode = 'items'
     and new.total_amount is distinct from old.total_amount
     and not v_allowed then
    raise exception 'total_amount_items_mode'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_orders_items_guard on public.orders;
create trigger trg_orders_items_guard
  before insert or update of total_mode, prices_include_tax, items_subtotal, items_tax_total, items_total, total_amount
  on public.orders
  for each row
  execute function public.tg_orders_items_guard_v1();

-- Purging an order (tenant removal, admin) removes its lines, like its payments.
create or replace function public.tg_orders_purge_items_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  perform pg_catalog.set_config('gestcopy.order_items_purge', '1', true);
  delete from public.order_items
  where tenant_id = old.tenant_id
    and order_id = old.id;
  perform pg_catalog.set_config('gestcopy.order_items_purge', '', true);
  return old;
end;
$function$;

drop trigger if exists trg_orders_purge_items on public.orders;
create trigger trg_orders_purge_items
  before delete on public.orders
  for each row
  execute function public.tg_orders_purge_items_v1();

-- ---------------------------------------------------------------------------
-- 6. Payload validation (pure)
-- ---------------------------------------------------------------------------
-- Returns the offending field name, or NULL when the line is valid.
create or replace function public.order_item_payload_error_v1(p_item jsonb)
  returns text
  language sql
  immutable
  set search_path to ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(p_item) is distinct from 'object' then 'item'
    when exists (
      select 1 from pg_catalog.jsonb_object_keys(p_item) k
      where k <> all (array['concept', 'description', 'quantity', 'unit', 'unit_price', 'discount_percent', 'tax_rate'])
    ) then 'unknown_field'
    when pg_catalog.jsonb_typeof(p_item -> 'concept') is distinct from 'string'
      or pg_catalog.char_length(pg_catalog.btrim(p_item ->> 'concept')) not between 1 and 500 then 'concept'
    when pg_catalog.jsonb_typeof(p_item -> 'description') not in ('string', 'null')
      or pg_catalog.char_length(coalesce(p_item ->> 'description', '')) > 5000 then 'description'
    when pg_catalog.jsonb_typeof(p_item -> 'unit') not in ('string', 'null')
      or pg_catalog.char_length(coalesce(p_item ->> 'unit', '')) > 40 then 'unit'
    when pg_catalog.jsonb_typeof(p_item -> 'quantity') not in ('string', 'number')
      or (p_item ->> 'quantity') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
      or case when (p_item ->> 'quantity') ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
           then (p_item ->> 'quantity')::numeric <= 0 else true end then 'quantity'
    when pg_catalog.jsonb_typeof(p_item -> 'unit_price') not in ('string', 'number')
      or (p_item ->> 'unit_price') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' then 'unit_price'
    when pg_catalog.jsonb_typeof(p_item -> 'discount_percent') not in ('string', 'number', 'null')
      or coalesce(p_item ->> 'discount_percent', '0') !~ '^(100(\.0{1,6})?|[0-9]{1,2}(\.[0-9]{1,6})?)$' then 'discount_percent'
    when pg_catalog.jsonb_typeof(p_item -> 'tax_rate') not in ('string', 'number', 'null')
      or coalesce(p_item ->> 'tax_rate', '0') !~ '^(100(\.0{1,6})?|[0-9]{1,2}(\.[0-9]{1,6})?)$' then 'tax_rate'
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. replace_order_items_v1: the only write path for lines
-- ---------------------------------------------------------------------------
-- Full replacement, like save_quote_draft_v1. p_total_mode / p_prices_include_tax
-- NULL keep the current value. p_expected_row_version is text (same contract as
-- set_order_total_amount; avoids JS bigint precision loss).
create or replace function public.replace_order_items_v1(
  p_order_id uuid,
  p_expected_row_version text,
  p_items jsonb,
  p_total_mode text default null,
  p_prices_include_tax boolean default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_mode text;
  v_inclusive boolean;
  v_count integer;
  v_bad_index integer;
  v_bad_field text;
  v_subtotal numeric(20,2);
  v_tax numeric(20,2);
  v_total numeric(20,2);
  v_lines jsonb;
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

  v_mode := coalesce(p_total_mode, v_order.total_mode);
  v_inclusive := coalesce(p_prices_include_tax, v_order.prices_include_tax);

  if v_mode not in ('manual', 'items') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_total_mode');
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  v_count := pg_catalog.jsonb_array_length(p_items);

  if v_count > 500 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'too_many_items');
  end if;

  select x.n::integer, public.order_item_payload_error_v1(x.j)
    into v_bad_index, v_bad_field
  from pg_catalog.jsonb_array_elements(p_items) with ordinality as x(j, n)
  where public.order_item_payload_error_v1(x.j) is not null
  order by x.n
  limit 1;

  if v_bad_field is not null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'invalid_items',
      'index', v_bad_index - 1,
      'field', v_bad_field
    );
  end if;

  -- Items mode derives total_amount from the lines: it needs at least one,
  -- otherwise the order total would silently become 0.
  if v_mode = 'items' and v_count = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'items_required');
  end if;

  begin
    perform pg_catalog.set_config('gestcopy.order_items_write', '1', true);
    perform pg_catalog.set_config('gestcopy.order_items_bulk', '1', true);
    perform pg_catalog.set_config('gestcopy.order_total_write', '1', true);

    delete from public.order_items
    where tenant_id = v_order.tenant_id
      and order_id = v_order.id;

    -- Only after the old lines are gone: the VAT mode changes every line amount.
    if v_inclusive is distinct from v_order.prices_include_tax then
      update public.orders
      set prices_include_tax = v_inclusive
      where id = v_order.id
        and tenant_id = v_order.tenant_id;
    end if;

    insert into public.order_items (
      tenant_id, order_id, position, concept, description,
      quantity, unit, unit_price, discount_percent, tax_rate
    )
    select
      v_order.tenant_id,
      v_order.id,
      x.n::integer,
      pg_catalog.btrim(x.j ->> 'concept'),
      nullif(x.j ->> 'description', ''),
      (x.j ->> 'quantity')::numeric,
      nullif(pg_catalog.btrim(x.j ->> 'unit'), ''),
      (x.j ->> 'unit_price')::numeric,
      coalesce((x.j ->> 'discount_percent')::numeric, 0),
      coalesce((x.j ->> 'tax_rate')::numeric, 0)
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as x(j, n);

    -- One aggregate over the freshly written lines and ONE update of the order.
    select
      coalesce(pg_catalog.sum(i.subtotal), 0::numeric)::numeric(20,2),
      coalesce(pg_catalog.sum(i.tax_amount), 0::numeric)::numeric(20,2),
      coalesce(pg_catalog.sum(i.total), 0::numeric)::numeric(20,2)
      into v_subtotal, v_tax, v_total
    from public.order_items i
    where i.tenant_id = v_order.tenant_id
      and i.order_id = v_order.id;

    update public.orders
    set total_mode = v_mode,
        items_subtotal = v_subtotal,
        items_tax_total = v_tax,
        items_total = v_total,
        total_amount = case when v_mode = 'items' then v_total else total_amount end
    where id = v_order.id
      and tenant_id = v_order.tenant_id
    returning * into v_updated;

    perform pg_catalog.set_config('gestcopy.order_items_write', '', true);
    perform pg_catalog.set_config('gestcopy.order_items_bulk', '', true);
    perform pg_catalog.set_config('gestcopy.order_total_write', '', true);
  exception
    when sqlstate '23514' then
      perform pg_catalog.set_config('gestcopy.order_items_write', '', true);
      perform pg_catalog.set_config('gestcopy.order_items_bulk', '', true);
      perform pg_catalog.set_config('gestcopy.order_total_write', '', true);
      if sqlerrm = 'total_below_paid' then
        return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_below_paid');
      end if;
      raise;
    when sqlstate '22003' then
      perform pg_catalog.set_config('gestcopy.order_items_write', '', true);
      perform pg_catalog.set_config('gestcopy.order_items_bulk', '', true);
      perform pg_catalog.set_config('gestcopy.order_total_write', '', true);
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'amount_overflow');
  end;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', i.id,
      'position', i.position,
      'concept', i.concept,
      'description', i.description,
      'quantity', i.quantity::text,
      'unit', i.unit,
      'unit_price', i.unit_price::text,
      'discount_percent', i.discount_percent::text,
      'tax_rate', i.tax_rate::text,
      'subtotal', public.order_money_text(i.subtotal),
      'tax_amount', public.order_money_text(i.tax_amount),
      'total', public.order_money_text(i.total)
    )
    order by i.position
  )
    into v_lines
  from public.order_items i
  where i.tenant_id = v_order.tenant_id
    and i.order_id = v_order.id;

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    v_order.tenant_id,
    auth.uid(),
    'order.items_replaced',
    'order',
    v_order.id,
    pg_catalog.jsonb_build_object(
      'total_mode', v_order.total_mode,
      'prices_include_tax', v_order.prices_include_tax,
      'items_total', public.order_money_text(v_order.items_total),
      'total_amount', public.order_money_text(v_order.total_amount)
    ),
    pg_catalog.jsonb_build_object(
      'total_mode', v_updated.total_mode,
      'prices_include_tax', v_updated.prices_include_tax,
      'items_count', v_count,
      'items_total', public.order_money_text(v_updated.items_total),
      'total_amount', public.order_money_text(v_updated.total_amount)
    ),
    pg_catalog.jsonb_build_object('reference', v_order.reference, 'field', 'items')
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'changed', true,
    'total_mode', v_updated.total_mode,
    'prices_include_tax', v_updated.prices_include_tax,
    'items_count', v_count,
    'items_subtotal', public.order_money_text(v_updated.items_subtotal),
    'items_tax_total', public.order_money_text(v_updated.items_tax_total),
    'items_total', public.order_money_text(v_updated.items_total),
    'items', coalesce(v_lines, '[]'::jsonb)
  ) || public.order_collection_snapshot(v_updated);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. set_order_total_amount: manual writes are refused in items mode.
--    Same body as 20261016090000 plus the total_mode_items refusal.
-- ---------------------------------------------------------------------------
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

  -- The total is derived from the order lines. Switch the order to manual mode
  -- (replace_order_items_v1) before setting it by hand.
  if v_order.total_mode = 'items' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'total_mode_items');
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

-- ---------------------------------------------------------------------------
-- 9. Privileges: internal functions are not callable by any API role.
-- ---------------------------------------------------------------------------
revoke all on function public.tg_order_item_guard_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_order_items_rollup_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_orders_items_guard_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_orders_purge_items_v1() from public, anon, authenticated, service_role;
revoke all on function public.order_items_refresh_totals_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.order_item_payload_error_v1(jsonb) from public, anon, authenticated, service_role;

revoke all on function public.replace_order_items_v1(uuid, text, jsonb, text, boolean) from public, anon, service_role;
grant execute on function public.replace_order_items_v1(uuid, text, jsonb, text, boolean) to authenticated;

revoke all on function public.set_order_total_amount(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_order_total_amount(uuid, text, text) to authenticated;

comment on function public.replace_order_items_v1(uuid, text, jsonb, text, boolean) is
  'SECURITY DEFINER. Replaces all lines of an order (max 500) under row_version, derives amounts with quote_line_amounts_v1 and, in items mode, atomically sets total_amount (total_below_paid still applies). Operative roles only; archived orders are read-only.';

commit;
