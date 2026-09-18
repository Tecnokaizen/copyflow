-- Rollback Files V1 · F2-A / F2-A.1 / F2-A.2 order_files
-- Scope: drop order_files + RPCs + files_private + triggers/functions only.
-- Does NOT alter public.orders, concurrency columns, or Kiosk objects.

begin;

DROP TRIGGER IF EXISTS trg_order_files_activity_log ON public.order_files;
DROP TRIGGER IF EXISTS trg_order_files_mutation_guard ON public.order_files;
DROP TRIGGER IF EXISTS trg_order_files_immutable_columns ON public.order_files;

-- New signatures (F2-A.2)
DROP FUNCTION IF EXISTS public.soft_delete_order_file(uuid, uuid, bigint, text);
DROP FUNCTION IF EXISTS public.complete_order_file_upload(uuid, uuid, text, bigint, text);
DROP FUNCTION IF EXISTS public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz, bigint, text);

-- Legacy F2-A.1 signatures (if present)
DROP FUNCTION IF EXISTS public.soft_delete_order_file(uuid, uuid);
DROP FUNCTION IF EXISTS public.complete_order_file_upload(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.create_order_file_upload(uuid, uuid, text, text, bigint, timestamptz);

DROP FUNCTION IF EXISTS public.order_file_public_json(public.order_files);
DROP FUNCTION IF EXISTS public.tg_activity_log_order_file();
DROP FUNCTION IF EXISTS public.tg_order_files_mutation_guard();
DROP FUNCTION IF EXISTS public.tg_order_files_immutable_columns();

DROP TABLE IF EXISTS public.order_files;

DROP FUNCTION IF EXISTS files_private.verify_files_capability(
  text, uuid, uuid, uuid, uuid, bigint, text
);
DROP FUNCTION IF EXISTS files_private.constant_time_equal(text, text);
DROP SCHEMA IF EXISTS files_private;

commit;
