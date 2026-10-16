# ADR — Gestcopy Migration V1: importación de clientes (CSV/XLSX)

Fecha: 16 de octubre de 2026. Estado: **aceptado; diseño cerrado el 16/10/2026** (ver «Cierre del diseño»).
Issue: #110 (P0 comercial). Base: `main` `c5eebbf`; cierre sobre `0877199`.

## Contexto

Para captar copisterías que vienen de otro programa hay que eliminar el coste de
cambio. La decisión de producto de #110 es **clientes primero**: un importador de
clientes autónomo, seguro, multi-tenant e idempotente, que no dependa de la
importación de pedidos (P1/P2, módulos y contratos aparte).

Hoy no existe ningún importador: no hay código de importación ni dependencias de
CSV/XLSX, y la ayuda no promete nada al respecto. Lo que sí existe y se reutiliza:

- `clients` con índices únicos por tenant sobre email, teléfono y NIF normalizados
  (`normalize_client_email`: minúsculas y sin espacios; `normalize_client_phone`:
  solo dígitos; `normalize_client_tax_id`: mayúsculas, solo alfanuméricos).
- `create_client` / `create_client_v2` (`SECURITY INVOKER`, roles owner, admin,
  manager y staff, error `client_duplicate` con el detalle del cliente coincidente)
  y `check_client_duplicates`.
- El trigger de actividad de clientes, que **exige `auth.uid()`**: cualquier
  escritura debe hacerse con la sesión del usuario, no con `service_role`.
- Features por tenant (`features`, `tenant_feature_overrides`, `tenant_has_feature`),
  la cola con arrendamientos de `files_private.storage_deletions`, R2 privado con
  capacidad HMAC y las guardas `requireCurrentAccess` del Release Gate.

## Decisiones

| # | Decisión | Motivo |
| --- | --- | --- |
| D1 | El archivo se **lee en el navegador** (Web Worker) para la vista previa y el mapeo; al servidor solo llegan filas ya mapeadas, en tramos de 500 | Evita el límite de 4,5 MB de cuerpo de Vercel y el riesgo de procesar XLSX (zip) en el servidor. El servidor vuelve a validar todo: la confianza no depende del navegador |
| D2 | No se guarda el archivo original; sí su nombre, tamaño y SHA-256, y las filas del lote durante 30 días | Minimización de datos (RGPD). El informe se genera desde las filas del lote |
| D3 | Lotes y filas en un esquema privado `imports_private`, accesible solo por RPC | Mismo patrón que `files_private` y `kiosk_private`; RLS cerrada y sin acceso directo desde la API |
| D4 | La confirmación escribe **por tramos con la sesión del usuario** (`create_client_v2` por fila, un tramo por transacción) y es reanudable | Respeta roles, RLS, duplicados y el trigger de actividad sin `service_role`; cabe en el tiempo máximo de una función de Vercel |
| D5 | Nuevas columnas opcionales en `clients`: `source_system`, `source_record_id`, `import_batch_id`, con índice único parcial `(tenant_id, source_system, source_record_id)` | Idempotencia por registro de origen y enlace futuro con pedidos importados. Migración aditiva, compatible con la app actual |
| D6 | Duplicados: por defecto **omitir**; opcional **completar huecos** (rellenar solo campos vacíos del cliente existente); nunca sobrescribir datos ya guardados | Requisito de #110: no sobrescribir información real sin consentimiento |
| D7 | Solo owner, admin y manager pueden importar (`MANAGEMENT_ROLES`) | Es una operación masiva; staff sigue creando clientes uno a uno |
| D8 | Nueva feature `clients_import`, activada por tenant con override durante el despliegue controlado | Permite pilotar sin cambiar planes ni precios. Sin límite comercial de filas en V1, solo límites técnicos |

## Alcance V1

**Incluye:** CSV (UTF-8 con o sin BOM; Windows-1252 si no es UTF-8 válido;
separador `;`, `,` o tabulador detectado) y XLSX (primera hoja o la elegida),
plantilla descargable, mapeo asistido con sinónimos ES/EN y mapeo guardado por
tenant y sistema de origen, vista previa, simulación completa sin escrituras,
detección de duplicados en el archivo y contra la cartera, confirmación por tramos
con progreso, informe descargable y reversión del lote.

