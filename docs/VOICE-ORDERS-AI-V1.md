# Voice Orders AI V1

Pedidos por voz como **productor de borradores** sobre el core multi-tenant de Gestcopy.
Estado y gates: [AI-VOICE-ORDERS-PLAN.md](./AI-VOICE-ORDERS-PLAN.md). Validación: [VOICE-ORDERS-AI-V1-VALIDATION.md](./VOICE-ORDERS-AI-V1-VALIDATION.md).

## Decisión

- Rutas: `GET /api/ai/voice-orders/status`, `POST .../transcriptions`, `POST .../drafts`.
  Ninguna crea pedidos ni acepta `tenant_id` en el body.
- Persistencia única: el usuario pulsa «Crear pedido» → `buildCreateOrderPayload` → `POST /api/orders`.
- Feature: código de catálogo `ai_voice_orders` (`…0009`, de #105; constante
  `AI_VOICE_ORDERS_FEATURE_CODE`), solo por `tenant_feature_overrides`. Sin
  `plan_features` ni Stripe. La página Pro sigue mostrando la voz como «planned».
- Presupuesto interno (`ai_usage_limits` + `ai_usage_events`, migración
  `20261018150000_ai_voice_orders_foundation_v1`) con reserva atómica antes de cada llamada de pago.
- Proveedor intercambiable (`fake` / `openai`) vía `AI_PROVIDER*`:
  - `fake` **nunca** se ejecuta en Vercel Production (`VERCEL_ENV=production`).
  - `openai` exige `OPENAI_API_KEY` **y** `AI_TRANSCRIPTION_MODEL` / `AI_EXTRACTION_MODEL`
    explícitos: no hay modelos por defecto mientras no estén confirmados con el proveedor.
  - Sin configuración, o con un nombre desconocido: no disponible (503 `ai_unavailable`).

## Puertas de seguridad (todas cerradas por defecto)

1. `AI_VOICE_ORDERS_ENABLED === "true"` y un proveedor permitido en ese entorno.
2. Override de tenant `ai_voice_orders` (`set_tenant_feature`).
3. Fila `platform` en `ai_usage_limits` con `enabled = false` hasta activación manual.
4. Sesión, tenant y membership activos (`requireCurrentAccess`, #94), roles
   operativos (owner, admin, manager, staff) y comprobación de nuevo en la RPC.

## Presupuesto

Control **interno** de coste y base para un futuro add-on. No es pricing comercial ni modifica Stripe.

| Ámbito | Valor inicial | Notas |
| --- | --- | --- |
| `platform` | desactivado · 10 USD/mes · 60 peticiones/usuario/día · 60 s/clip · 3 MB | Interruptor general |
| `tenant_default` | 2 USD/mes | Para cualquier tenant sin fila propia |
| `user_default` | 1 USD/mes | Para cualquier usuario sin fila propia |
| `tenant` / `user` | — | Solo con la función de operador; `NULL` hereda el valor por defecto |

Cada presupuesto se compara con su propio gasto del mes, dentro de los mismos
advisory locks (global → tenant → usuario). Las reservas caducadas siguen contando.

Operador (solo `service_role` o sesión `postgres` sin JWT):

```sql
-- Activar el interruptor general (solo con autorización y tras los gates)
select public.ai_set_voice_usage_limit('platform', null, null, true, 10000000, 60, 60, 3000000);
-- Presupuesto propio de un tenant / apagar a un usuario
select public.ai_set_voice_usage_limit('tenant', '<slug>', null, true, 5000000, null, null, null);
select public.ai_set_voice_usage_limit('user', '<slug>', '<user_id>', false, null, null, null, null);
```

## Revisión humana en el formulario

- La propuesta se aplica a campos no tocados; los tocados quedan con «Reemplazar»
  (un solo campo cada vez). Lo restaurado tras una sesión caducada (#94) cuenta como tocado.
- «Descartar» devuelve cada campo escrito por el borrador a su valor anterior, salvo
  los que el usuario cambió después. Si la sesión caduca durante el dictado, el
  formulario guarda su borrador de sesión como en #94.

## Privacidad

Audio y transcript no se persisten. El ledger no guarda texto. Aviso visible en la UI.
Piloto con datos sintéticos hasta el gate legal (DPA / subencargado, #82).

## Rollback

1. `select public.ai_set_voice_usage_limit('platform', null, null, false, 10000000, 60, 60, 3000000);`
2. `set_tenant_feature('<slug>','ai_voice_orders',false)`.
3. Quitar `AI_VOICE_ORDERS_ENABLED` / `OPENAI_API_KEY` y redeploy.
4. Revocar la key en el proveedor.
5. Revert del código de UI/rutas.
6. Solo si hay que retirar el ledger: `supabase/rollbacks/20261018150000_ai_voice_orders_foundation_v1.sql`
   (se niega si `ai_usage_events` tiene filas) y `supabase migration repair --status reverted 20261018150000`.
