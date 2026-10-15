-- Gestcopy Pro · Acceso anticipado V1 (ADR docs/adr/2026-10-15-pro-early-access-v1.md).
-- Additive catalog rows only, resolved through the existing tenant_has_feature.
--
--   pro_early_access  per-tenant program membership (tenant_feature_overrides).
--   ai_voice_orders   reserved code for «Gestcopy AI — Pedidos por voz».
--                     V1 always presents it as «En preparación»; no recording,
--                     no provider calls, no grants.
--
-- Does NOT insert plan_features rows: neither code is inherited from mvp,
-- basic or any Stripe Test/Live subscription.
-- Does NOT insert tenant_feature_overrides rows: no tenant is enrolled here.
-- Enrolment is a separate operator action via set_tenant_feature (service_role).
-- Does NOT touch plans, subscriptions, billing, Stripe, quotas or quotes.
--
-- IDs: ...000007 is left unused because the unmerged branch
-- feature/ai-voice-orders-v1 assigns it to code voice_orders.

begin;

insert into public.features (id, code, name, description)
values
  (
    '31000000-0000-4000-8000-000000000008',
    'pro_early_access',
    'Gestcopy Pro · Acceso anticipado',
    'Participación del tenant en el acceso anticipado a funcionalidades Pro. Concesión manual por tenant; no cambia plan, precio, cuota ni suscripción.'
  ),
  (
    '31000000-0000-4000-8000-000000000009',
    'ai_voice_orders',
    'Gestcopy AI — Pedidos por voz',
    'Reservado. En preparación: sin grabación, sin proveedor de IA y sin concesiones en V1.'
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = pg_catalog.now();

commit;
