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
  `20261018190000_ai_voice_orders_foundation_v1`) con reserva atómica antes de cada llamada de pago.
- Proveedor intercambiable (`fake` / `openai`) vía `AI_PROVIDER*`:
  - `fake` **nunca** se ejecuta en Vercel Production (`VERCEL_ENV=production`).
  - `openai` exige `OPENAI_API_KEY` **y** `AI_TRANSCRIPTION_MODEL` / `AI_EXTRACTION_MODEL`
    explícitos: no hay modelos por defecto mientras no estén confirmados con el proveedor.
  - Sin configuración, o con un nombre desconocido: no disponible (503 `ai_unavailable`).

## Puertas de seguridad (todas cerradas por defecto)

1. `AI_VOICE_ORDERS_ENABLED === "true"` y un proveedor permitido en ese entorno.
2. Override de tenant `ai_voice_orders`: `set_tenant_feature_v2` (A1, #138), con motivo,
   operador y `review_at`. La v1 sigue funcionando, pero sin motivo.
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

## E2E en Preview (proveedor `fake`, solo tenant sintético `e2e`)

Escenario: `e2e/staging/voice-orders.ts` (flujos en `e2e/staging/voice-flows.ts`), con el
mismo guard, interlock de egress y redacción que el resto de E2E de Staging. El runner
nunca recibe `service_role`: el operador prepara cada estado antes de lanzarlo. Se ejecuta
desde un terminal de confianza: el workflow «E2E staging» solo corre sobre `main`, que aún
no tiene este script.

**Estado previo (18/10, antes del paso 1; histórico):** Staging tenía 83 migraciones, la
última A1 `20261018180000`, aplicada a las 17:49 UTC. La rama `gestcopy-staging` estaba en
`0346406` (código de D1) y no llevaba A1, que no tiene código de aplicación. Sin datos de SUR4.

**Resultado (18–19/10).** Detalle en `VOICE-ORDERS-AI-V1-VALIDATION.md` y en el registro de
Staging de la descripción de #90.

- **Prerrequisitos 1–4, completados.** `gestcopy-staging` `0346406..392eebc` (fast-forward,
  18/10, 18:26 UTC). `20261018190000` aplicada con `db push` el 18/10 a las 18:41 UTC: el
  dry-run listó solo esa versión y Staging queda con **84 migraciones**. Variables de Preview
  y redeploy el 19/10 a las 11:49 UTC; puertas solo para `e2e` a las 11:50 UTC.
- **E2E en Preview, 19/10: 5/5 PASS.** `on` 2/2, `budget_exhausted` 1/1, `kill_switch` 1/1 y
  `off` 1/1, en cuatro ejecuciones con salida 0. Un solo pedido (`E2E-0058`), por clic humano.
- **Cierre de seguridad de Staging, 19/10 a las 15:04 UTC.** `platform` desactivado, 0
  concesiones `ai_voice_orders` y 0 filas `tenant`/`user`; el resto de Staging, igual que
  antes (84 migraciones).
- **Production:** migración pendiente y sin variables de voz.

**Prerrequisitos (cada uno requiere autorización expresa).** Los pasos 1–3 ya están hechos y
las variables del paso 3 siguen en Preview hasta terminar G5. Para reabrir las puertas
durante G5 basta el paso 4 (`~/copyflow-ops/voice-e2e/README.md`, «Reabrir las puertas»).

1. **Código en Preview.** `gestcopy-staging` pasa a un commit de merge (fast-forward, sin
   force) que contiene el código de D1 (`0346406`), los ficheros de A1 (#138) y esta PR.
   Así su directorio de migraciones coincide con Staging más la de voz (84). Con las
   puertas cerradas (sin `AI_VOICE_ORDERS_ENABLED`), E2E V0 y presupuestos, igual que el
   paso A de D1/D2.
2. **Migración.** `db push --dry-run --linked` desde ese árbol debe listar **solo**
   `20261018190000`. Después, `db push` y las comprobaciones posteriores: 84 migraciones;
   `platform` desactivado; ninguna fila `tenant`/`user`; ningún override `ai_voice_orders`;
   hashes de overrides y facturación idénticos. Nunca `--include-all` ni `migration repair`.
   Si el CLI responde «Remote migration versions not found», al directorio le faltan
   ficheros: parar.
3. **Variables de Vercel Preview**, limitadas a la rama `gestcopy-staging` y nunca en
   Production: `AI_VOICE_ORDERS_ENABLED=true` y `AI_PROVIDER=fake`. Sin `OPENAI_API_KEY` ni
   `AI_*_MODEL`. Después, redeploy de `gestcopy-staging`.
4. **Puertas de datos, solo para `e2e`** (operador en Staging: `postgres` sin JWT o
   `service_role`). Postcheck: solo `e2e` resuelve `ai_voice_orders`.
   ```sql
   select public.set_tenant_feature_v2('e2e', 'ai_voice_orders', true, null,
     'E2E de voz en Preview con proveedor fake (B3); solo tenant sintético',
     now() + interval '7 days', '<operador>');
   select public.ai_set_voice_usage_limit('platform', null, null, true, 10000000, 60, 60, 3000000);
   ```

**Estados y comando** (`E2E_VOICE_EXPECT`):

| Estado | Preparación del operador en Staging | Qué comprueba |
| --- | --- | --- |
| `on` | prerrequisitos 1–4 | contratos de API (origen, validación, tenant fijado, caché); dictado escrito + «Descartar» a 1440 px y a 390 px táctil; campo tecleado conservado, «Reemplazar» y «Descartar»; grabación (micrófono sintético) → transcripción → borrador; un único pedido al pulsar «Crear pedido»; viewer sin módulo |
| `budget_exhausted` | `ai_set_voice_usage_limit('user','e2e',<id del owner e2e>,true,0,null,null,null)` | 429 y ningún campo cambia |
| `kill_switch` | `ai_set_voice_usage_limit('platform',null,null,false,10000000,60,60,3000000)` | panel oculto, sin micrófono, API 429 |
| `off` | `set_tenant_feature_v2('e2e','ai_voice_orders',false,null,'<motivo>',null,'<operador>')` | panel oculto, sin micrófono, API 404/503 |

Después de cada estado se vuelve al de `on` (para el usuario: los mismos valores con
`NULL`). En todos los flujos se comprueba que ninguna petición escribe en `/api/orders`
antes del clic.

```bash
E2E_VOICE_EXPECT=on PLAYWRIGHT_MODULE=… E2E_BASE_URL=https://e2e.preview.app.gestcopy.com \
E2E_SUPABASE_URL=… E2E_R2_BUCKET=gestcopy-files-staging E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
[E2E_VIEWER_EMAIL=… E2E_VIEWER_PASSWORD=…] VERCEL_AUTOMATION_BYPASS_SECRET=… \
npx tsx e2e/staging/voice-orders.ts
```

**Al terminar:**

1. Cerrar las puertas: `platform` desactivado;
   `clear_tenant_feature_override('e2e','ai_voice_orders','<motivo>','<operador>')`, que
   devuelve la ausencia de override; borrar las filas `user` del estado
   `budget_exhausted`. Hecho el 19/10: fila `user` retirada a las 14:28 UTC, override
   retirado con el estado `off` y `platform` desactivado en el cierre de las 15:04 UTC.
2. Las variables de Preview se mantienen solo mientras dure G5 (móviles).

G2 (legal) y G5 (móviles) siguen pendientes: ningún proveedor real ni tenant real.

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
2. `clear_tenant_feature_override('<slug>','ai_voice_orders','<motivo>','<operador>')`
   (o `set_tenant_feature_v2(…, false, …)` para un `false` explícito).
3. Quitar `AI_VOICE_ORDERS_ENABLED` / `OPENAI_API_KEY` y redeploy.
4. Revocar la key en el proveedor.
5. Revert del código de UI/rutas.
6. Solo si hay que retirar el ledger: `supabase/rollbacks/20261018190000_ai_voice_orders_foundation_v1.sql`
   (se niega si `ai_usage_events` tiene filas) y `supabase migration repair --status reverted 20261018190000`.