**Campos:** nombre (obligatorio), empresa, persona de contacto, NIF/CIF, email,
teléfono, dirección (se admiten varias columnas: calle, CP, población y provincia
se unen en `address`), notas (texto plano convertido a texto enriquecido seguro),
tipo de cliente (por nombre; si no existe, se elige uno existente o se omite el
campo; no se crean tipos automáticamente) e identificador de origen.

**Fuera de V1:** pedidos activos (P1) e históricos (P2), servicios, archivos,
importación desde API de terceros, asistencia por IA, límites comerciales por plan.

## Flujo

1. **Subir** (Clientes → Importar): elegir archivo (≤ 5 MB, ≤ 10.000 filas) y sistema
   de origen («Plantilla Gestcopy», «Otro programa» con nombre libre). El Worker lo
   lee; las celdas se tratan siempre como texto.
2. **Mapear**: columnas detectadas con sugerencias; se guarda el mapeo por tenant y
   origen para la próxima vez.
3. **Revisar**: el navegador envía las filas mapeadas en tramos; el servidor crea el
   lote (`uploaded` → `validated`), normaliza, valida y clasifica cada fila: válida,
   con errores, duplicada dentro del archivo, duplicada en la cartera (con el cliente
   coincidente) o posible duplicado (p. ej. `+34 600…` frente a `600…`). Se muestran el
   resumen, las primeras filas y la decisión de duplicados (omitir o completar huecos).
4. **Importar**: confirmación explícita con los totales; tramos de 200 filas por
   transacción, reanudables (`committing` → `committed`).
5. **Informe**: CSV descargable con resultado por fila (creado, completado, omitido,
   error y motivo). Celdas que empiezan por `=`, `+`, `-`, `@`, tabulador o retorno
   se neutralizan con `'` (inyección CSV).

## Modelo de datos (migración aditiva)

- `imports_private.client_import_batches`: `id`, `tenant_id`, `created_by`,
  `source_system`, `file_name`, `file_size`, `file_sha256`, `mapping` (jsonb),
  `duplicate_strategy` (`skip` | `fill_blanks`), `status` (`uploaded`, `validated`,
  `committing`, `committed`, `cancelled`, `reverted`, `expired`), contadores,
  `row_version`, fechas y `expires_at` (30 días).
- `imports_private.client_import_rows`: `batch_id`, `row_number`, `source_record_id`,
  `normalized` (jsonb), `row_hash`, `classification`, `errors` (jsonb), `decision`,
  `result` (`created`, `filled`, `skipped`, `failed`), `client_id`, `previous_values`
  (solo para `fill_blanks`, para poder revertir).
- `clients`: `source_system`, `source_record_id`, `import_batch_id` (nulos) e índice
  único parcial por origen.
- Feature `clients_import` en el catálogo, sin filas de plan.

## Contratos

| RPC (`authenticated`, comprobación de tenant y rol dentro) | Función |
| --- | --- |
| `client_import_create_batch(tenant, source_system, file_name, file_size, file_sha256, mapping, strategy)` | Crea el lote. Si ese archivo ya se importó con el mismo mapeo, devuelve el lote existente en lugar de duplicarlo |
| `client_import_stage_rows(batch, rows jsonb)` | Guarda y valida un tramo (≤ 500 filas), idempotente por `row_number` |
| `client_import_summary(batch)` | Totales, primeras filas y duplicados para la vista previa |
| `client_import_commit_chunk(batch, expected_version, limit)` | Escribe hasta `limit` filas pendientes con `create_client_v2` o rellenando huecos; reanudable |
| `client_import_cancel(batch)` / `client_import_revert(batch)` | Cancela antes de confirmar; revierte después (ver Recuperación) |

API Next.js bajo `/api/imports/clients/*` con `requireCurrentAccess`, comprobación
de `clients_import` y de rol, respuestas `operationalJson` y registro en el test de
guardas del Release Gate.

## Idempotencia y duplicados

- **Lote:** `(tenant, file_sha256, hash del mapeo)` → reimportar el mismo archivo no
  crea un segundo lote.
- **Fila:** `(tenant, source_system, source_record_id)` único; sin identificador de
  origen, el `row_hash` normalizado evita reprocesar la misma fila del lote.
- **Cartera:** email, teléfono y NIF normalizados (los índices únicos actuales lo
  garantizan en la propia BD); el teléfono se compara también sin prefijo `34`/`0034`
  y, si solo coincide así, se marca como posible duplicado para que decida el usuario.
  No se cambia la normalización existente.
