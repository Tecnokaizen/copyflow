-- Rollback E2A order concurrency v1.
-- Drops only the v2 RPCs, bump trigger/function, and orders.row_version.
-- Leaves v1 RPCs, lifecycle, E1, Kiosk, and order data intact.

begin;

DROP FUNCTION IF EXISTS public.change_order_content_v2(uuid, text, text, uuid, bigint);
DROP FUNCTION IF EXISTS public.change_order_details_v2(uuid, text, text, uuid, bigint);
DROP FUNCTION IF EXISTS public.change_order_management_v2(uuid, text, uuid, uuid, bigint);
DROP FUNCTION IF EXISTS public.change_order_notification_status_v2(uuid, text, uuid, bigint);
DROP FUNCTION IF EXISTS public.assign_order_client_v2(uuid, uuid, uuid, bigint);
DROP FUNCTION IF EXISTS public.create_client_and_assign_order_v2(uuid, uuid, text, text, text, text, text, text, text, uuid, bigint);
DROP FUNCTION IF EXISTS public.change_order_status_v2(uuid, uuid, uuid, bigint);

DROP TRIGGER IF EXISTS orders_bump_row_version ON public.orders;
DROP FUNCTION IF EXISTS public.bump_row_version();

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS row_version;

commit;
