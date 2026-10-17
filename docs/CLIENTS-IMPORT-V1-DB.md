# Migration V1 · PR 2 — Base de datos y contratos de la importación de clientes

Fecha: 16/10/2026.

- Base: `main` `bef29ac`.
- Implementa el [ADR](adr/2026-10-16-clients-import-v1.md) (diseño cerrado: D1–D9, S1–S12).
- Migraciones: `20261016120000_clients_import_v1.sql`, `20261016121000_clients_import_v1_chunks.sql`, `20261016122000_clients_import_v1_finalize_plan.sql` y `20261016123000_clients_import_v1_summary.sql`, **aplicadas en Production el 16/10** (#122). Corrección posterior: `20261016124000_clients_import_v1_integrity.sql`.

**No se aplica en Production sin gate y autorización. La feature `clients_import` no se activa para ningún tenant.**

## Objetos

| Objeto | Detalle |
| --- | --- |
| `imports_private` | Esquema privado. Sin `USAGE` para `anon`, `authenticated`, `service_role` ni `authenticator` (invariante del Release Gate) |
| `client_import_batches` | Lote: tenant, autor, origen, nombre, tamaño y SHA-256 del archivo, mapeo y su hash, estrategia, estado, contadores, `row_version` y caducidad a 30 días. Índice único `(tenant, sha256, hash del mapeo)` para los lotes vivos o confirmados |
| `client_import_rows` | Fila: datos normalizados, claves de duplicado (email, teléfono, NIF y teléfono sin prefijo), errores, avisos, clasificación, decisión, resultado, cliente creado o coincidente, valores previos y resultado de la reversión |
| `public.clients` | `source_system`, `source_record_id` e `import_batch_id`, todas nulas. Índice único parcial `(tenant, source_system, source_record_id)` |
| `clients_import_origin_guard` | Trigger: solo la confirmación de la importación puede escribir esas tres columnas. Ningún rol puede falsearlas por la API |
| Feature `clients_import` | En el catálogo, sin `plan_features` y sin overrides |

## Contratos (RPC `SECURITY DEFINER`, `search_path = ''`, solo `authenticated`)

**Control de acceso en cada RPC.** Antes de actuar comprueban:

- `auth.uid()` (`28000`);
- membresía **activa** con rol owner, admin o manager en un tenant **activo** (`42501`);
- la feature `clients_import` (`42501 clients_import_disabled`).

Un lote de otro tenant responde igual que uno inexistente (`P0002`), así que no se puede saber si existe.

| RPC | Función |
| --- | --- |
| `client_import_create_batch` | Crea el lote o devuelve el existente (`reused`). Rechaza `fill_blanks` sin confirmación posterior y más de 10 lotes abiertos por tenant (`54000`) |
| `client_import_stage_rows` | ≤ 500 filas por llamada y ≤ 10 000 por lote, idempotente por `row_number`. Valida en el servidor: nombre obligatorio, longitudes, email, teléfono y NIF. Resuelve el tipo de cliente por nombre (si no existe, aviso). Convierte las notas en HTML escapado |
| `client_import_finalize(lote, desde, límite)` | Clasificación por tramos de filas (2.000 por defecto); el resultado es idéntico al de una sola pasada: `error`, `duplicate_existing` (email, teléfono, NIF u origen, como `create_client`), `duplicate_in_file`, `possible_duplicate` (solo coincide sin `+34`/`0034`) y `valid`. Decisiones por defecto: crear las válidas y omitir todo lo demás |
| `client_import_summary` | Totales y primeras filas para la revisión |
| `client_import_set_strategy` | `fill_blanks` solo con `p_confirm = true` |
| `client_import_set_row_decisions` | Posibles duplicados → crear u omitir. Duplicados existentes → omitir o completar |
| `client_import_commit_chunk` | Tramos de hasta 500 (200 por defecto). Usa `row_version` optimista (`GC409`) y bloqueo del lote. Crea cada cliente con `create_client_v2`, sin cambiarla. Completar huecos solo rellena campos vacíos y guarda los valores previos. Se puede reanudar |
| `client_import_cancel` / `client_import_revert(lote, límite)` | Cancelar antes de escribir. Revertir después, por tramos (500 por defecto): desactiva los creados sin uso ni edición y restaura solo los campos rellenados que no se han tocado. Nunca borra |
| `client_import_report` / `client_import_list_batches` | Informe por fila (páginas de 1000) e historial |
| `client_import_purge_expired` | Solo `service_role` (cron): borra las filas de los lotes caducados y conserva el resumen |

## Diferencias respecto al ADR (decididas al implementar)

**Funciones añadidas a la lista del ADR:**

- `client_import_finalize`: la clasificación se hace en bloque, una vez preparadas todas las filas, y no tramo a tramo. Así los duplicados dentro del archivo no dependen del orden de los tramos.
- `set_strategy`, `set_row_decisions` y `list_batches`.

**Medidas de seguridad nuevas:**

- Trigger de guarda del origen.
- Límite de 10 lotes abiertos por tenant.

**Actividad:**

- Cada alta deja su `client.created` mediante el trigger existente, que **no se modifica**.
- El vínculo con el lote está en `clients.import_batch_id`.
- El lote deja `client_import.committed` y `client_import.reverted`.
- No se añade el lote al `metadata` de cada `client.created`, para no tocar el trigger.

**Limitación conocida:** tras una reversión, los clientes desactivados conservan su email, teléfono y NIF, que el índice único sigue reservando. Reimportarlos los marca como duplicados existentes; para recuperarlos hay que reactivarlos.

## Pruebas

| Prueba | Resultado |
| --- | --- |
| `phase50_clients_import.sql` (en el Release Gate) | Cubre:<br>• anónimo; `service_role`; staff, viewer, membresía inactiva y externo;<br>• tenant inactivo y feature desactivada;<br>• dos tenants: aislamiento de lotes y de la detección de duplicados;<br>• esquema privado cerrado y origen no falsificable;<br>• límites; idempotencia del lote y de las filas;<br>• las cinco clasificaciones y las notas escapadas;<br>• `fill_blanks` con confirmación y sin sobrescribir;<br>• duplicado aparecido entre revisión y confirmación;<br>• confirmación reanudable en 4 tramos y versión obsoleta;<br>• actividad;<br>• reversión con cliente en uso, editado y relleno parcialmente editado;<br>• informe e historial;<br>• cancelación; límite de lotes abiertos; purga |
| `phase50_clients_import_concurrency.sh` (manual, como las demás `*_concurrency.sh`) | Dos creaciones del mismo archivo → un lote. Dos confirmaciones del mismo tramo → una escribe y la otra recibe `GC409`. 400 filas procesadas una sola vez |
| Rendimiento (10 000 filas contra 2 000 clientes, `statement_timeout` de 8 s) | Preparación 20×500 en ≈1 s. Clasificación ≈2 s. Confirmación 50×200 en 11 s (llamada más lenta: 2 s). Reversión de 9 000 altas: 3 s |
| Suites de `main` sobre la migración | Las 19 suites del Release Gate y las invariantes, en verde |
| Recuperación | `supabase/rollbacks/20261016120000_clients_import_v1.sql` deshace las cinco migraciones (en Production solo con diagnóstico y autorización propios). Se niega si hay clientes importados o lotes confirmados. Si no, la huella del esquema (columnas, restricciones, índices, políticas, triggers, funciones, permisos y features) vuelve a ser **idéntica a la de `main`** |

## Correcciones tras la QA en Staging (`20261016121000`)

La primera migración se aplicó en Staging, pero no en Production. Al probarla con la app real (PostgREST y Vercel) aparecieron dos problemas que la base aislada no mostraba. Los corrige la segunda migración:

| Problema en Staging | Causa | Corrección |
| --- | --- | --- |
| Una confirmación con versión obsoleta tardó 125 s y acabó en 504 | El conflicto usaba SQLSTATE `40001` (fallo de serialización), y **PostgREST reintenta** esas transacciones | El conflicto pasa a `GC409`, sin reintento. La API responde 409 |
| La clasificación de 10.000 filas superó el `statement_timeout` de 8 s (500) | La base de Staging es lenta: lo que en local tardaba 2 s pasaba de 8 s. Production tiene el mismo tipo de cómputo | `client_import_finalize` por tramos de filas, con consultas indexadas por fila para los duplicados internos. La reversión también va por tramos |

**Pruebas:**

- `phase50` comprueba que la clasificación en tramos de 4 filas da exactamente lo mismo que una sola pasada, y que la reversión en tramos de 2 llega al mismo resultado.
- En local, 10.000 filas: ninguna llamada pasa de 1 s (clasificación 5×2.000, confirmación 50×200, reversión 18×500).
- El script de recuperación deshace las dos migraciones y deja el esquema idéntico a `main`.

**Guarda de migraciones del Release Gate:** la segunda migración elimina `client_import_finalize(uuid)` y `client_import_revert(uuid)` para sustituirlas por sus versiones por tramos. La guarda bloquea cualquier `DROP` (expandir y luego contraer), así que el archivo lleva la excepción explícita `-- release-gate: allow destructive-ddl: …` con el motivo:

- solo afecta a esas dos funciones;
- las creó la primera migración de esta misma PR;
- nunca se han aplicado en Production;
- ninguna versión desplegada de la app las llama.

No hay otro `DROP` en la PR.

## Segunda ronda de QA en Staging (`20261016122000`)

Con la segunda migración aplicada, la clasificación de un XLSX de **1.000 filas** volvió a superar los 8 s en Staging (500). Se reprodujo en local con la misma situación:

- la tabla de filas tenía estadísticas solo de lotes anteriores;
- el planificador estimaba **1 fila** para el lote recién preparado (tenía 1.000);
- con esa estimación, cada `UPDATE … FROM` recorría la tabla destino en un bucle anidado y repetía las subconsultas de duplicados por cada fila: coste cuadrático.

En local, 500 filas pasaban de 60 s. No es un caso raro: el autoanalyze siempre llega tarde a una importación recién hecha.

Midiendo la confirmación con datos recién escritos aparecieron otros dos problemas del mismo tipo:

| Problema | Causa | Corrección |
| --- | --- | --- |
| Clasificación cuadrática con estadísticas antiguas | Plan elegido sobre una estimación de 1 fila | `client_import_finalize` lee cada tramo una vez. Duplicados del archivo con funciones de ventana, sin joins. Claves de los clientes del tenant calculadas una vez por llamada y cruzadas por igualdad. `SET enable_nestloop = off` solo en esta función, así que los joins son hash o merge (lineales). Un `UPDATE` por fila por clave primaria (antes hasta cinco) |
| Las 5 primeras llamadas de confirmación tardaban unos 3 s cada una | `create_client` busca duplicados con un `OR` de las tres claves. PL/pgSQL guarda un plan genérico por sesión y, con estadísticas antiguas, ese plan recorría todos los clientes del tenant por cada alta | `client_import_commit_chunk` con `SET plan_cache_mode = force_custom_plan`: los planes a medida usan los tres índices únicos. **`create_client` no se modifica** |
| Una llamada de confirmación tardó 5,7 s | `clients` tiene 7 índices GIN de trigramas con `fastupdate`. El `INSERT` que pasa la lista pendiente de 4 MB la vuelca de golpe | Confirmación y reversión con `SET gin_pending_list_limit = 64MB`: el volcado queda para autovacuum |

**Medidas en local** (estadísticas antiguas, timeout de 8 s):

| Operación | Antes | Después |
| --- | --- | --- |
| Clasificación de un lote nuevo | 500 filas: > 60 s | 1.000 filas: 81 ms |
| Clasificación de 10.000 filas (5 llamadas) | timeout | 152–191 ms por llamada |
| Clasificación de 2.000 filas contra 10.000 clientes recién insertados | timeout | 327 ms |
| Confirmación 50×200 | primeras ≈ 3 s; un pico de 5,7 s | 194–528 ms por llamada (una pasada con autovacuum limpiando 57.000 tuplas muertas: 6 s) |
| Reversión 18×500 | ≤ 1 s | 123–175 ms por llamada |

**Pruebas:**

- `phase50` reproduce el caso de Staging: lote previo de 500 filas, `ANALYZE` y lote nuevo de 1.000 con duplicados existentes y del archivo. Exige clasificarlo en menos de 4 s y con los recuentos exactos.
  - Con la versión anterior, esta prueba no termina en 120 s.
  - Con la nueva, pasa.
- `phase50` comprueba también los ajustes de plan de las tres funciones.
- Gate en local: 21/21.
- Concurrencia: correcta.
- El script de recuperación deshace las tres migraciones y la huella vuelve a ser idéntica a la de `main`.

## Tercera ronda de QA en Staging (`20261016123000`)

**Con `…122000` todo funcionó en Staging.** Tiempos medidos en la base, con tramos de 2.000 / 200 / 500:

| RPC | Mediana | Máximo |
| --- | --- | --- |
| Clasificación | 450 ms | 6,8 s |
| Confirmación | 661 ms | 1,2 s |
| Reversión | 576 ms | 795 ms |

- **La clasificación de 6,8 s** coincidió con autovacuum procesando la reversión de 8.329 clientes y con un checkpoint. Repetida sin carga, la lectura de ese tramo tarda 426 ms.
- **Ajuste:** la interfaz baja los tramos a 1.000 / 100 / 250 (PR 4), para tener margen frente a esa contención.

**En la ronda siguiente**, el resumen de la revisión tardó **4,2 s** justo después de clasificar 10.000 filas nuevas:

- cruzaba todas las filas del lote con `clients` (8.241 coincidencias, lecturas aleatorias con poca caché) antes de quedarse con las 200 primeras;
- `client_import_summary` ahora elige primero las filas y solo busca esos clientes (como mucho 200). La salida es la misma.

**Pruebas:**

- `phase50` comprueba el contenido del resumen: orden, filas a revisar primero y cliente coincidente. Pasa con la versión anterior y con la nueva.
- Gate en local: 21/21.
- El script de recuperación deshace las cuatro migraciones y deja el esquema idéntico a `main`.

## Corrección de integridad tras la auditoría (`20261016124000`)

Una auditoría independiente encontró tres defectos P1. Los tres se reprodujeron sobre el esquema que ya estaba en Production, que entonces no tenía ningún lote:

| Defecto | Reproducción | Corrección |
| --- | --- | --- |
| Clasificación incompleta | `finalize(lote, 9, 2)` en un lote de 10 filas lo dejaba `validated` con 8 filas sin clasificar. La confirmación creaba 2 y omitía 8 en silencio | `finalize` solo valida cuando no queda ninguna fila sin clasificar, sea cual sea el orden de los rangos. `next_row` es la primera fila sin clasificar. Reiniciar un lote validado reclasifica todas las filas. Tras empezar la clasificación no se puede preparar ni sustituir ninguna fila |
| Pérdida del resumen | Tras purgar un lote a medio confirmar, la siguiente confirmación lo marcaba `committed` y recalculaba los contadores con 0 filas (`created` pasaba de 2 a 0) | `lock_batch` rechaza cualquier cambio en un lote purgado (`55000 batch_rows_purged`): confirmar, revertir, clasificar, cancelar, estrategia y decisiones. Los contadores de un lote purgado no se recalculan nunca |
| Recepción incompleta | Con 3 de 5 filas recibidas, el lote se validaba y se confirmaba | El lote guarda `expected_rows`, declarado al crearlo con `client_import_create_batch_v2`. La v1 deja de ser ejecutable. Un trigger solo admite filas de 1 a `expected_rows`. `finalize` y `commit` se niegan (`GC422 batch_incomplete`) si falta alguna fila o alguna está sin clasificar |

**La migración es aditiva:** `ADD COLUMN`, un índice parcial y un trigger nuevos, `CREATE OR REPLACE` con las mismas firmas, una RPC nueva y un `REVOKE`. Las cuatro migraciones aplicadas no se modifican.

**Pruebas:**

| Prueba | Resultado |
| --- | --- |
| `phase50` | Ahora usa la v2. Comprueba que la v1 ya no se puede ejecutar. Añade la regresión de los tres defectos: rangos desordenados o fuera de rango, preparar después de clasificar, confirmar con filas sin clasificar, preparación incompleta, número de filas incoherente, lote antiguo que adopta su número de filas, y purga a mitad de confirmación con los contadores conservados |
| `phase50_clients_import_concurrency.sh` | Nuevos casos C4–C6. C4: rangos simultáneos en orden inverso, que validan una sola vez. C5: preparar mientras se clasifica, que se rechaza. C6: purgar durante una confirmación, que se salta el lote bloqueado; tras la purga se rechaza la confirmación y los contadores se mantienen |
| Gate en local | 21/21 |
| Rendimiento | Igual que con cuatro migraciones, sobre una base recién creada. Clasificación de 10.000 filas con estadísticas antiguas: 223–401 ms por llamada |
| Recuperación | El script deshace las cinco migraciones y el esquema vuelve a ser idéntico al anterior a la importación |

## Revisión completa antes de confirmar (`20261016125500`, en la PR 4)

**Aplicada en Staging el 17/10/2026 a las 12:15 UTC**, con autorización expresa y solo esta migración. **No está aplicada en Production.**

- **Antes:** 77 migraciones, hasta `20261016125000`. El `dry-run` listaba únicamente `20261016125500`, sin `--include-all`.
- **Después:** 78 migraciones, sin pendientes.
- **Funciones:** las 14 funciones `client_import_*` son idénticas (md5) a las del repositorio.
- **Permisos:** `rows_page` solo para `authenticated`, sin acceso para `anon`. Ninguna función privada es ejecutable por los roles de la API.
- **Esquema y datos:** el esquema privado sigue cerrado y las dos tablas mantienen RLS. Los lotes y las 71.207 filas existentes no cambian, y no hay ninguna fila excluida.
- **Feature:** solo `e2e` y `e2e-import`.
- **QA r9** (`docs/CLIENTS-IMPORT-V1-QA.md`): `failures: []`.

**Decisiones del arquitecto que cubre:**

- revisar todas las filas, no solo las 200 del resumen;
- excluir y recuperar filas una a una;
- totales de confirmación calculados en el servidor sobre el lote completo;
- protección frente a cambios concurrentes.

**La migración es aditiva:** dos columnas nuevas (`excluded_at`, que admite nulos, y `excluded_count`, con valor por defecto 0), un helper privado, una RPC nueva y `CREATE OR REPLACE` con las mismas firmas. Las cinco migraciones aplicadas no se modifican.

**Orden:** el identificador `20261016125500` (12:55:00) va después de `20261016125000` (#129) y antes de `20261016130000` (rama `feat/order-lines-v1-db`). Primero se llamó `20261016126000`, que no es una hora válida (12:60:00); se corrigió antes de aplicarla en ningún entorno. En Staging están aplicadas hasta `125000`. En Production están aplicadas hasta `124000`, y `125000` sigue pendiente de su propio proceso.

| Objeto | Cambio |
| --- | --- |
| `client_import_rows.excluded_at` | Columna nueva. La exclusión es independiente de la decisión: cambiar la estrategia o reclasificar la conserva, y al volver a incluir la fila recupera su decisión |
| `imports_private.batch_plan(batch)` | Qué hará la confirmación, calculado sobre todas las filas, en grupos disjuntos que suman el total: `create`, `fill_blanks`, `skip` (duplicados omitidos por regla), `excluded` (por el usuario), `error`, `duplicate_in_file` y `unclassified`. Incluye además los desgloses `create_possible`, `skip_existing` y `skip_possible`. Sigue las mismas reglas que `commit_chunk` |
| `client_import_set_row_decisions` | Misma firma. Acepta además `exclude` e `include`, solo en filas importables: nuevas, posibles duplicados y ya existentes. Las filas con errores o repetidas en el archivo siguen sin poder importarse (`22023`). Devuelve el `plan` |
| `client_import_summary` | Misma firma. Añade el `plan` (`null` en un lote purgado) y `excluded` por fila |
| `client_import_rows_page(batch, filter, after_row, limit ≤ 200)` | Nueva, solo `authenticated`, con los mismos controles que el resumen: rol, tenant y feature. Paginación por número de fila. Filtros: `attention`, cada clasificación, `excluded`, `create`, `fill_blanks`, `skip` y `all`. Devuelve el total del filtro en todo el lote y, por fila, el cliente coincidente (nombre, estado, email, teléfono y NIF) |
| `client_import_commit_chunk` | Misma firma y los mismos ajustes de plan. Una fila excluida se omite con `result_reason = 'excluded_by_user'`, sea cual sea su decisión |
| `client_import_batches.excluded_count`, `refresh_batch_counters`, `batch_json` | Contador nuevo (por defecto 0), expuesto como `counts.excluded`: las filas omitidas por estar excluidas, que forman parte de `skipped`. La purga de 30 días borra las filas pero no los contadores, así que en el historial **las exclusiones no se convierten en omisiones**. Para los lotes anteriores el 0 es exacto, porque no tenían filas excluidas |

**Protección frente a cambios concurrentes:**

- Cada decisión o exclusión toma el bloqueo del lote y sube `row_version`.
- La confirmación exige la `row_version` del plan mostrado (`GC409` si no coincide). Desde el primer tramo el lote pasa a `committing` y ya no admite decisiones (`55000`).
- Los lotes confirmados antes de esta migración no tienen filas excluidas: sus resultados y su reversión no cambian.

**Pruebas:**

| Prueba | Resultado |
| --- | --- |
| `phase50` | Sección nueva con un lote de 8 filas que cubre todas las clasificaciones. Comprueba:<br>• el plan inicial;<br>• paginación por cursor y totales de cada filtro;<br>• cliente coincidente;<br>• límites de página;<br>• filtro inválido;<br>• lote purgado sin plan;<br>• aislamiento de tenant, rol, usuario anónimo y feature;<br>• filas no excluibles;<br>• exclusión idempotente;<br>• la decisión se conserva al excluir y se recupera al incluir;<br>• la estrategia y la reclasificación no deshacen exclusiones;<br>• totales de página iguales al plan;<br>• `GC409` si el lote cambió tras la revisión;<br>• la confirmación hace exactamente lo que dice el plan;<br>• sin cambios tras confirmar;<br>• otros lotes intactos;<br>• tras la purga, el lote conserva 2 excluidas dentro de las 5 omitidas, en el resumen y en el historial, sin recalcularse |
| `phase50_clients_import_concurrency.sh` | Caso nuevo C7. Una exclusión que llega antes hace fallar la confirmación de la versión revisada (`GC409`). Con un tramo en curso, una exclusión espera y se rechaza (`batch_state`). Al final solo se omiten como excluidas las 5 filas excluidas antes |
| Gate en local (pila aislada, 78 migraciones) | 22/22, incluida `phase52_order_total_guard` de `main` |
| Rendimiento (10.000 filas frente a 2.000 clientes, tiempo en base de datos) | `summary` con plan, 19 ms. Páginas de 50 o 200 filas con cualquier filtro, 8–119 ms. Excluir o incluir 2.000 filas, 50–57 ms. Primer tramo de confirmación con filas excluidas, 114 ms |
| Recuperación | El script deshace las seis migraciones. El esquema vuelve a ser idéntico al anterior a la importación: 72 migraciones frente a 78 más el rollback |
| Recuperación solo de esta migración | `supabase/rollbacks/20261016125500_clients_import_v1_review.sql` restaura las funciones anteriores y quita lo añadido. Sirve también donde ya hay lotes confirmados, como en Staging, a diferencia del rollback completo. Se niega a ejecutarse si algún usuario ya ha excluido filas, porque esas exclusiones se perderían: entonces hay que corregir hacia delante. Probado en local: con lotes confirmados, el esquema queda idéntico al de las migraciones hasta `125000`, el resumen sigue funcionando y un lote abierto se confirma. Con una fila excluida, se niega y no pierde nada |

## Gate y despliegue (pendiente de autorización)

1. Revalidar el HEAD de la PR y el CI.
2. Comprobación previa en Production (solo lectura).
3. `db push --dry-run`, que debe listar solo `20261016120000`, `20261016121000`, `20261016122000` y `20261016123000`.
4. `db push`.
5. Comprobaciones inmediatas:
   - huellas;
   - las suites no aplican en Production;
   - la feature existe sin overrides.
6. Merge.
7. Verificar el despliegue.

La app actual no llama a estas RPC: la migración es compatible con el código desplegado.

**La feature no se activa para ningún tenant real.** La validación se hará en Staging con tenants sintéticos (PR 5).
