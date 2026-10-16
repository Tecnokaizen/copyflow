# Migration V1 · PR 5 — QA en Staging de la importación de clientes

Fecha: 16/10/2026.

- Prueba de extremo a extremo de la PR 2 (#122, base de datos), la PR 3 (#123, motor) y la PR 4 (#124, API e interfaz) contra **Supabase Staging**.
- Se usa la preview de la PR 4 en Vercel, que apunta a Staging.

**Production no se toca. La feature `clients_import` solo se activa para los tenants sintéticos `e2e` y `e2e-import`.**

## Qué se prueba

Script `e2e/staging/clients-import-qa.mts` (Playwright con interfaz y API) con archivos sintéticos de `e2e/staging/clients-import-files.mts`:

| Archivo | Formato | Contenido |
| --- | --- | --- |
| `clientes-100` | CSV en Windows-1252, separador `;` | Errores, repetidos y duplicados mezclados |
| `clientes-1000` | XLSX | Igual, en una hoja |
| `clientes-10000` | CSV en UTF-8 con BOM, separador `,` | El máximo de un lote |

**El resultado esperado lo calcula un oráculo independiente.** Usa el mismo motor, las mismas reglas de duplicados y los clientes que ya tiene el tenant, leídos con la clave de Staging. No se fía de lo que devuelva el servidor.

| Paso | Comprobación |
| --- | --- |
| 1. Viewer de `e2e` | `/access` dice que no, crear un lote da 403 y no ve el botón «Importar» ni la página |
| 2. Feature desactivada en `e2e-import` | `/access` dice que no y crear da 404 `feature_disabled`. Después se activa **solo** en los dos tenants sintéticos |
| 3. Owner de `e2e`, escritorio claro, 100 filas | Revisión = oráculo, altas = válidas, informe con todas las filas y reversión desde la interfaz |
| 4. Owner de `e2e-import`, móvil oscuro (390 px), 1.000 filas XLSX | Revisión = oráculo. Un tramo por API y **dos confirmaciones simultáneas** del siguiente (una escribe y la otra recibe 409). Después, reanudación desde el historial. Altas = válidas, sin duplicados |
| 5. Owner de `e2e-import`, escritorio, 10.000 filas | Revisión = oráculo, altas = válidas, sin fallos, informe con las 10.001 líneas |
| 6. Aislamiento entre tenants | Leer, revertir o descargar el informe de un lote ajeno da 404 en ambos sentidos, y el historial no lo muestra |
| 7. Reversión de 10.000 desde la interfaz | Lote `reverted`, todos los creados desactivados y ningún cliente del lote activo |
| 8. Lotes atascados (`STUCK_BATCH_FILES`) | Un lote que se quedó en `uploaded` se retoma desde el historial, su revisión coincide con el oráculo y se descarta |
| Tiempos | Duración y estado de **cada** llamada a clasificar, confirmar y revertir. Ningún 5xx |

## Rondas y hallazgos

Cada ronda usa archivos nuevos (`SUFFIX`, `SEED`), para no reutilizar lotes.

| Ronda | Resultado | Hallazgo | Corrección |
| --- | --- | --- | --- |
| r2 (PR 4 inicial, migración `…120000`) | Pasos 1–3 y 1.000 correctos. **Una confirmación simultánea acabó en 504 a los 125 s.** La clasificación de 10.000 dio 500 | PostgREST **reintenta** `40001`, el código que usaba el conflicto de versión. Además, la clasificación en una pasada superaba el `statement_timeout` de 8 s | `…121000`: conflicto `GC409` (409 inmediato), y clasificación y reversión por tramos |
| r3 (con `…121000`) | 100 correctos. **La clasificación de 1.000 dio 500** | Con estadísticas antiguas, el planificador estimaba 1 fila para el lote recién preparado y hacía un bucle anidado cuadrático. En local, 500 filas pasaban de 60 s | `…122000`: clasificación sin dependencia de las estimaciones, más ajustes de plan en confirmación y reversión. `phase50` reproduce el caso |
| r4 (con `…122000`) | **Todo correcto**, también la reanudación de los dos lotes atascados de r2 y r3. En la base: clasificación con mediana de 450 ms, confirmación de 661 ms y reversión de 576 ms. **Una clasificación tardó 6,8 s** | Fue el último tramo de 10.000, justo cuando autovacuum procesaba la reversión de 8.329 clientes (7 índices GIN) y había un checkpoint. Sin carga, la lectura de ese tramo tarda 426 ms | Tramos de la interfaz: de 2.000 / 200 / 500 a **1.000 / 100 / 250**, para tener margen frente a esa contención |
| r5 (tramos nuevos) | **Todo correcto.** En la base, la clasificación tuvo un máximo de 905 ms. **El resumen de la revisión tardó 4,2 s** justo después de clasificar 10.000 filas | El resumen cruzaba todo el lote con `clients` (8.241 coincidencias) antes de quedarse con 200 | `…123000`: el resumen elige primero las filas y solo busca esos clientes. Además, cada ronda usa un nombre de origen propio: los mismos códigos de origen de una ronda anterior cuentan, con razón, como clientes existentes, y dejaban casi sin altas el lote de 10.000 |
| r6 (final) | **Todo correcto, con miles de altas.** Ver abajo | | |

## Resultado final (r6)

**Versiones:**

- PR 4 en `a8f70fc` (preview `copyflow-f3fm0rk2o`), que incluye la PR 2 en `4f4be2e` y la PR 3 en `987f590`;
- Staging con las cuatro migraciones (75 en total);
- `failures: []`.

| Paso | Resultado |
| --- | --- |
| 1. Viewer | `allowed: false`, crear da 403, 0 botones «Importar» |
| 2. Feature desactivada | `allowed: false`, crear da 404 `feature_disabled` |
| 3. 100 filas en escritorio | Revisión = oráculo: 85 válidas, 9 repetidas, 6 con errores. Resultado: 85 creadas, 15 omitidas, 0 fallos. Informe de 101 líneas. Reversión: 85 desactivadas |
| 4. 1.000 filas XLSX en móvil oscuro | Revisión = oráculo: 830 válidas, 12 existentes, 97 repetidas, 61 con errores. Confirmaciones simultáneas: `[200, 409]`. Reanudación desde el historial: 830 creadas, 830 vinculadas al lote y ningún duplicado |
| 5. 10.000 filas en escritorio | Revisión = oráculo: 8.243 válidas, 101 existentes, 1.011 repetidas, 645 con errores. 8.243 creadas, 0 fallos. Informe de 10.001 líneas. 8.243 clientes vinculados. Validación en 43 s y confirmación en 136 s (100 llamadas) |
| 6. Aislamiento | Todas las lecturas cruzadas dan 404 en ambos sentidos y el historial no muestra lotes ajenos |
| 7. Reversión de 10.000 desde la interfaz | `reverted`: 8.243 desactivados y 0 activos en 33 llamadas (46 s) |
| Errores | Ningún 5xx. Errores de consola, todos esperados: peticiones a terceros bloqueadas por el propio script (`ERR_FAILED`) y los 403, 404 y 409 de las pruebas negativas |

**Tiempos dentro de la base** (logs de Staging, `response.origin_time`; límite de 8 s):

| RPC | Llamadas | Mediana | p95 | Máximo |
| --- | --- | --- | --- | --- |
| `client_import_stage_rows` (500 filas) | 20 | 388 ms | 549 ms | 558 ms |
| `client_import_finalize` (1.000 filas) | 10 | 887 ms | 1,5 s | 1,9 s |
| `client_import_commit_chunk` (100 filas) | 103 | 476 ms | 1,4 s | 3,2 s |
| `client_import_revert` (250 filas) | 33 | 483 ms | 1,2 s | 3,8 s |
| `client_import_summary` | 8 | 206 ms | 458 ms | 514 ms |
| `client_import_report` (1.000 filas por página) | 11 | 671 ms | 2,6 s | 3,4 s |

- Los máximos se dan con la base cargada: autovacuum procesando los miles de clientes creados y revertidos en las rondas anteriores.
- Incluso así hay al menos el doble de margen frente al límite de 8 s.
- Medidas desde el navegador, las llamadas suman la función de Vercel: sesión, membresía y RPC. La más lenta tardó 9,5 s. Las funciones del proyecto tienen Fluid con un límite de 300 s, así que eso no corta nada.

## Auditoría independiente: rondas r7 y r8 (migración `20261016124000`, #127)

**Contexto:** tras integrar #122 en Production, una auditoría encontró tres defectos P1. Se reprodujeron sobre el esquema de Production y se corrigieron en #127 (base de datos) y #124 (interfaz). Esta QA los comprueba de extremo a extremo con tres pasos nuevos.

| Paso | Comprobación | r8 |
| --- | --- | --- |
| 9. Subida interrumpida | Se corta el segundo envío de filas de un CSV de 1.200 filas. El lote queda en `uploaded` con 500 de 1.200. El historial dice «Faltan 700 filas» y «Continuar» vuelve al paso 1 pidiendo el archivo. Con el archivo, el **mismo lote** se completa (1.200) y la revisión coincide con el oráculo | Correcto |
| 10. API | El último rango primero: `uploaded`, `done=false`, `next_row=1`. Confirmar antes de clasificar todo: 409. Completo: `validated`. Con 2 de 3 filas: 409 `batch_incomplete`. Fila fuera del recuento: 400. Crear sin recuento: 400 | Correcto |
| 11. Purga a mitad de confirmación (`PURGE_ONLY`, en r7) | Un operador movió al pasado la caducidad de `api-orden.csv` (1 de 3 creadas). La purga elimina sus 3 filas y se conserva `created=1`. Confirmar y revertir dan 409. El historial muestra «Caducada a medias» con solo «Ver resumen» | Correcto |

**r7 falló en el paso 5, pero por el oráculo.** El servidor marcaba 37 filas más como «ya existe».

- **Comprobación independiente en Staging:** 0 filas válidas coinciden con alguno de los 19.196 clientes previos, 0 filas «ya existe» carecen de coincidencia real y 0 filas quedan sin clasificar.
- **Causa:** el oráculo paginaba los clientes con `OFFSET` y sin `ORDER BY`. Con escaneos sincronizados bajo carga, perdió 37.
- **Solución:** ahora ordena por `id`. Recalculado con los clientes de ese momento, da exactamente lo mismo que el servidor.

**r8, todo correcto** (`failures: []`):

- 100 / 1.000 / 10.000 filas iguales al oráculo; 8.122 altas y 8.122 revertidas.
- Aislamiento: 404 en ambos sentidos.
- Pasos 9 y 10 correctos.

**Tiempos dentro de la base en r8:**

| RPC | Mediana | Máximo |
| --- | --- | --- |
| Clasificación | 1,3 s | 2,5 s |
| Confirmación | 429 ms | 3,3 s |
| Reversión | 416 ms | 7,2 s |
| Resumen | — | 1,1 s |

La reversión de 7,2 s ocurrió con la base cargada por miles de altas y reversiones seguidas.

**Los únicos 500 de PostgREST son las pruebas negativas:** `batch_rows_purged`, `import batch not found` (tenant ajeno) y `batch_state`. PostgREST los devuelve como 500 y la app los traduce a 404 o 409.

## Datos que quedan en Staging

Todo es sintético y solo afecta a `e2e` y `e2e-import`:

- lotes de cada ronda: revertidos, confirmados o cancelados;
- clientes importados y luego desactivados, que conservan sus claves (es la limitación conocida de la reversión);
- un lote de r1 (`clientes-1000.xlsx`) que se quedó en `committing` con 166 altas, antes de los tramos. Caduca a los 30 días.

La feature sigue activa solo en esos dos tenants. **Production no se ha tocado.**

## Cómo ejecutarlo

Requisitos:

- Las migraciones de Migration V1 aplicadas en Staging: las cuatro de #122 y `20261016124000` (#127).
- Los tenants `e2e` (owner y viewer) y `e2e-import` (owner `e2e-import-owner@example.com`).
- Playwright instalado fuera del repositorio.
- Los secretos en `.env.e2e.local`, que nunca se imprimen.

```bash
OUT=/tmp/qa SEED=1379 SUFFIX=-r6 npx tsx e2e/staging/clients-import-files.mts
```

```bash
set -a && source ../copyflow-e2e/.env.e2e.local && set +a && OUT=/tmp/qa SUFFIX=-r6 PREVIEW_URL=https://<preview>.vercel.app VIEWER_PW_FILE=… IMPORT_PW_FILE=… PLAYWRIGHT_MODULE=…/playwright/index.mjs npx tsx e2e/staging/clients-import-qa.mts
```

El script se niega a arrancar si la URL no es una preview `*.vercel.app` o si Supabase no es Staging. El resultado queda en `$OUT/results.json`, junto con las capturas.
