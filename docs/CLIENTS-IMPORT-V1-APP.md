# Migration V1 · PR 4 — API e interfaz de la importación de clientes

Fecha: 16/10/2026. Se apoya en la PR 2 (base de datos, #122) y la PR 3 (motor CSV/XLSX, #123); esta rama las incluye por merge. Diseño: [ADR](adr/2026-10-16-clients-import-v1.md).

## API (`/api/imports/clients`)

**Control de acceso en todas las rutas:**

1. Cada ruta llama a `requireCurrentAccess`: sesión, tenant activo y membresía activa, con respuestas 401/403/503 (lo exige el test de guardas del Release Gate).
2. Después, `clientImportForbidden` exige rol owner, admin o manager (403) y la feature `clients_import` (404).
3. Las RPC repiten ambas comprobaciones.

**Formato de las respuestas:**

- `operationalJson`, con caché privada.
- Los errores de las RPC se traducen a mensajes en español: 401, 403, 404, 400, 409 (`batch_state` y `row_version_conflict`, que llega como `GC409` para que PostgREST no lo reintente) y 429.

| Ruta | Método | RPC |
| --- | --- | --- |
| `/access` | GET | ¿Puede abrir Clientes → Importar? |
| `/batches` | GET / POST | `client_import_list_batches` / `client_import_create_batch` |
| `/batches/[id]` | GET | `client_import_summary` |
| `/batches/[id]/rows` | POST | `client_import_stage_rows` (≤ 500 filas) |
| `/batches/[id]/finalize` | POST | `client_import_finalize` por tramos (`from_row`, `limit`) |
| `/batches/[id]/strategy` | POST | `client_import_set_strategy` |
| `/batches/[id]/decisions` | POST | `client_import_set_row_decisions` |
| `/batches/[id]/commit` | POST | `client_import_commit_chunk` |
| `/batches/[id]/cancel` | POST | `client_import_cancel` |
| `/batches/[id]/revert` | POST | `client_import_revert` por tramos (`limit`) |
| `/batches/[id]/report` | GET | `client_import_report`, paginado → CSV neutralizado (descarga) |

**Cron diario:** `/api/internal/files/cleanup` llama además a `client_import_purge_expired`. Un fallo se registra y no bloquea la limpieza de Files.

## Interfaz (Clientes → Importar, `/clients/import`)

**Acceso:**

- El botón **Importar** solo aparece a owner, admin y manager, y solo si `/access` responde `allowed`.
- `/api/context` no se ha tocado.

**Pasos del asistente:**

1. **Archivo:**
   - origen («Otro programa» con su nombre, o «Plantilla de Gestcopy» con descarga de la plantilla);
   - selector de archivo;
   - historial de importaciones (continuar, ver informe, descartar).
2. **Columnas:**
   - relación sugerida por sinónimos, editable;
   - elección de hoja en XLSX;
   - en móvil, lista con desplegables a todo el ancho.
3. **Vista previa:** totales y primeras 20 filas, con los problemas detectados en el navegador.
4. **Duplicados:**
   - la clasificación se pide en tramos de 1.000 filas; si se interrumpe, el historial la retoma desde el principio;
   - resumen del servidor;
   - estrategia: omitir, o completar campos vacíos con confirmación explícita;
   - «Crear igualmente» por cada posible duplicado;
   - filas que no se importarán.
5. **Importar:** confirmación y tramos de 100 con progreso. Ante `row_version_conflict` recarga el estado y sigue; si se interrumpe, se reanuda desde el historial.
6. **Informe:**
   - resultados;
   - descarga del CSV;
   - reversión con confirmación, en tramos de 250 con progreso, que muestra los desactivados, los restaurados y los que se mantienen. Si se interrumpe, se vuelve a pulsar y continúa donde se quedó.

**Tamaño de los tramos** (`lib/imports/clients/api.ts`): 1.000 filas al clasificar, 100 al confirmar y 250 al revertir. En la QA de Staging (mismo tipo de cómputo que Production), cada llamada tarda unos 0,3–0,6 s, así que queda muy por debajo del límite de 8 s incluso con autovacuum o un checkpoint en marcha.

**Lectura del archivo:** en un **Web Worker**. Si no está disponible, se hace en el hilo principal, cargando los lectores bajo demanda. En ambos casos papaparse y read-excel-file quedan fuera del paquete principal.

**Diseño:** componentes `gc-*` (`SectionCard`, `ConfirmDialog`, chips y KPI), responsive y con modo oscuro. Todo el texto se escapa (React, sin `dangerouslySetInnerHTML`).

**Ayuda:** artículo «Importar clientes» en Ayuda → Clientes. **Novedades no se actualiza** hasta activar la feature para algún tenant.

## Verificación local (pila Supabase aislada `import-v1-ui`, datos sintéticos)

**Entorno:** recorrido completo con Playwright contra `next dev` y la pila local con PR 2 + PR 3 + PR 4. Archivo CSV de 108 filas que cubre todas las clasificaciones.

**Flujo:**

- **Clasificación en la revisión:** 102 válidas, 2 ya existentes, 1 posible duplicado, 1 repetida en el archivo y 2 con errores.
- **Resultado** (con «completar campos vacíos» confirmado y el posible duplicado marcado como «Crear igualmente»): 103 creados, 2 completados, 3 omitidos y 0 errores.
- **Informe:** 109 líneas, con BOM y la fórmula del código neutralizada (`'=1+1`).
- **Reversión:** 103 desactivados y 2 restaurados.
- **Historial:** «Revertida» con «Ver informe».

**Lectura:**

- Un CSV con comillas sin cerrar se rechaza con aviso y línea; antes se truncaba sin avisar (corregido en la PR 3).
- El Worker se usa de verdad (lo carga Turbopack).

**Visual y calidad:** escritorio claro y móvil oscuro (390 px) sin desbordamiento horizontal ni errores de consola.

**Tras pasar a tramos (`20261016121000`):** el mismo recorrido da exactamente los mismos números (revisión, resultado, informe y reversión).

**Comprobaciones:** tipos, lint y build en verde. Tests 1195/1196 (falla el conocido de zona horaria). Test de guardas de rutas y suites de ayuda en verde.
