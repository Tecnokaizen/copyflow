# Migration V1 · PR 4 — API e interfaz de la importación de clientes

Fecha: 16/10/2026. Se apoya en la PR 2 (base de datos, #122) y la PR 3 (motor CSV/XLSX, #123); esta rama las incluye por merge. Diseño: [ADR](adr/2026-10-16-clients-import-v1.md).

## API (`/api/imports/clients`)

**Control de acceso en todas las rutas:**

1. Cada ruta llama a `requireCurrentAccess`: sesión, tenant activo y membresía activa, con respuestas 401/403/503 (lo exige el test de guardas del Release Gate).
2. Después, `clientImportForbidden` exige rol owner, admin o manager (403) y la feature `clients_import` (404).
3. Las RPC repiten ambas comprobaciones.

**Formato de las respuestas:**

- `operationalJson`, con caché privada.
- Los errores de las RPC se traducen a mensajes en español: 401, 403, 404, 400, 409 y 429.
  - El 409 cubre `batch_state`, `row_version_conflict` (llega como `GC409`, para que PostgREST no lo reintente) y `batch_incomplete` (`GC422`: faltan filas por enviar o por clasificar).

| Ruta | Método | RPC |
| --- | --- | --- |
| `/access` | GET | ¿Puede abrir Clientes → Importar? |
| `/batches` | GET / POST | `client_import_list_batches` / `client_import_create_batch_v2` (con `expected_rows`, las filas del archivo) |
| `/batches/[id]` | GET | `client_import_summary`, con el `plan` de la confirmación |
| `/batches/[id]/rows` | GET | `client_import_rows_page`: todas las filas por filtro (`filter`, `after`, `limit` ≤ 200) |
| `/batches/[id]/rows` | POST | `client_import_stage_rows` (≤ 500 filas) |
| `/batches/[id]/finalize` | POST | `client_import_finalize` por tramos (`from_row`, `limit`) |
| `/batches/[id]/strategy` | POST | `client_import_set_strategy` |
| `/batches/[id]/decisions` | POST | `client_import_set_row_decisions`: `create`, `skip`, `fill_blanks`, `exclude` o `include`; devuelve el `plan` |
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
   - origen («Otro programa» con su nombre, o «Plantilla de Gestcopy» con descarga de la plantilla versionada, `plantilla-clientes-gestcopy-v1.csv`);
   - selector de archivo;
   - historial de importaciones (continuar, ver informe, descartar).
2. **Columnas:**
   - relación sugerida por sinónimos, editable;
   - elección de hoja en XLSX;
   - si el archivo tiene las columnas de una versión de la plantilla (en cualquier orden, con o sin tildes), se indica cuál;
   - en móvil, lista con desplegables a todo el ancho.
3. **Vista previa:** totales y primeras 20 filas, con los problemas detectados en el navegador.
4. **Revisión:**
   - la clasificación se pide en tramos de 1.000 filas; si se interrumpe, el historial la retoma desde el principio;
   - totales del **plan del servidor**, calculados sobre todas las filas: se crearán, se completarán, se omiten (duplicados), excluidas por el usuario y no importables (errores y repetidas en el archivo);
   - estrategia: omitir, o completar campos vacíos con confirmación explícita;
   - **todas las filas**, de 50 en 50, con filtros: para revisar (por defecto), posibles duplicados, ya existen, repetidas en el archivo, con errores, nuevas, excluidas y todas. Cada fila muestra el cliente con el que coincide y qué se hará con ella;
   - por fila: «Excluir» / «Volver a incluir» en las importables, y «Crear igualmente» / «No crear» en los posibles duplicados;
   - nada se escribe en la cartera hasta confirmar.
5. **Importar:** los mismos totales del plan, confirmación y tramos de 100 con progreso. El primer tramo lleva la `row_version` del plan mostrado: si el lote cambió después (otra pestaña u otra persona), el servidor responde `row_version_conflict`, **no se importa nada** y el asistente vuelve a la revisión con los totales al día. Si se interrumpe, se reanuda desde el historial.
6. **Informe:**
   - resultados;
   - descarga del CSV;
   - reversión con confirmación, en tramos de 250 con progreso, que muestra los desactivados, los restaurados y los que se mantienen. Si se interrumpe, se vuelve a pulsar y continúa donde se quedó.

**Integridad tras la auditoría (migración `20261016124000`, #127):**

- **Al crear el lote**, se declara cuántas filas tiene el archivo.
- **Al clasificar**, el asistente sigue el `next_row` del servidor (la primera fila sin clasificar). Si no avanza, se detiene. El lote solo queda revisado cuando no falta ninguna.
- **Al reanudar desde el historial** un lote al que le faltan filas (por ejemplo, porque se cerró la página mientras se enviaban), **no se clasifica**:
  - el asistente vuelve al paso 1 e indica cuántas filas faltan;
  - pide el archivo original con las mismas columnas;
  - con ese archivo, el servidor reutiliza el lote, recibe el resto y lo clasifica.
- **Un lote ya revisado** se abre en la revisión, sin volver a enviar filas.
- **Los lotes caducados** solo ofrecen «Ver resumen»; los que caducaron a medio importar aparecen como «Caducada a medias».

**Tamaño de los tramos** (`lib/imports/clients/api.ts`): 1.000 filas al clasificar, 100 al confirmar y 250 al revertir. En la QA de Staging (mismo tipo de cómputo que Production), cada llamada tarda unos 0,3–0,6 s, así que queda muy por debajo del límite de 8 s incluso con autovacuum o un checkpoint en marcha.

**Revisión completa (migración `20261016126000`):**

- Ya no hay límite de 200 filas en la revisión: el resumen solo da contadores y plan, y las filas llegan por páginas (`client_import_rows_page`, cursor por número de fila).
- Si al cargar una página la `row_version` no coincide con la del plan en pantalla, el asistente vuelve a pedir el plan.
- Una fila excluida se omite al confirmar con el motivo «Excluida en la revisión», sea cual sea su decisión. La exclusión se mantiene si se cambia la estrategia o se reclasifica el lote, y al volver a incluir la fila recupera su decisión.
- El informe y el resultado distinguen las filas excluidas de las omitidas por duplicado. El resultado usa `counts.excluded`, que el lote conserva después de la purga de 30 días.

**Página de Clientes:** si la comprobación de `/access` falla (por ejemplo, sin red), la página funciona igual y el botón **Importar** no aparece.

**Lectura del archivo:** en un **Web Worker**. Si no está disponible, se hace en el hilo principal, cargando los lectores bajo demanda. En ambos casos papaparse y read-excel-file quedan fuera del paquete principal.

**Diseño:** componentes `gc-*` (`SectionCard`, `ConfirmDialog`, chips y KPI), responsive y con modo oscuro. Todo el texto se escapa (React, sin `dangerouslySetInnerHTML`).

**Ayuda:** artículo «Importar clientes» en Ayuda → Clientes. **Novedades no se actualiza** hasta activar la feature para algún tenant.

## Límites

**Vigentes (técnicos, ADR D8):**

| Límite | Valor |
| --- | --- |
| Tamaño del archivo | 5 MB |
| Filas por archivo | 10.000 |
| XLSX descomprimido | 64 MB, ≤ 1.000 entradas y ≤ 50 hojas |
| Columnas | 200 |
| Caracteres por celda | 32.767 (el máximo de Excel) |
| Filas por envío | 500 |
| Lotes abiertos por copistería | 10 |

**Límites comerciales por plan:** no se implementan en V1 (ADR, decisión 6). La feature `clients_import` se activa por tenant y no tiene filas en `plan_features`.

**Extensión futura (sin implementar):**

- Una fila de `plan_features` para `clients_import` por plan, con `limit_value` como máximo de filas por importación. `NULL` significa sin límite.
- Se resolvería como `resolve_tenant_storage_limit_bytes`: suscripción vigente (`trialing`, `active` o `past_due`), feature habilitada y `NULL` para no aplicar el límite.
- `client_import_create_batch_v2` lo compararía con `p_expected_rows` y respondería con un código propio. La interfaz lo mostraría en el paso 1, antes de enviar filas.
- Los overrides por tenant seguirían sirviendo para pilotos.
- Requiere su propia migración, sus pruebas y una decisión comercial. No cambia precios ni Stripe.

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
