-- Rollback for 20261016123500_order_total_guard_null_bypass.sql (P0 hotfix).
--
-- Deliberately REFUSES. The only difference with the previous guard is the NULL
-- handling; reverting would reintroduce the bypass of total_amount_rpc_only and
-- total_below_paid on fresh connections. The fix changes no schema and no data and
-- keeps every authorized path (set_order_total_amount, convert_quote_to_order)
-- working, so there is nothing to undo. If the new guard misbehaves, ship a
-- corrected forward migration instead.
do $refuse$
begin
  raise exception 'rollback refused: 20261016123500 closes a P0 bypass of the orders.total_amount guard; fix forward';
end
$refuse$;
