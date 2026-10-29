# Sprint de consolidación — 15 a 18 de octubre de 2026

Registro vivo del sprint. Base: `main` `03fa094`. `main` actual: `25875b9`.
Staging integrado: `gestcopy-staging` `4570ea5` (sin la corrección del logo de
#58, `d487d54`, que solo se ha probado en local). Con autorización expresa se
han integrado **#106**, **#99**, **#105** (con su migración), **#94** (sin
migraciones), **#95**, **#107** y **#108** (migraciones aplicadas antes del
merge) y **#58** (sin migraciones).
La documentación del sprint (#109) está integrada en `25875b9` y #91 se cerró el
16/10 como sustituida por #95. Solo queda sin fusionar #90 (voz, borrador). Production ha recibido la migración de #105 (dos
filas de catálogo, sin concesiones) y la expand de #95 (columnas nulas, guardas
y la firma nueva de `record_order_payment`; el libro de cobros intacto) y la
dirección opcional de #107 (columna nula y RPC v2; clientes existentes intactos)
y la herencia de notas de #108 (solo `convert_quote_to_order`; sin cambios de datos). Ningún tenant tiene Pro activado. Por
lo demás, Production solo se ha consultado en modo lectura.

Arquitectura respetada en todo el sprint: un repositorio y un core Next.js, un
proyecto y un deployment de Production en Vercel, un proyecto Supabase con una
única PostgreSQL compartida y N tenants aislados por `tenant_id`, memberships,
autorización y RLS. Staging es un entorno de pruebas separado y no
infraestructura por tenant. No hay código específico de SUR4.

## Estado por funcionalidad

