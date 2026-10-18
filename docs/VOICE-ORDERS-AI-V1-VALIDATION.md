# Voice Orders AI V1 — validación

PR borrador: https://github.com/Tecnokaizen/copyflow/pull/90 · Rama: `feature/ai-voice-orders-v1`.

## Recuperación sobre `main` (18/10/2026)

Base: `main@410228e`, por merge (sin force push). Nada aplicado en ningún Supabase
remoto, ninguna variable `AI_*` tocada en Vercel y ningún proveedor real activado.

### Cambios

- Merge de `main` con 4 conflictos resueltos: `kiosk-supabase.yml` (sin solapar
  con las líneas de #128), `/api/context` (versión de `main`, sin `features.voice_orders`),
  `/api/orders/options` (`requireCurrentAccess` y `actor_id` de #94 en
  `lib/orders/options-load.ts`) y `create-order-form.tsx` (borrador de sesión de #94
  y validación de fecha incompleta).
- Catálogo de #105: `ai_voice_orders` (`AI_VOICE_ORDERS_FEATURE_CODE`); la migración
  ya no inserta `voice_orders` (`…0007`). La página Pro sigue en «planned».
- Migración renumerada a `20261018150000` y suites `phase53_*` (Release Gate y kiosk-supabase).
- Guarda de rutas: `requireVoiceOrdersAccess` sobre `requireCurrentAccess` y las tres
  rutas como delegadas en `ci/release-gate/api-route-guards.test.ts`.
- Endurecimiento: `fake` bloqueado con `VERCEL_ENV=production`; `openai` exige modelos
  explícitos; valores iniciales por tenant (2 USD) y usuario (1 USD) y función de
  operador `ai_set_voice_usage_limit`; la reserva solo admite `ai_voice_orders` y no
  devuelve la reserva de otro miembro; «Descartar» revierte lo aplicado; «Reemplazar»
  toca un solo campo; corte de red sin bloquear el panel.

### Pruebas locales

| Prueba | Resultado |
| --- | --- |
| `TZ=UTC npx tsx --test` | 1332/1332 |
| `npx tsc --noEmit` | OK |
| `npm run lint` | 0 errores (4 avisos previos de `main`) |
| `npm run build` | OK |
| `ci/release-gate/check-migrations.ts --base origin/main` | PASS (1 migración) |
| Smokes de navegador (Playwright 1.58.2): pedido-v2, order-collection, inline-client, quotes-draft, payment-receipts, quotes-conversion | PASS |
| `scripts/voice-orders-ui-smoke.mjs` | PASS |
| Pila Supabase local aislada (CLI 2.117.0): invariantes + 22 suites del Release Gate desde cero | PASS (incluida `phase53_ai_voice_budget`) |
| Secuencia completa de kiosk-supabase | PASS, salvo la nota de abajo |
| `phase53_ai_voice_budget_concurrency.sh` ×3 | PASS (una reserva, un `ai_budget_exhausted`, límite de plataforma restaurado) |
| Rollback `20261018150000` | Se niega con filas en el ledger; sin filas no queda ningún objeto `ai_*` y el catálogo no cambia |

Nota: en local, `phase46_files_storage_deletion` falló una vez dentro de la secuencia de
kiosk porque `phase46_payment_receipts_concurrency.sh` dejó una fila huérfana en
`files_private.storage_deletions` (ganó el borrado en la carrera y la limpieza borra el tenant).
Es previo a #90 (no toca ficheros) y en CI suele ganar el pago. Sin esa fila, la suite pasa.

### No ejecutado

- Recorrido HTTP con PostgREST y proveedor `fake` (lo cubre B3, `e2e/staging/voice-orders.ts`).
- Micrófono real, iOS Safari y PWA (gate G5).
- Proveedor real: modelos y precios sin confirmar (gate G2).

## Validación inicial (12/10/2026, `main@58525fb`)

16 pruebas unitarias y `tsc` OK. Sin Postgres local ni proveedor real.

## Rollback

Ver [VOICE-ORDERS-AI-V1.md](./VOICE-ORDERS-AI-V1.md).
