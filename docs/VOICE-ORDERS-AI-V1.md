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

## E2E en Preview (proveedor `fake`)

Escenario: `e2e/staging/voice-orders.ts` (flujos en `e2e/staging/voice-flows.ts`), con el
mismo guard, interlock de egress y redacción que el resto de E2E de Staging. El runner
nunca recibe `service_role`: el operador prepara cada estado antes de lanzarlo.

**Prerrequisitos (requieren autorización; hoy no están hechos):**

1. Migración `20261018150000` aplicada en Staging, respetando el orden #128 → A1 → voz
   (si A1 no está, decidir si se renumera A1 o se espera; nunca `--include-all`).
2. `gestcopy-staging` (dominio `e2e.preview.app.gestcopy.com`) con el código de #90.
3. Variables de Vercel **Preview** (nunca Production): `AI_VOICE_ORDERS_ENABLED=true`, `AI_PROVIDER=fake`.
4. En Staging, como operador: `set_tenant_feature('e2e','ai_voice_orders',true,null)` y
   `ai_set_voice_usage_limit('platform', null, null, true, 10000000, 60, 60, 3000000)`.

**Estados y comando** (`E2E_VOICE_EXPECT`, o la entrada `voice_expect` del workflow manual «E2E staging»):

| Estado | Preparación del operador en Staging | Qué comprueba |
| --- | --- | --- |
| `on` | prerrequisitos 1–4 | contratos de API (origen, validación, tenant fijado, caché); dictado escrito + «Descartar» a 1440 px y a 390 px táctil; campo tecleado conservado, «Reemplazar» y «Descartar»; grabación (micrófono sintético) → transcripción → borrador; un único pedido al pulsar «Crear pedido»; viewer sin módulo (solo por CLI) |
| `budget_exhausted` | `ai_set_voice_usage_limit('user','e2e',<id del owner e2e>,true,0,null,null,null)` | 429 y ningún campo cambia |
| `kill_switch` | `ai_set_voice_usage_limit('platform',null,null,false,10000000,60,60,3000000)` | panel oculto, sin micrófono, API 429 |
| `off` | `set_tenant_feature('e2e','ai_voice_orders',false,null)` | panel oculto, sin micrófono, API 404/503 |

Después de cada estado, volver al de `on` (para el usuario: los mismos valores con `NULL`).
En todos los flujos se comprueba que ninguna petición escribe en `/api/orders` antes del clic.

```bash
E2E_VOICE_EXPECT=on PLAYWRIGHT_MODULE=… E2E_BASE_URL=https://e2e.preview.app.gestcopy.com \
E2E_SUPABASE_URL=… E2E_R2_BUCKET=gestcopy-files-staging E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
[E2E_VIEWER_EMAIL=… E2E_VIEWER_PASSWORD=…] VERCEL_AUTOMATION_BYPASS_SECRET=… \
npx tsx e2e/staging/voice-orders.ts
```

## Pruebas en dispositivos móviles (gate G5)

El E2E cubre 390 px táctil en Chromium con un micrófono sintético. En dispositivos reales,
con Preview y proveedor `fake`, hay que comprobar:

| Caso | iPhone (Safari iOS 17+) | Android (Chrome) |
| --- | --- | --- |
| Primer uso: el sistema pide el micrófono; aceptar → graba | ☐ | ☐ |
| Permiso denegado → mensaje y «Escribir en lugar de dictar» | ☐ | ☐ |
| Sin micrófono / navegador sin `MediaRecorder` → solo texto | ☐ | ☐ |
| Formato: iOS graba `audio/mp4`, Android `audio/webm` → transcripción OK | ☐ | ☐ |
| Pantalla bloqueada o app en segundo plano durante la grabación → se cancela sin enviar | ☐ | ☐ |
| Corte de red al transcribir o interpretar → error y reintento, nada aplicado | ☐ | ☐ |
| Límite de 60 s → se detiene sola | ☐ | ☐ |
| Revisión legible a 320–390 px, sin scroll horizontal; «Descartar» deja el formulario como estaba | ☐ | ☐ |
| Nunca se guarda un pedido sin pulsar «Crear pedido» | ☐ | ☐ |
| PWA instalada (si aplica): mismo comportamiento | ☐ | ☐ |

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