| Funcionalidad | Issue | PR · head | Migraciones | Pruebas | Staging | Merge |
| --- | --- | --- | --- | --- | --- | --- |
| Gestcopy Pro · Acceso anticipado V1 | — | #105 · `f3afff4` | `20261015200000_pro_early_access_features_v1` | 1111 unitarias con `main` `53deec7`; SQL `phase47` (en el gate); 6 mutaciones detectadas | ON/OFF/retirada con owner + viewer, 1440/375 px, claro/oscuro; E2E desde GitHub Actions run `38796720614` 3/3 | **Integrada**: `main` `725deff`, migración aplicada en Production, ningún tenant enrolado |
| Novedades y ayuda plegable | — | #99 · `3e77e93` | — | Ayuda 27/27; CI verde | 9/9: metadatos, canonical, filtros con teclado, secciones plegables, 60 enlaces con 200, escritorio/móvil, claro/oscuro | **Integrada**: `main` `53deec7`, verificada en Production |
| Métodos de pago y justificantes | #103 | #95 · `db46e50` | `20261016090000_order_total_validation_p1`, `20261016091000_order_payment_methods_receipts_expand` | 1153 unitarias con `main` `8e5dfe1`; SQL 54/54; suites de `main` sobre la expand 51/51; smokes de navegador | Expand con la app anterior (`E2E-0013`); E2E V0 con método y justificante (`E2E-0015`, `E2E-0018`); reintentos, ajenos, anulación, viewer, escritorio/móvil | **Integrada**: migraciones en Production a las 22:32 UTC y `main` `6e3fc12`. Contract pendiente (≥ 24 h) |
| Pie de presupuestos (P1) | #100 | #106 · `5b28738` | — | Regresión que falla en `main`; 1077/1077 | Editor real: 4 líneas + Intro se guarda; 5.ª línea → 400; viewer 403 | **Integrada**: `main` `f120dbc`, #100 cerrada |
| Dirección opcional de clientes | #101 | #107 · `af37f94` | `20261016100000_clients_address_v1` | 1157 unitarias con `main` `6e3fc12`; SQL 55/55 con `phase48`; suites de `main` sobre la migración 54/54; smokes de clientes, pedidos y presupuestos | Alta con y sin dirección, edición, conservación, borrado, viewer 403, escritorio/móvil | **Integrada**: migración en Production a las 22:57 UTC y `main` `81aa3de` |
| Notas del presupuesto → pedido | #102 | #108 · `ed33422` | `20261016110000_quote_conversion_notes_v1` | SQL 56/56 con `phase49`; `phase34` y `phase38` actualizadas; suites de `main` sobre la migración: solo cambian a propósito las dos aserciones de notas | `phase49` completa contra la BD de Staging, sin dejar datos | **Integrada**: migración en Production a las 23:23 UTC y `main` `1e50228` |
| Modificación de líneas de pedido | #104 | — | — | — | — | **No implementado**: los pedidos no tienen modelo de líneas. Diseño en `docs/adr/2026-10-15-order-lines-v1.md` |
| Resiliencia de sesión | — | #94 · `b6427a6` | — | 1141/1141 con `main` `725deff`; 4 smokes de navegador | Sesión caducada → 401 y el borrador se recupera; viewer 403; contexto anónimo 401 | **Integrada**: `main` `8e5dfe1`, con la resolución de `3d1f386` |
| Logos del tenant | — | #58 · `d487d54` | — | 1157/1157 con `main` `1e50228`; smoke nuevo de cabecera 48/48 (falla sin la corrección); 9 smokes que montan la cabecera | Logos 3:1 y 1:3 proporcionados, sustitución sin recarga, quitar → monograma, escritorio/móvil, claro/oscuro | **Integrada**: `main` `4877db7`. Corregido al integrarla: con la etiqueta Pro de #105, a 320 px el logo apaisado quedaba bajo la etiqueta |
| Gestcopy AI — Pedidos por voz | #76, #78–#82 | #90 · `bf18b26` (borrador, en conflicto) | `20261012120000_ai_voice_orders_foundation_v1` (sin aplicar al cierre del sprint; **histórico**, ver la nota) | — | — | No integrar; plan en `docs/AI-VOICE-ORDERS-PLAN.md` |
| Corrección de total (#91) | — | #91 · `dd3c90c` (en conflicto) | Su migración viajó en #95 (`20261016090000`), ya en Production | — | — | **Cerrada** el 16/10 (00:02 UTC), sustituida por #95: su migración es idéntica a `20261016090000` y su suite SQL está en `main`; la parte de app la cubre #93 (`367d22a`). Rama conservada |

> **Nota (19/10/2026): la fila de la voz es histórica.** Refleja el estado al
> cierre del sprint. Después, la migración de #90 se renumeró dos veces
> (`20261012120000` → `20261018150000` → `20261018190000`) y
> `20261018190000_ai_voice_orders_foundation_v1` se aplicó en Staging el 18/10 a
> las 18:41 UTC. Staging tiene 84 migraciones: las 79 de `main`, D2/D1 (#135/#136,
> `20261018160000`–`170000`), A1 (#138, `20261018180000`) y la voz. Production no
> tiene ninguna de ellas. Orden de merge: #128 (ya en `main`) → #135 → #136 →
> #138 → #90 → C1. #90 sigue en borrador y sin merge.

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

1. ~~**#106**~~: integrada (`f120dbc`).
2. ~~**#99**~~: integrada (`53deec7`).
3. ~~**#105**~~: integrada (`725deff`) y migración aplicada en Production.
4. ~~**#94**~~: integrada (`8e5dfe1`) con la resolución de `3d1f386`.
5. ~~**#95**~~: migraciones en Production y después merge (`6e3fc12`). #91 cerrada
   el 16/10. Pendiente: pasadas 24 h y con autorización, la PR de contract.
6. ~~**#107**~~: migración en Production y después merge (`81aa3de`).
7. ~~**#108**~~: migración en Production y después merge (`1e50228`).
8. ~~**#58**~~: integrada (`4877db7`).
9. ~~**#109**~~ (esta documentación y Novedades): integrada (`25875b9`).

Con #95 en `main`, el workflow `E2E staging` lanzado desde `main` elige método
de pago y vuelve a pasar contra Staging (run `38818090064`, 3/3; tras #107, run
`38820759045`, 3/3; tras #108, run `38823386750`, 3/3; tras #58, run `38825177132`, 3/3).

## Integraciones en `main` (15/10/2026)

Autorizadas #106 y #99, en ese orden, después #105 con su migración, #94, #95, #107 y #108 con sus migraciones antes del merge, #58 y la documentación #109. Antes
de cada una se revalidaron el head, los checks y el estado `CLEAN`. Squash
merge, sin borrar la rama. #99, #105, #94, #95, #107, #108, #58 y #109 se fusionaron con `--match-head-commit`.
#91 se cerró el 16/10 a las 00:02 UTC, con autorización, como sustituida por #95.

| Orden | PR | Commit en `main` | Antes del merge | CI en `main` (push) | Production | Verificación |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | #106 | `f120dbc` (21:10 UTC) | head `5b28738`, 4/4 checks, `CLEAN` | Release Gate App y Database: success | Deployment `7104463058`: success | Salud pública: `/ayuda` y `/auth/login` 200, `/api/context` anónimo 403. El pie solo se ve con sesión en un tenant: no se probó en Production para no usar cuentas reales. Validado sobre el mismo código en Staging |
| 2 | #99 | `53deec7` (21:14 UTC) | head `3e77e93`, 4/4 checks, `CLEAN`; con `main` + #106: tsc OK y 1085/1085 | Release Gate App y Database: success | Deployment `7104551268`: success | `/ayuda/novedades` anónima en Production: título, canonical, 28 versiones y 153 entradas con el texto corregido, filtros con ratón y teclado, 10 secciones plegadas, 60 enlaces con 200, escritorio/móvil, claro/oscuro sin scroll horizontal. Login de `app`, `demo` y `sur4` 200 |
| 3 | #105 | `725deff` (21:41 UTC) | head `f3afff4` (`main` `53deec7` fusionado en `a026d57`), 6/6 checks, `CLEAN`; árbol de `main` idéntico al head validado | Release Gate App y Database: success (run `38811797782`) | Deployment `7105095845`: success (21:42 UTC). Migración `20261015200000` aplicada a las 21:44 UTC, después del Release Gate | Antes del merge: código nuevo contra una BD con solo las migraciones de `main` → `{"pro": false}` y `/pro` denegado para owner, viewer y ajeno; huella de Production igual a la BD probada; dry-run solo con esta migración. Después: `/api/context` anónimo 403 con `private, no-store` (marcador del código nuevo), `/pro` → login, `/auth/login` de `app`, `demo` y `sur4` 200; 67 migraciones, catálogo con los dos códigos, 0 filas de plan, 0 overrides, ningún tenant con Pro ni voz, `quotes` sin cambios |
| 4 | #94 | `8e5dfe1` (22:04 UTC) | head `b6427a6` (`main` `725deff` fusionado con la resolución de `3d1f386`), todos los checks en verde | Release Gate App y Database: success (run `38814595799`) | Deployment `7105518325`: success (22:05 UTC). Sin migraciones | Sin sesión, `/api/context`, `/api/clients`, `/api/orders` y `/api/orders/options` → 401 `SESSION_EXPIRED` con caché privada e id de correlación (antes 403); `/pro` y `/orders` → login; `/auth/login`, `/ayuda` y `/ayuda/novedades` → 200 (25/25). El flujo con sesión se validó en Staging, no en Production |
| 5 | #95 | `6e3fc12` (22:33 UTC) | head `db46e50` (`main` `8e5dfe1` fusionado en `e9363b8`), 7/7 checks, `CLEAN`. Antes del merge, migraciones en Production: foto previa, dry-run con solo `20261016090000` y `20261016091000`, `db push` a las 22:32 UTC; después, libro de cobros, totales y archivos con las mismas huellas, 0 cobros con método, md5 de funciones esperados, firma de 4 argumentos intacta y comprobación HTTP 25/25 con la app anterior | Release Gate App y Database: success (run `38817924266`) | Deployment `7106029461`: success (22:34 UTC) | Comprobación sin sesión 25/25; login de `app`, `demo` y `sur4` 200; E2E staging desde `main` (run `38818090064`): 3/3 con método Bizum y justificante, pedido `E2E-0019` |
| 6 | #107 | `81aa3de` (22:58 UTC) | head `af37f94` (`main` `6e3fc12` fusionado en `f2cd96b`), todos los checks en verde. Antes del merge, migración en Production: foto previa, dry-run con solo `20261016100000`, `db push` a las 22:57 UTC; después, misma huella de los clientes existentes y ninguno con dirección, RPC v1 sin cambios, v2 y restricción con el md5 esperado, y comprobación HTTP 25/25 con la app anterior | Release Gate App y Database: success (run `38820634673`) | Deployment `7106431012`: success (22:59 UTC) | Comprobación sin sesión 25/25; login de `app`, `demo` y `sur4` 200; E2E staging desde `main` (run `38820759045`): 3/3, pedido `E2E-0020` |
| 7 | #108 | `1e50228` (23:23 UTC) | head `ed33422` (`main` `81aa3de` fusionado en `6a929d3`), todos los checks en verde. Antes del merge, migración en Production: foto previa, dry-run con solo `20261016110000`, `db push` a las 23:23 UTC; después, misma huella de pedidos y presupuestos, `convert_quote_to_order` con el md5 y los permisos esperados y la firma antigua intacta, y comprobación HTTP 25/25 | Release Gate App y Database: success (run `38823303324`) | Deployment `7106828510`: success (23:24 UTC); la PR no cambia la app | Comprobación sin sesión 25/25; login de `app`, `demo` y `sur4` 200; E2E staging desde `main` (run `38823386750`): 3/3, pedido `E2E-0021` |
| 8 | #58 | `4877db7` (23:41 UTC) | head `d487d54` (`main` `1e50228` fusionado en `6211224` y corrección del logo con la etiqueta Pro a 320 px), 4/4 checks, `CLEAN`; árbol de `main` idéntico al head | Release Gate App y Database: success (run `38825075304`) | Deployment `7107090184`: success (23:42 UTC). Sin migraciones | Comprobación sin sesión 25/25; login de `app`, `demo` y `sur4` 200; E2E staging desde `main` (run `38825177132`): 3/3, pedido `E2E-0022` |
| 9 | #109 | `25875b9` (23:58 UTC) | head `046b5a4` (`main` `4877db7` fusionado en `dc65988`; datos contrastados con GitHub y Production), 4/4 checks, `CLEAN` | Release Gate App y Database: success (run `38826713147`) | Deployment `7107322201`: success (23:58 UTC). Solo documentación y Novedades | `/ayuda/novedades` anónima: 200, 29 versiones y 163 entradas (la última del 16/10), filtros, teclado, 10 secciones, 60 enlaces con 200, móvil/escritorio, claro/oscuro; comprobación general 25/25 |

Sin regresiones: no ha hecho falta el procedimiento de recuperación. Changelog
actualizado en esta PR (#109) con #106 y #99 y, en una versión del 16/10 (hora de
Madrid), con #94, #95, #107, #108 y #58. Integrado con #109 (`25875b9`) y verificado en Production. #105 no tiene entrada en Novedades: no cambia nada visible para
ningún tenant mientras no haya una concesión. El uso real con sesión en
Production no se ha observado todavía: no hubo tráfico autenticado entre el
despliegue y el cierre de la integración.

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
| `20261015200000` (#105) | Aplicada (15/10, 21:44 UTC) | Aplicada |
| `20261016090000`, `20261016091000` (#95) | Aplicadas (15/10, 22:32 UTC) | Aplicadas |
| `20261016100000` (#107) | Aplicada (15/10, 22:57 UTC) | Aplicada |
| `20261016110000` (#108) | Aplicada (15/10, 23:23 UTC) | Aplicada |

## Pendientes y riesgos

- **Sin autorización todavía**: el contract de #95, la activación de Pro en SUR4 y
  el fast-forward de `gestcopy-staging` a `main` (solo le falta la corrección del
  logo de #58).
- **Contract de #95**: PR posterior, no antes del 16/10 a las 22:34 UTC (24 h
  después del despliegue de la app que siempre envía método).
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
  borra el ledger. Reversión de la base de datos, probada y solo mientras no haya
  cobros con método o justificante:
  `supabase/rollbacks/20261016091000_order_payment_methods_receipts_expand.sql`.
- **#105**: retirar la concesión con `set_tenant_feature(..., false)` o
  restaurar la ausencia de la fila (ver `docs/PRO-EARLY-ACCESS-V1.md`).
- **#108**: `supabase/rollbacks/20261016110000_quote_conversion_notes_v1.sql`
  (probada; vuelve a la definición de `20261007190056`). Las notas ya heredadas se
  quedan en sus pedidos.
- **#107**: revertir el código. La columna y las v2 pueden quedarse. Retirarlas:
  `supabase/rollbacks/20261016100000_clients_address_v1.sql` (probada; se niega
  si algún cliente ya tiene dirección).
- **#58**: revertir el código; no hay nada que deshacer en la base de datos.

## Próximo paso concreto

Todas las PR del sprint están integradas (#106, #99, #105, #94, #95, #107, #108,
#58 y la documentación #109) y #91 está cerrada. Quedan, con autorización: la PR
de contract de #95 (no antes del 16/10 a las 22:34 UTC) y el fast-forward de
`gestcopy-staging`. Después, #104 (decisiones de producto) y la voz (#90).