- Un fallo en una fila no invalida el tramo: se registra y se continúa; no hay
  escrituras parciales silenciosas (cada fila termina en un estado explícito).

## Seguridad y RGPD

- Tenant y rol comprobados en cada RPC y en cada ruta; tablas privadas sin acceso
  directo; pruebas de contaminación cruzada con dos tenants.
- Sin `service_role` en el flujo normal. El trigger de actividad registra cada
  `client.created` con el lote en `metadata` (marcador de sesión, patrón de
  `app.order_lifecycle`) y se añade un registro resumen del lote.
- Contenido siempre escapado en la vista previa; notas importadas como texto plano.
- Filas del lote eliminadas a los 30 días por el cron diario existente; se conserva
  solo el resumen. Acceso al informe limitado a owner, admin y manager.

## Recuperación

`client_import_revert` desactiva (`active = false`) los clientes creados por el lote
que no se hayan usado ni editado después (sin pedidos ni presupuestos y sin cambios
posteriores) y deshace los «completar huecos» cuyo valor siga intacto. Nunca borra
filas. Los clientes ya en uso se listan y se dejan como están.

## Pruebas

- **SQL** (`phase50_clients_import`, en el Release Gate): roles, aislamiento entre
  tenants, idempotencia de lote y fila, duplicados, `fill_blanks` sin sobrescribir,
  reanudación tras fallo, reversión y anónimo sin acceso. Concurrencia: dos
  confirmaciones del mismo lote a la vez.
- **Unitarias**: lectura de CSV (codificaciones, BOM, separadores, comillas, saltos
  de línea, fórmulas) y XLSX (fechas y números como texto), sinónimos de cabeceras,
  normalización y neutralización del informe.
- **Navegador**: smoke del asistente (subir, mapear, revisar, importar, informe) en
  escritorio y móvil, claro y oscuro.
- **Staging**: dos tenants sintéticos, archivos de 100, 1.000 y 10.000 filas, con
  duplicados, filas rotas y reintentos; plantilla genérica y al menos una exportación
  anonimizada autorizada. E2E añadido al recorrido de Staging.

## Plan de implementación

| PR | Contenido | Gate |
| --- | --- | --- |
| 1 | Este ADR y generador de archivos sintéticos para QA | Revisión |
| 2 | Migración: `imports_private`, columnas de origen en `clients`, feature `clients_import`, RPC y `phase50` | SQL desde cero y suites de `main` sobre la migración (app actual intacta) |
| 3 | Librería `lib/imports/clients` (lectura, mapeo, validación, informe) y su elección de dependencias | Unitarias; revisión de licencias y seguridad |
| 4 | API y asistente en Clientes, ayuda «Importar clientes» | Guardas, smokes, accesibilidad |
| 5 | Validación en Staging y despliegue controlado con la feature por tenant | E2E con dos tenants y 10.000 filas |

Cada PR se integra con el mismo procedimiento de gate que el sprint (migración antes
del merge cuando aplique).


## Cierre del diseño (16/10/2026)

### Decisiones cerradas

Antes «decisiones abiertas»:

| # | Decisión | Resolución |
| --- | --- | --- |
| 1 | Quién importa | Owner, admin y manager. Staff no |
| 2 | Duplicados por defecto | Omitir. «Completar huecos» solo si se elige de forma explícita en la revisión |
| 3 | Actividad | Un `client.created` o `client.updated` por cliente, con el lote en `metadata`, más un registro resumen del lote |
| 4 | Retención | Filas del lote, 30 días. Resumen del lote, indefinido |
| 5 | Librerías | `papaparse` 5.7.0 y `read-excel-file` 9.3.12, con versión exacta y tras un adaptador (evaluación en `docs/CLIENTS-IMPORT-V1-PREP.md`). Se confirman en la PR 3 con los ficheros sintéticos |
| 6 | Límites comerciales por plan | Fuera de V1. Solo límites técnicos |

### D9 — Confirmación `SECURITY DEFINER` que delega en `create_client_v2`

**Hallazgo:** `create_client`, al que llama `create_client_v2`, no depende de la RLS para autorizar.

