-- Rollback of 20261104120000_order_invoice_tracking_v1.sql.
-- Drops the RPC, the CHECK and both columns: the recorded invoice states are
-- lost. Deploy the previous app version first (it never reads these columns).
begin;

drop function if exists public.change_order_invoice_v1(uuid, boolean, boolean, uuid, bigint);

alter table public.orders
  drop constraint if exists orders_invoice_delivered_requires_invoice;

alter table public.orders
  drop column if exists invoice_delivered,
  drop column if exists invoice_required;

commit;
