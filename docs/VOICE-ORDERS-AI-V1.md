# Voice Orders AI V1

Pedidos por voz como **productor de borradores** sobre el core multi-tenant de Gestcopy.

## Decisión

- Rutas: `GET /api/ai/voice-orders/status`, `POST .../transcriptions`, `POST .../drafts`.
- Persistencia única: el usuario pulsa «Crear pedido» → `buildCreateOrderPayload` → `POST /api/orders`.
- Feature `voice_orders` solo por `tenant_feature_overrides` (sin Stripe / `plan_features`).
- Presupuesto interno (`ai_usage_limits` + `ai_usage_events`) con reserva atómica antes de cada llamada de pago.
- Modelos por entorno: transcripción `gpt-transcribe` (no `gpt-4o-mini-transcribe`), extracción `gpt-6-luna` (fallback documentado `gpt-6.1-sol`).
- Proveedor intercambiable (`fake` / `openai`) vía `AI_PROVIDER*`.

## Puertas de seguridad (todas cerradas por defecto)

1. `AI_VOICE_ORDERS_ENABLED === "true"` (solo Preview en el piloto).
2. Override de tenant `voice_orders`.
3. Fila `platform` en `ai_usage_limits` con `enabled = false` hasta activación manual.
4. Roles operativos + membership + RLS; el body no acepta `tenant_id`.

## Presupuesto

Control **interno** de coste y base para un futuro add-on. No es pricing comercial ni modifica Stripe.

Valores piloto provisionales: 60 s / clip, 2 USD/tenant/mes, 10 USD globales/mes, 1 USD/usuario/mes, 60 peticiones/usuario/día.

## Privacidad

Audio y transcript no se persisten. El ledger no guarda texto. Aviso visible en la UI. Piloto con datos sintéticos hasta gate legal (DPA / subencargado).

## Rollback

1. `update ai_usage_limits set enabled=false where scope='platform'`.
2. `set_tenant_feature('<slug>','voice_orders',false)`.
3. Quitar `AI_VOICE_ORDERS_ENABLED` / `OPENAI_API_KEY` y redeploy.
4. Revocar la key en el proveedor.
5. Revert del código de UI/rutas.