- Exige `auth.uid()` (`28000`).
- Comprueba `has_tenant_role(p_tenant_id, owner|admin|manager|staff)` (`42501`).
- Valida los datos y devuelve `client_duplicate` tanto en la comprobación previa como ante `unique_violation`.
- `auth.uid()` lee los claims del JWT y no cambia dentro de `SECURITY DEFINER`.

**Decisión:** `client_import_commit_chunk` es `SECURITY DEFINER` (`search_path = ''`) y:

1. Comprueba el rol de gestión (`owner`, `admin`, `manager`) y la feature `clients_import`.
2. Bloquea el lote (`FOR UPDATE`) y verifica `row_version`.
3. Para cada fila con `decision = create`, llama a `public.create_client_v2(...)` dentro de un bloque `begin … exception`:
   - un error en una fila queda registrado en esa fila (`failed`, con su `sqlstate` y su motivo) sin abortar el tramo;
   - los duplicados que aparezcan entre la revisión y la confirmación terminan en `skipped` con motivo `client_duplicate`.
4. Para `fill_blanks`, actualiza solo los campos vacíos del cliente existente.
   - Lo hace en la misma función, con `tenant_id` explícito.
   - Guarda los valores previos en `previous_values`.
   - El trigger de actividad registra `client.updated`.
5. Fija `app.client_import_batch` con `set_config(..., true)` solo alrededor de la escritura, como `app.order_lifecycle`.

No se refactoriza `create_client` ni `create_client_v2`: la app actual no cambia. Esto sustituye a la «función interna común» propuesta en `CLIENTS-IMPORT-V1-PREP.md` §3.

### Criterios de seguridad (obligatorios para cada PR de la importación)

| # | Criterio | Cómo se prueba |
| --- | --- | --- |
| S1 | El tenant se deriva del lote y se comprueba la membresía activa en cada RPC. Nunca se confía en un `tenant_id` del navegador sin comprobarlo | `phase50`: dos tenants, lectura y escritura cruzadas rechazadas |
| S2 | Solo owner, admin y manager. Staff, anónimo y usuarios sin membresía reciben `42501` (o `28000` sin sesión) | `phase50` y la prueba de guardas del Release Gate |
| S3 | Feature `clients_import` comprobada en cada RPC y en cada ruta | `phase50` y pruebas de rutas |
| S4 | Sin `service_role` en el flujo. RPC `DEFINER` con `search_path = ''`, `revoke all from public, anon` y `grant execute to authenticated`. `imports_private` sin permisos directos y con RLS activada sin políticas | `release_gate_security_invariants` y `phase50` |
| S5 | El servidor valida todo: ≤ 500 filas por tramo, ≤ 10.000 por lote, longitudes iguales a las de `clients` (dirección ≤ 500) y cuerpo ≤ 4 MB. Lo que interpreta el navegador nunca se da por bueno | `phase50` y unitarias |
| S6 | Idempotencia y concurrencia: lote único por `(tenant, sha256, hash del mapeo)`, fila única por `(lote, row_number)`, `FOR UPDATE` con `row_version` y dos confirmaciones simultáneas sin duplicar | `phase50` (concurrencia con `dblink` o dos sesiones) |
| S7 | Nunca se sobrescribe un dato existente. `fill_blanks` solo rellena vacíos, guarda `previous_values` y la reversión solo deshace lo que siga intacto | `phase50` |
| S8 | RGPD: no se guarda el fichero, las filas se borran a los 30 días, sin datos de clientes en logs ni en el `metadata` de la actividad (solo identificadores) y el informe es solo para gestión | `phase50` y revisión |
| S9 | Salida segura: la vista previa escapa el contenido (sin `dangerouslySetInnerHTML`), las notas se importan como texto plano y el informe CSV neutraliza `= + - @ \t \r` | Unitarias y smoke |
| S10 | Lectura segura: Web Worker, límites de tamaño y filas antes de leer, XLSX sin evaluar fórmulas ni macros y celdas siempre como texto | Unitarias con ficheros sintéticos |
| S11 | Trazabilidad: actividad por cliente y resumen del lote, respuestas `operationalJson` con `correlation_id` | Smoke |
| S12 | Migración solo aditiva, script de recuperación probado y suites de `main` en verde sobre la migración | Gate de la PR 2 |

### Fase siguiente: especificación de la PR 2 (migración y contratos SQL)

**Objetos.** Una migración aditiva, aplicada en Production antes del merge previa autorización:

