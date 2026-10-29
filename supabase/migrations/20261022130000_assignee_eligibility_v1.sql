-- R6 · One eligibility rule for the person in charge of orders and quotes.
--
-- Before: POST /api/orders, the quote routes and the quote draft RPCs only
-- checked the tenant; change_order_details_v2 and convert_quote_to_order also
-- required team_members.active; nothing checked can_receive_orders, although
-- the help says the person must be active and able to receive orders.
--
-- The rule now lives in one place, public.team_member_is_assignable: same
-- tenant, active and can_receive_orders. A trigger on public.orders and on
-- public.quotes applies it only when assigned_team_member_id is set or
-- changes:
--   * clearing the assignee is always allowed;
--   * current assignments are never touched, even when that person is no
--     longer assignable (history and day-to-day work are kept);
--   * every write path is covered: direct inserts/updates, the order and quote
--     RPCs, quote conversion and future callers.
-- No exemption for postgres: convert_quote_to_order and the quote draft RPCs
-- are SECURITY DEFINER and run as postgres, so an exemption would skip them.
-- Error: SQLSTATE 22023, the code the order RPCs already use for an invalid
-- assignee.
--
-- Not touched: RPC bodies (their own active checks stay as a first filter),
-- RLS, grants on tables, data.
--
-- Rollback: supabase/rollbacks/20261022130000_assignee_eligibility_v1.sql

begin;

create or replace function public.team_member_is_assignable(
  p_tenant_id uuid,
  p_team_member_id uuid
)
  returns boolean
  language sql
  stable
  set search_path to ''
as $function$
  select exists (
    select 1
    from public.team_members tm
    where tm.tenant_id = p_tenant_id
      and tm.id = p_team_member_id
      and tm.active
      and tm.can_receive_orders
  );
$function$;

comment on function public.team_member_is_assignable(uuid, uuid) is
  'Single eligibility rule for assigned_team_member_id on orders and quotes: same tenant, active and can_receive_orders.';

revoke all on function public.team_member_is_assignable(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.tg_assignee_eligibility_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if new.assigned_team_member_id is null then
    return new;
  end if;

  -- Keep existing assignments: only a new or changed assignee is checked.
  if tg_op = 'UPDATE'
     and new.assigned_team_member_id is not distinct from old.assigned_team_member_id then
    return new;
  end if;

  if not public.team_member_is_assignable(new.tenant_id, new.assigned_team_member_id) then
    raise exception 'team member cannot receive orders'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

comment on function public.tg_assignee_eligibility_guard() is
  'BEFORE INSERT OR UPDATE OF assigned_team_member_id on orders and quotes: a new or changed assignee must satisfy team_member_is_assignable. Clearing and unchanged assignees pass.';

drop trigger if exists trg_orders_assignee_eligibility on public.orders;
create trigger trg_orders_assignee_eligibility
  before insert or update of assigned_team_member_id on public.orders
  for each row
  execute function public.tg_assignee_eligibility_guard();

drop trigger if exists trg_quotes_assignee_eligibility on public.quotes;
create trigger trg_quotes_assignee_eligibility
  before insert or update of assigned_team_member_id on public.quotes
  for each row
  execute function public.tg_assignee_eligibility_guard();

revoke all on function public.tg_assignee_eligibility_guard()
  from public, anon, authenticated, service_role;

commit;
