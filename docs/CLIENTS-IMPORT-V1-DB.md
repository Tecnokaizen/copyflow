# Migration V1 · PR 2 — Base de datos y contratos de la importación de clientes

Fecha: 16/10/2026.

- Base: `main` `bef29ac`.
- Implementa el [ADR](adr/2026-10-16-clients-import-v1.md) (diseño cerrado: D1–D9, S1–S12).
- Migraciones: `20261016120000_clients_import_v1.sql` y `20261016121000_clients_import_v1_chunks.sql`, solo aditivas.

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
| `phase50_clients_import_concurrency.sh` (manual, como las demás `*_concurrency.sh`) | Dos creaciones del mismo archivo → un lote. Dos confirmaciones del mismo tramo → una escribe y la otra recibe `40001`. 400 filas procesadas una sola vez |
| Rendimiento (10 000 filas contra 2 000 clientes, `statement_timeout` de 8 s) | Preparación 20×500 en ≈1 s. Clasificación ≈2 s. Confirmación 50×200 en 11 s (llamada más lenta: 2 s). Reversión de 9 000 altas: 3 s |
| Suites de `main` sobre la migración | Las 19 suites del Release Gate y las invariantes, en verde |
| Recuperación | `supabase/rollbacks/20261016120000_clients_import_v1.sql`. Se niega si hay clientes importados o lotes confirmados. Si no, la huella del esquema (columnas, restricciones, índices, políticas, triggers, funciones, permisos y features) vuelve a ser **idéntica a la de `main`** |

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

## Gate y despliegue (pendiente de autorización)

1. Revalidar el HEAD de la PR y el CI.
2. Comprobación previa en Production (solo lectura).
3. `db push --dry-run`, que debe listar solo `20261016120000` y `20261016121000`.
4. `db push`.
5. Comprobaciones inmediatas:
   - huellas;
   - las suites no aplican en Production;
   - la feature existe sin overrides.
6. Merge.
7. Verificar el despliegue.

La app actual no llama a estas RPC: la migración es compatible con el código desplegado.

**La feature no se activa para ningún tenant real.** La validación se hará en Staging con tenants sintéticos (PR 5).