- **Esquema** `imports_private` con `revoke all on schema … from public, anon, authenticated`.
- **Tabla `imports_private.client_import_batches`:**
  - `id uuid pk` y `tenant_id uuid not null` (FK a `tenants`);
  - `created_by uuid not null default auth.uid()`;
  - `source_system text not null` (1–60 caracteres);
  - `file_name text not null` (≤ 255) y `file_size bigint not null` (> 0 y ≤ 5 MiB);
  - `file_sha256 text not null` (`^[0-9a-f]{64}$`) y `mapping jsonb not null`, junto con `mapping_hash text not null`;
  - `duplicate_strategy text not null` (`skip` | `fill_blanks`, por defecto `skip`);
  - `status text not null` (`uploaded`, `validated`, `committing`, `committed`, `cancelled`, `reverted`, `expired`);
  - contadores `int not null default 0` y `row_version int not null default 0`;
  - fechas: `created_at`, `updated_at`, `committed_at`, `reverted_at` y `expires_at` (+30 días);
  - índice único `(tenant_id, file_sha256, mapping_hash)` para estados no terminales.
- **Tabla `imports_private.client_import_rows`:**
  - `batch_id` (FK con `on delete cascade`) y `row_number int` (> 0), con PK `(batch_id, row_number)`;
  - `source_record_id text` (≤ 120), `normalized jsonb not null` y `row_hash text not null`;
  - `classification text not null` (`valid`, `error`, `duplicate_in_file`, `duplicate_existing`, `possible_duplicate`) y `errors jsonb`;
  - `matched_client_id uuid` y `decision text` (`create`, `fill_blanks`, `skip`);
  - `result text` (`created`, `filled`, `skipped`, `failed`), `result_reason text` y `client_id uuid`;
  - `previous_values jsonb`.
- **`public.clients`:**
  - nuevas columnas `source_system text`, `source_record_id text` (≤ 120) e `import_batch_id uuid`, todas nulas;
  - índice único parcial `(tenant_id, source_system, source_record_id) where source_record_id is not null`.
- **Catálogo:** feature `clients_import`, sin `plan_features`.

**RPC.** Todas `authenticated`, `DEFINER` con `search_path = ''` y respuesta `jsonb`:

| Función | Devuelve | Errores |
| --- | --- | --- |
| `client_import_create_batch(p_tenant_id, p_source_system, p_file_name, p_file_size, p_file_sha256, p_mapping, p_duplicate_strategy)` | `{batch_id, status, reused}` | `28000`, `42501`, `feature_disabled`, `22023` |
| `client_import_stage_rows(p_batch_id, p_rows)` | `{staged, valid, errors, duplicate_in_file, duplicate_existing, possible_duplicate, row_version}` | `42501`, `22023` (tramo > 500, lote > 10.000 o fila inválida), `batch_state` |
| `client_import_summary(p_batch_id, p_limit default 50)` | Totales, primeras filas y duplicados con el cliente coincidente (id y nombre) | `42501` |
| `client_import_commit_chunk(p_batch_id, p_expected_version, p_limit default 200)` | `{processed, created, filled, skipped, failed, remaining, row_version, status}` | `42501`, `row_version_conflict`, `batch_state` |
| `client_import_cancel(p_batch_id)` | `{status}` | Solo antes de `committing` |
| `client_import_revert(p_batch_id)` | `{deactivated, restored, kept_in_use: [client_id…]}` | Solo `committed` |

**Reversión de un lote:**

- Desactiva (`active = false`) solo los clientes con `import_batch_id` igual al lote que:
  - no tengan pedidos ni presupuestos;
  - no se hayan modificado después de la confirmación (`updated_at <= committed_at`).
- Restaura `previous_values` solo en los campos que conserven el valor importado.
- Nunca borra filas.

**Pruebas.** `supabase/tests/phase50_clients_import.sql` en el job Database del Release Gate, que cubre S1–S7 y además:

- normalización igual a la de `normalize_client_*`;
- posible duplicado por `+34`/`0034`;
- reanudación tras un fallo a mitad de tramo;
- caducidad de las filas.

Datos de entrada: el generador `scripts/imports/client-fixtures.ts`.

**Gate de la PR 2:**

1. SQL desde cero.
2. Suites de `main` sobre la migración (la app actual intacta).
3. Script de recuperación probado.
4. `db push --dry-run` en Production con solo la nueva migración.
5. Migración aplicada antes del merge, previa autorización.
