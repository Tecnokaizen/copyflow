# Sprint de consolidación — 15 a 18 de octubre de 2026

Registro vivo del sprint. Base: `main` `03fa094`. Staging integrado:
`gestcopy-staging` `4570ea5`. Ninguna PR se ha fusionado en `main` y Production no
se ha tocado: ni código ni datos. Production solo se ha consultado en
modo lectura, para el historial de migraciones.

Arquitectura respetada en todo el sprint: un repositorio y un core Next.js, un
proyecto y un deployment de Production en Vercel, un proyecto Supabase con una
única PostgreSQL compartida y N tenants aislados por `tenant_id`, memberships,
autorización y RLS. Staging es un entorno de pruebas separado y no
infraestructura por tenant. No hay código específico de SUR4.

## Estado por funcionalidad

| Funcionalidad | Issue | PR · head | Migraciones | Pruebas | Staging | Merge |
| --- | --- | --- | --- | --- | --- | --- |
| Gestcopy Pro · Acceso anticipado V1 | — | #105 · `4ffa92a` | `20261015200000_pro_early_access_features_v1` | 1102 unitarias; SQL `phase47` (en el gate); 6 mutaciones detectadas | ON/OFF/retirada con owner + viewer, 1440/375 px, claro/oscuro; E2E desde GitHub Actions run `38796720614` 3/3 | Lista; pendiente de autorización |
| Novedades y ayuda plegable | — | #99 · `3e77e93` | — | Ayuda 27/27; CI verde | 9/9: metadatos, canonical, filtros con teclado, secciones plegables, 60 enlaces con 200, escritorio/móvil, claro/oscuro | Lista |
| Métodos de pago y justificantes | #103 | #95 · `8886ecf` | `20261016090000_order_total_validation_p1`, `20261016091000_order_payment_methods_receipts_expand` | 1088 unitarias; suites SQL de cobros y archivos con concurrencia; smokes de navegador | Expand con la app anterior (`E2E-0013`); E2E V0 con método y justificante (`E2E-0015`, `E2E-0018`); reintentos, ajenos, anulación, viewer, escritorio/móvil | Lista para revisión; aplicar la migración en Production **antes** del merge |
| Pie de presupuestos (P1) | #100 | #106 · `5b28738` | — | Regresión que falla en `main`; 1077/1077 | Editor real: 4 líneas + Intro se guarda; 5.ª línea → 400; viewer 403 | Lista |
| Dirección opcional de clientes | #101 | #107 · `5f34d1f` | `20261016100000_clients_address_v1` | SQL `phase48` (en el gate); 1080/1080 | Alta con y sin dirección, edición, conservación, borrado, viewer 403, escritorio/móvil | Lista |
| Notas del presupuesto → pedido | #102 | #108 · `53d3e3a` | `20261016110000_quote_conversion_notes_v1` | SQL `phase49` (en el gate); `phase34` y `phase38` actualizadas | `phase49` completa contra la BD de Staging, sin dejar datos | Lista; cambio de comportamiento deliberado (ver la PR) |
| Modificación de líneas de pedido | #104 | — | — | — | — | **No implementado**: los pedidos no tienen modelo de líneas. Diseño en `docs/adr/2026-10-15-order-lines-v1.md` |
| Resiliencia de sesión | — | #94 · `9a91fb6` | — | 1106/1106; 4 smokes de navegador | Sesión caducada → 401 y el borrador se recupera; viewer 403; contexto anónimo 401 | Lista; conflicto con #105 resuelto en Staging (`3d1f386`) |
| Logos del tenant | — | #58 · `cf569be` | — | 1076/1076; CI verde | Logos 3:1 y 1:3 proporcionados, sustitución sin recarga, quitar → monograma, escritorio/móvil, claro/oscuro | Lista |
| Gestcopy AI — Pedidos por voz | #76, #78–#82 | #90 · `bf18b26` (borrador, en conflicto) | `20261012120000_ai_voice_orders_foundation_v1` (sin aplicar) | — | — | No integrar; plan en `docs/AI-VOICE-ORDERS-PLAN.md` |
| Corrección de total (#91) | — | #91 · `dd3c90c` (en conflicto) | Su migración viaja en #95 con nueva versión | — | — | Cerrar como sustituida al integrar #95 (no se ha cerrado) |

### Hallazgos relevantes

- **#95 revertía #96.** Su migración redefinía `soft_delete_order_file` a partir de la
  versión anterior a la cola de borrado en R2. Corregido y demostrado con la
  suite `phase46_files_storage_deletion`.
- **#95 rompía el registro de cobros durante el despliegue.** La firma antigua de
  `record_order_payment` quedaba retirada. Ahora se hace en dos pasos (expand/contract), demostrado en Staging con la
  app anterior.
- **«Could not list files»** salía cuando la app iba por delante de la migración
  (PostgreSQL 42703). Ahora se tolera.
- **#100**: el pie de presupuestos rechazaba 4 líneas visibles cuando había un
  párrafo vacío final, espacios entre bloques o un salto inicial.
- **#94** mostraba «No se ha podido comprobar la sesión» ante cualquier 500. Ahora
  solo cuando falla la autenticación.
- **#107**: el formulario de edición del cliente volvía a los valores guardados
  mientras se guardaba. Corregido.
- **#99**: el changelog contenía tres afirmaciones inexactas (prueba «en cada
  versión», historial ya existente, dominio y ruta visibles). Corregidas.

