-- Rollback for 20261022120000_order_direct_write_guard_v1.sql (R5).
--
-- Re-opens the gap R5 closed: every operative role can PATCH public.orders
-- directly again, archived orders included. Prefer fixing forward. For an
-- emergency without dropping anything, a forward migration can replace the
-- body of public.tg_orders_write_guard() with `return new;`.
--
-- What it does:
--   * drops trg_orders_write_guard and public.tg_orders_write_guard();
--   * restores table-level INSERT on public.orders for authenticated;
--   * leaves the app.order_write lines inside the eight order RPCs: with no
--     guard they only set a transaction-local setting nobody reads, so the
--     RPCs behave exactly as before 20261022120000. Restoring their previous
--     bodies is not needed and would mean re-typing eight functions.
-- No data is touched.
-- Then: supabase migration repair --status reverted 20261022120000
begin;

drop trigger if exists trg_orders_write_guard on public.orders;
drop function if exists public.tg_orders_write_guard();

revoke insert (
  id,
  tenant_id,
  title,
  description,
  client_id,
  service_id,
  assigned_team_member_id,
  status_id,
  entry_channel_id,
  order_context_id,
  store_id,
  priority,
  due_at,
  notes,
  file_status_id,
  created_by
) on table public.orders from authenticated;
grant insert on table public.orders to authenticated;

commit;
