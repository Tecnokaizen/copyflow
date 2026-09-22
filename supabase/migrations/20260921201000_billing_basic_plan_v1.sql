-- Billing Foundation V1 · Gestcopy Basic plan seed.
-- Core features only. storage_bytes intentionally NOT attached (quota TBD).
-- Ensures core feature catalog rows exist (they lived only in remote data before).
-- Does NOT rewrite plan mvp when it already exists. Does NOT touch tenant subscriptions.

begin;

-- Core commercial features (IDs aligned with production catalog).
insert into public.features (id, code, name, description)
values
  (
    '31000000-0000-4000-8000-000000000001',
    'core_orders',
    'Gestión de pedidos',
    'Pedidos, estados, planificación y entrega.'
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    'core_clients',
    'Gestión de clientes',
    'Clientes y tipos de cliente.'
  ),
  (
    '31000000-0000-4000-8000-000000000003',
    'core_team',
    'Gestión de equipo',
    'Equipo, responsables y carga operativa.'
  ),
  (
    '31000000-0000-4000-8000-000000000004',
    'activity_log',
    'Historial de actividad',
    'Auditoría de acciones relevantes.'
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = pg_catalog.now();

-- Baseline mvp row for environments without historical seed data.
-- Remote already has this row: ON CONFLICT DO NOTHING leaves it untouched.
insert into public.plans (
  id,
  code,
  name,
  description,
  price_monthly,
  price_yearly,
  currency,
  active,
  sort_order,
  metadata
)
values (
  '30000000-0000-4000-8000-000000000001',
  'mvp',
  'MVP',
  'Plan interno legacy / demostración.',
  0.00,
  0.00,
  'EUR',
  true,
  0,
  '{}'::jsonb
)
on conflict (code) do nothing;

insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
select
  p.id,
  f.id,
  true,
  null
from public.plans p
cross join public.features f
where p.code = 'mvp'
  and f.code in (
    'activity_log',
    'core_clients',
    'core_orders',
    'core_team'
  )
on conflict (plan_id, feature_id) do nothing;

insert into public.plans (
  code,
  name,
  description,
  price_monthly,
  price_yearly,
  currency,
  active,
  sort_order,
  metadata
)
values (
  'basic',
  'Gestcopy Basic',
  'Suscripción SaaS Gestcopy Basic (mensual).',
  39.00,
  null,
  'EUR',
  true,
  10,
  '{}'::jsonb
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  price_monthly = excluded.price_monthly,
  price_yearly = excluded.price_yearly,
  currency = excluded.currency,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = pg_catalog.now();

insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
select
  p.id,
  f.id,
  true,
  null
from public.plans p
cross join public.features f
where p.code = 'basic'
  and f.code in (
    'activity_log',
    'core_clients',
    'core_orders',
    'core_team'
  )
on conflict (plan_id, feature_id) do update
set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  updated_at = pg_catalog.now();

-- Explicitly ensure storage_bytes is not attached to basic in this migration.
delete from public.plan_features pf
using public.plans p, public.features f
where pf.plan_id = p.id
  and pf.feature_id = f.id
  and p.code = 'basic'
  and f.code = 'storage_bytes';

commit;
