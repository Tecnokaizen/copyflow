# Voice Orders AI V1 — validación

PR borrador: https://github.com/Tecnokaizen/copyflow/pull/90 · Rama: `feature/ai-voice-orders-v1`.

## Renumeración tras D2/D1 y A1 (18/10/2026, noche)

**Por qué.** Staging (consultado en solo lectura) tiene 83 migraciones:
- las 79 de `main`;
- D2/D1: `20261018160000`, `161000` y `170000`;
- A1: `20261018180000`, aplicada a las 17:49 UTC.

Con `20261018150000` el `db push` estándar rechazaba la migración de voz y pedía `--include-all`. Ahora es **`20261018190000`**. Las suites `phase53_*` no cambian.

**Orden:** #128 → D2 (#135) → D1 (#136) → A1 (#138) → voz (#90) → C1.

| Prueba | Resultado |
| --- | --- |
| `check-migrations.ts --base origin/main` | PASS |
| Guarda con merges simulados de #135, #136 y #138 en `main` | PASS con `…190000`; FAIL con `…150000` |
| `git merge-tree` con #135, #136 y #138 | Sin conflictos |
| `TZ=UTC npx tsx --test` · `tsc` · `lint` · `build` | 1336/1336 · OK · 0 errores (4 avisos previos) · OK |
| Release Gate SQL de esta rama, desde cero (80 migraciones) | Invariantes y 24 suites PASS, `phase53` incluida; `phase53_ai_voice_budget_concurrency.sh` PASS |
| Secuencia completa de `kiosk-supabase` de esta rama | PASS. Para conseguirlo hubo que sortear tres problemas ajenos a #90: el falso positivo de `phase51` (se usó la corrección de #135 en una copia), la fila huérfana de #137 y los avisos de `date +%N` de macOS en `phase12` |
| **Árbol combinado de Staging**: `gestcopy-staging` `0346406` (D1) + #138 `aa3bd7f` (A1) + esta rama | 84 migraciones; las primeras 83 son exactamente las de Staging (md5 `84d27df2…`). Fast-forward sobre `gestcopy-staging` |
| Árbol combinado: app | 1366/1366 · `tsc` · `lint` · `build`, todo OK |
| Árbol combinado: Release Gate SQL (facturación incluida) | 42/42 PASS: `phase53` a `phase57`, y los `.sh` de `phase53`, `phase54` y `phase57` |
| Árbol combinado: secuencia completa de `kiosk-supabase` | PASS de una pasada; incluye `phase54` con su ciclo de rollback de A1 ya con la voz aplicada |
| Ensayo del paso de Staging en local (BD con el historial de Staging, 83 versiones) | El dry-run estándar desde el árbol combinado lista solo `20261018190000`. `db push` la aplica: 84 migraciones, `platform` desactivado, `tenant_default` 2 USD, `user_default` 1 USD y 0 overrides de voz |
| SQL del runbook (concesión solo a `e2e`, `platform` y cierre), en una transacción revertida | Solo `e2e` resuelve `ai_voice_orders`. Al cerrar, todos `false` y `platform` desactivado. Historial de A1: `created` (v2) y `cleared` (retirada) |

No se ha tocado Staging ni Vercel. G2 (legal) y G5 (móviles) siguen pendientes.

## Actualización con #128 y E2E de voz (18/10/2026, tarde)

Merge de `main@67543ee` (#128, Order Lines) sin conflictos: las líneas de phase53 de los
workflows no tocan las de phase51. Sin choques de numeración con D2 (#135:
`20261018160000`, `…161000`, phase55–56) ni con D1 (#136: `20261018170000`, phase57);
merges de prueba de #90 con ambas ramas, sin conflictos.

| Prueba | Resultado |
| --- | --- |
| Guarda de migraciones contra `origin/main@67543ee` | PASS |
| Release Gate SQL desde cero (invariantes + 23 suites, phase51 y phase53 incluidas) | PASS |
| Secuencia completa de kiosk-supabase | PASS |
| `TZ=UTC npx tsx --test` | PASS |
| E2E de voz en pila local completa (Supabase aislado con auth y PostgREST, `next dev`, `AI_PROVIDER=fake`, tenant sintético `e2e`) | 6/6 sesiones PASS |

E2E local, detalle:
- **on (owner, 1440 px)**: contratos de API; dictado escrito → título, servicio, instrucciones,
  entrega (10:00) y prioridad aplicados → «Descartar» deja el formulario igual; título tecleado
  conservado → «Reemplazar Título» → «Descartar» vuelve al tecleado, sin duplicar la descripción;
  grabación con micrófono sintético → transcripción → borrador; el pedido solo aparece al pulsar
  «Crear pedido» (una escritura, `E2E-0002`).
- **on (owner, 390 px táctil)**: mismo dictado escrito y «Descartar», sin scroll horizontal.
- **viewer**: `/status` con `enabled:false`, `reason:"role"`; `POST /drafts` → 403.
- **budget_exhausted** (presupuesto de usuario 0): 429 y ningún campo cambia.
- **kill_switch** y **off**: panel oculto, `getUserMedia` sin llamar y API 429 / 404.
- Pedidos del tenant: +1 en todo el recorrido (el del clic humano). Ledger: solo operación y
  estado, ninguna columna de texto libre.

Defectos de #90 encontrados por el E2E y corregidos:
- `assertSameOrigin` comparaba `Origin` con el host de `request.url`, que Next puede reconstruir
  con otro nombre (`localhost` frente a `e2e.localhost`). Un `POST` del navegador desde la propia
  página daba 403. Ahora se compara con `Host` (+ `x-forwarded-proto`) mediante el parser estricto `parseTrustedAuthority`.
- La revisión mostraba claves internas («title», «due»…); ahora muestra las etiquetas del formulario.

Pendiente: ejecutarlo en Preview (ver prerrequisitos en VOICE-ORDERS-AI-V1.md, «E2E en Preview»)
y las pruebas en dispositivos reales (G5).

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
- Migración renumerada a `20261018190000` y suites `phase53_*` (Release Gate y kiosk-supabase).
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
| Rollback `20261018190000` | Se niega con filas en el ledger; sin filas no queda ningún objeto `ai_*` y el catálogo no cambia |

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
