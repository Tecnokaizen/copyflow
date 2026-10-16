# ADR — Gestcopy Migration V1: importación de clientes (CSV/XLSX)

Fecha: 16 de octubre de 2026. Estado: **propuesto, previo a implementación**.
Issue: #110 (P0 comercial). Base: `main` `c5eebbf`.

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

## Decisiones abiertas

1. ¿Puede importar también staff, o solo owner, admin y manager (propuesto)?
2. Estrategia por defecto ante duplicados: omitir (propuesto) o completar huecos.
3. Granularidad de la actividad: un registro por cliente más el resumen (propuesto)
   o solo el resumen.
4. Retención de las filas del lote: 30 días (propuesto).
5. Librería XLSX (candidatas con licencia MIT y mantenidas, p. ej. `read-excel-file`
   o `exceljs`) y lector CSV (`papaparse`): se decide en la PR 3 tras una prueba.
6. Límites comerciales por plan e importación asistida: fuera de V1 hasta definir
   enforcement y costes (#110).
