-- P0 hotfix: orders.total_amount guard bypass on a session that never set the flag.
--
-- tg_orders_total_amount_guard (20261007190056) computed
--   v_allowed := current_setting('gestcopy.order_total_write', true) = '1'
-- A custom GUC that was never set in the session is NULL, so v_allowed was NULL,
-- `not v_allowed` was NULL and neither `IF not v_allowed THEN raise` was taken:
-- on a fresh (pooled) connection a role with UPDATE on orders could change
-- total_amount directly, skipping total_amount_rpc_only AND total_below_paid
-- (collections). The bypass only disappeared on connections that had already run
-- a totals RPC, which leaves the GUC set to ''.
--
-- Fix: NULL means "not allowed". Same function body otherwise, so every authorized
-- path is unchanged: set_order_total_amount and convert_quote_to_order still set
-- gestcopy.order_total_write = '1' for their own transaction.
-- The trigger, grants and RPCs are not touched. No schema change, no data change.
--
-- Rollback: none by design. Restoring the previous body would reintroduce the
-- bypass; supabase/rollbacks/20261016125000_order_total_guard_null_bypass.sql
-- refuses and explains. Correct forward instead of reverting.
begin;

create or replace function public.tg_orders_total_amount_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_paid numeric(20,2);
  -- A never-set custom GUC is NULL: NULL must mean "not allowed", never "skip the check".
  v_allowed boolean := coalesce(
    pg_catalog.current_setting('gestcopy.order_total_write', true) = '1',
    false
  );
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

revoke all on function public.tg_orders_total_amount_guard() from public, anon, authenticated, service_role;

commit;