## Orden de integración recomendado

La guarda de migraciones exige que cada migración nueva sea posterior a la
última de `main`. Por eso las PR con migraciones entran en orden de versión. En
cada paso: CI verde, revisión y, si hay migración, `db push --dry-run` en
Production (solo la esperada) y después `db push`.

1. **#106** (P1, sin migración).
2. **#99** (sin migración).
3. **#105**: merge y después la migración en Production (el código funciona sin
   ella). Ningún tenant queda enrolado.
4. **#94**: antes del merge, `main` a la rama. El conflicto en
   `app/api/context/route.ts` se resuelve igual que en `gestcopy-staging`
   `3d1f386` (guarda `requireCurrentAccess`, respuesta 200 de #105, prueba HTTP
   de #105 con la guarda nueva).
5. **#95**: aplicar **antes** las dos migraciones en Production (expand compatible
   con la app actual), después el merge. Cerrar #91. Pasadas 24 h, PR de contract.
6. **#107**: migración, después el merge (el código también funciona sin ella).
7. **#108**: migración (es solo de base de datos) y merge.
8. **#58** (validada en Staging).

Hasta que #95 esté en `main`, el workflow `E2E staging` lanzado desde `main`
falla en el paso de cobro contra el Staging actual, porque no elige método de
pago. El runner de la rama de #95 sí lo hace.

## Resultados de pruebas consolidados

- **BD integrada** (`main` + migraciones de #105/#95/#107/#108, desde cero), en
  el orden de CI: invariantes de seguridad y las suites del Release Gate y del
  workflow de Supabase, concurrencia incluida, **56/56 PASS**. `phase12` y
  `phase39` de concurrencia necesitan `node`/`python3` en el host de CI y no se
  ejecutaron en local.
- **Árbol integrado** (`main` + #105, #99, #95, #106, #107, #108, #94): **1157/1157**
  pruebas unitarias.
- **E2E V0 en Staging**: GitHub Actions run `38796720614` 3/3. Ejecuciones locales
  `E2E-0009` a `E2E-0018`. La última, con todo integrado y el runner de #95, 3/3
  (`E2E-0018`). Una ejecución intermedia falló por latencia transitoria de Staging
  (llamadas de 6 a 20 s).

## Migraciones por entorno

| Versión | Production | Staging |
| --- | --- | --- |
| hasta `20261014120000` | Aplicadas | Aplicadas |
| `20261015200000` (#105) | — | Aplicada |
| `20261016090000`, `20261016091000` (#95) | — | Aplicadas |
| `20261016100000` (#107) | — | Aplicada |
| `20261016110000` (#108) | — | Aplicada |

## Pendientes y riesgos

- **Sin autorización todavía**: merges en `main`, migraciones en Production,
  activación de Pro en SUR4 y cierre de #91.
- **Contract de #95**: PR posterior al despliegue.
- **#104**: requiere decisiones de producto (ver el ADR).
- **Voz**: integrar #90 exige renombrar el código de feature y la migración y
  resolver conflictos con #94.
- **Operación de lanzamiento** (#34, #35, #84): alta manual de datos de SUR4,
  Stripe Live, entregabilidad y demo comercial. Requieren decisiones del
  usuario. No se han tocado.
- **Latencia de Staging**: picos de 6 a 20 s en algunas peticiones. Conviene vigilarla
  antes de usar Staging para demos.

## Recuperación

- **Código**: revertir el merge correspondiente. Ninguna PR elimina columnas,
  datos ni funciones.
- **#95**: la expand es compatible con la app anterior, así que basta con revertir el código. No se
  borra el ledger.
- **#105**: retirar la concesión con `set_tenant_feature(..., false)` o
  restaurar la ausencia de la fila (ver `docs/PRO-EARLY-ACCESS-V1.md`).
- **#108**: volver a aplicar la definición de `20261007190056` de
  `convert_quote_to_order`.
- **#107**: revertir el código. La columna y las v2 pueden quedarse.

## Próximo paso concreto

Integrar #106 (P1 de la copistería piloto) y #99. Después, según el orden anterior,
con la migración en Production antes del merge cuando corresponda.
