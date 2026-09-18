-- Order Editing V1 · E2B — retire legacy (v1) order-edit RPCs
--
-- Production now calls only the *_v2 variants introduced in E2A.
-- Drops the 7 legacy RPCs with exact argument signatures.
-- Does NOT touch:
--   *_v2 functions, archive_order, bump_row_version, trigger,
--   lifecycle guard, activity triggers, Kiosk functions,
--   row_version column, tables, or data.

begin;

DROP FUNCTION IF EXISTS public.change_order_content(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.change_order_details(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.change_order_management(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.change_order_notification_status(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.assign_order_client(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.create_client_and_assign_order(uuid, uuid, text, text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.change_order_status(uuid, uuid, uuid);

commit;
