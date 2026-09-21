-- Settings V1 · global storage_bytes feature (commercial quota unit = bytes).
-- Does NOT attach limit_value to plan mvp: existing tenants stay unconfigured
-- (NULL quota = not enforced / legacy). Billing/Stripe will assign later.
--
-- Units:
--   1 MiB = 1,048,576 bytes
--   1 GiB = 1,073,741,824 bytes

begin;

insert into public.features (id, code, name, description)
values (
  '31000000-0000-4000-8000-000000000005',
  'storage_bytes',
  'Almacenamiento de archivos',
  'Cuota total de almacenamiento del tenant. plan_features.limit_value se expresa en bytes (MiB/GiB binarios).'
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = pg_catalog.now();

comment on table public.features is
  'Catálogo global de funcionalidades monetizables o limitables. storage_bytes.limit_value = bytes.';

commit;
