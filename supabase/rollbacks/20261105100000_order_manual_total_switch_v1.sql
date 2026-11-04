-- Rollback for 20261105100000_order_manual_total_switch_v1.sql.
--
-- Drops set_order_manual_total_v1 only. No data is touched: orders it switched
-- to manual mode keep their mode, total and lines; activity_log rows stay.
-- Deploy first an app version that no longer calls the function.
-- Then: supabase migration repair --status reverted 20261105100000
begin;

drop function public.set_order_manual_total_v1(uuid, text, text);

commit;
