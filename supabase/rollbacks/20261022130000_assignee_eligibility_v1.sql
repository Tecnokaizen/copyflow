-- Rollback for 20261022130000_assignee_eligibility_v1.sql (R6).
--
-- Removes the eligibility triggers on orders and quotes and their two
-- functions. Afterwards each path goes back to its own check (tenant only for
-- POST /api/orders and quotes, active for change_order_details_v2 and
-- convert_quote_to_order). No data is touched: the migration never changed an
-- assignment.
-- Revert the app and help changes of the same PR together with this script.
-- Then: supabase migration repair --status reverted 20261022130000
begin;

drop trigger if exists trg_orders_assignee_eligibility on public.orders;
drop trigger if exists trg_quotes_assignee_eligibility on public.quotes;
drop function if exists public.tg_assignee_eligibility_guard();
drop function if exists public.team_member_is_assignable(uuid, uuid);

commit;
