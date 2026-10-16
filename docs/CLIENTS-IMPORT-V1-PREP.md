# Migration V1 — Preparación de la importación de clientes (CSV/XLSX)

Fecha: 16/10/2026. Base: `main` `893f366`. Implementa el
[ADR](adr/2026-10-16-clients-import-v1.md) (#110, #114).

**Alcance de V1:** solo clientes. Los pedidos históricos quedan fuera del alcance
obligatorio.

**Esta PR completa la PR 1 del plan del ADR:**

- el generador de ficheros sintéticos para QA;
- la elección razonada de dependencias;
- el plan detallado de las PR 2–5.

No incluye ninguna funcionalidad, migración ni dependencia nueva.

## 1. Generador de ficheros sintéticos

Ficheros: `scripts/imports/client-fixtures.ts` y su test.

```bash
npx tsx scripts/imports/client-fixtures.ts --rows 10000 --seed 42 --delimiter ";" --encoding windows-1252 --out /tmp/clientes.csv
```

**Salida:**

- un CSV;
- `<out>.manifest.json` con la clasificación esperada de cada fila, que sirve de oráculo para las pruebas de las PR 2–5.

**Opciones:**

| Opción | Valores |
| --- | --- |
| Separador | `;`, `,` o tabulador |
| Codificación | UTF-8, UTF-8 con BOM o Windows-1252 |
| Cabeceras | español o inglés |
| Ficheros | Deterministas por semilla |

**Casos que incluye:**

| Tipo de fila | Para qué sirve | Proporción aproximada |
| --- | --- | --- |
| Válida | Importación normal | ~78 % |
| Sin nombre | Error de validación | 4 % |
| Email inválido | Error de validación | 4 % |
| Duplicado en el fichero | Mismo email con mayúsculas y espacios | 10 % |
| Posible duplicado | Mismo teléfono con prefijo `+34` | 4 % |

**Además:**

- notas con fórmulas (`=HYPERLINK(...)`) para probar la neutralización del informe;
- notas multilínea con comillas y `€`;
- tildes, `ñ` y `ü`;
- CRLF;
- NIF con letra de control correcta.

**Datos:**

- todos son ficticios: emails en dominios `example.*` reservados y DNI por encima del rango expedido;
- 10.000 filas ocupan unos 1,6 MB, por debajo del límite de 5 MB del ADR.

## 2. Dependencias (datos de npm y GitHub Advisories, 16/10/2026)

| Paquete | Versión | Licencia | Última publicación | Dependencias | Avisos de seguridad | Decisión |
| --- | --- | --- | --- | --- | --- | --- |
| `papaparse` | 5.7.0 | MIT | 24/08/2026 | 0 | Solo en versiones anteriores a 5.2.0 | **Usar para CSV** |
| `read-excel-file` | 9.3.12 | MIT | 07/10/2026 | 4, todas MIT y mantenidas: `fflate`, `saxen`, `unzipper-esm`, `worker-f` | Ninguno | **Usar para XLSX** |
| `exceljs` | 4.4.0 | MIT | 20/12/2024 | 9, entre ellas `archiver`, `tmp` y `unzipper`, pensadas para Node | Solo en versiones anteriores a 1.6.0 | Descartar: sin publicar desde hace 22 meses y 21,8 MB desempaquetado, demasiado para el navegador |
| `xlsx` (npm) | 0.18.5 | Apache-2.0 | — | 7 | **Altos sin corregir en npm**: GHSA-4r6h-8v6p-xvw6 (prototype pollution) y GHSA-5pgg-2g8v-p4x9 (ReDoS) | Descartar: las versiones corregidas solo se distribuyen por el CDN de SheetJS, fuera de `npm audit` |

**Motivos de la elección:**

- **`read-excel-file`:**
  - exporta `./web-worker`, que encaja con D1 (lectura en un Web Worker);
  - lee solo valores, sin evaluar fórmulas.
  - **Riesgo:** un solo mantenedor. Se mitiga fijando la versión exacta y aislando la librería tras un adaptador (`lib/imports/clients/read-xlsx.ts`) para poder cambiarla sin tocar el resto.
- **`papaparse`:**
  - no tiene dependencias y admite worker;
  - la detección de codificación se hace antes de pasarle el texto: `TextDecoder("utf-8", { fatal: true })` y, si falla, `windows-1252`;
  - el separador se limita a `;`, `,` y tabulador.

**Condiciones comunes:**

- las dos librerías se cargan con `import()` dinámico solo en la página de importación;
- se instalan con versión exacta en la PR 3, tras la prueba con los ficheros sintéticos y una exportación anonimizada autorizada.

## 3. Decisión técnica a cerrar en la PR 2

**Conflicto en el ADR:**

- D4 escribe con la sesión del usuario mediante `create_client_v2` (`SECURITY INVOKER`, RLS de `clients` y trigger de actividad con `auth.uid()`).
- D3 guarda lotes y filas en `imports_private`, sin acceso directo para `authenticated`.
- Una RPC no puede ser a la vez `INVOKER`, para respetar la RLS de `clients`, y leer `imports_private`.

**Propuesta:**

- `client_import_commit_chunk` será `SECURITY DEFINER`:
  - comprueba explícitamente tenant, rol (`owner`, `admin`, `manager`), feature y `row_version`;
  - bloquea el lote con `FOR UPDATE`;
  - llama a `create_client_v2` por fila.
- **Actualización del 16/10:** no hace falta ninguna función interna común. `create_client` autoriza con `auth.uid()` y `has_tenant_role` de forma explícita, sin depender de la RLS. Decisión D9 en el ADR, «Cierre del diseño».
- El trigger de actividad seguirá viendo `auth.uid()`, porque este lee los claims del JWT y no cambia con `SECURITY DEFINER`. El marcador de sesión `app.client_import_batch` (patrón `app.order_lifecycle`) añade el lote a `metadata`.
- `phase50` debe demostrar:
  - que staff y anónimo no pueden;
  - que no hay escritura entre tenants;
  - que el resultado es igual al de `create_client_v2`, con los mismos errores `client_duplicate`.

## 4. Plan de implementación (PR 2–5)

Cada PR se integra con el procedimiento de gate del sprint. Si lleva migración, esta se aplica en Production antes del merge, previa autorización.

### PR 2 — Migración y contratos SQL

- **Migración:** `supabase/migrations/<versión>_clients_import_v1.sql`, solo aditiva:
  - esquema `imports_private` con `client_import_batches` y `client_import_rows`, RLS activada, sin políticas y con `revoke all`;
  - columnas opcionales en `clients`: `source_system`, `source_record_id`, `import_batch_id`, más un índice único parcial `(tenant_id, source_system, source_record_id) where source_record_id is not null`;
  - feature `clients_import` en el catálogo, sin `plan_features`.
- **RPC del ADR:**
  - `create_batch` es idempotente por `(tenant, sha256, hash del mapeo)`;
  - `stage_rows` es idempotente por `row_number`;
  - `summary`, `commit_chunk`, `cancel` y `revert` completan el contrato.
- **Retención:** se amplía la limpieza del cron diario existente para borrar filas con más de 30 días; se conserva el resumen.
- **Recuperación:** `supabase/rollbacks/<versión>_clients_import_v1.sql`, que se niega a actuar si existe algún cliente con `import_batch_id`.
- **Pruebas:** `supabase/tests/phase50_clients_import.sql` en el job Database del Release Gate.
  - Cubre roles, aislamiento entre dos tenants, idempotencia, duplicados (también el prefijo `+34`) y `fill_blanks` sin sobrescribir.
  - También la reanudación tras fallo, dos confirmaciones concurrentes, la reversión y que la app actual no se vea afectada (suites de `main`).

### PR 3 — Librería `lib/imports/clients`

- **Módulos:**
  - `detect-encoding.ts`, `read-csv.ts`, `read-xlsx.ts` y `worker.ts`;
  - `headers.ts`: sinónimos ES/EN (`Nombre`/`Name`/`Razón social`, `NIF`/`CIF`/`Tax ID`, `Teléfono`/`Móvil`/`Phone`, etc.);
  - `normalize.ts`: espejo de `normalize_client_*`, solo para la vista previa, porque el servidor manda;
  - `map-row.ts`: une calle, CP, población y provincia en `address`;
  - `report.ts`: neutraliza `=`, `+`, `-`, `@`, tabulador y retorno con `'`.
- **Pruebas unitarias:**
  - con el generador;
  - con XLSX de prueba creados en el test (`write-excel-file`, del mismo autor y MIT, como devDependency, o pequeños binarios versionados);
  - con fechas y números como texto.
- Revisión de licencias y tamaño del bundle.

### PR 4 — API y asistente

- **Rutas:**
  - bajo `/api/imports/clients/`: `batches`, `[id]/rows`, `[id]` (resumen), `[id]/commit`, `[id]/cancel`, `[id]/revert` y `[id]/report`;
  - todas con `requireCurrentAccess`, roles de gestión, feature `clients_import` y `operationalJson`;
  - registradas en `ci/release-gate/api-route-guards`.
- **Asistente:** Clientes → Importar, en 4 pasos (subir, mapear, revisar, importar):
  - progreso por tramos y reanudación;
  - informe descargable.
- **Ayuda:** artículo «Importar clientes» y entrada en Novedades.
- **Smoke de navegador:** escritorio y móvil, claro y oscuro.

### PR 5 — Staging y despliegue controlado

- **Validación en Staging:** dos tenants sintéticos con 100, 1.000 y 10.000 filas generadas, reintentos y reversión.
- **E2E:** se añade al recorrido de Staging.
- **Despliegue en Production:** feature por override en un tenant cada vez, empezando por el de verificación.

## 5. Decisiones abiertas (del ADR, con propuesta)

1. **Quién importa:** owner, admin y manager. Staff no. *Propuesta: mantener.*
2. **Duplicados por defecto:** omitir. «Completar huecos» es opcional y explícito. *Propuesta: mantener.*
3. **Actividad:** un registro por cliente más el resumen del lote. *Propuesta: mantener.*
4. **Retención de filas del lote:** 30 días. *Propuesta: mantener.*
5. **Librerías:** `papaparse` y `read-excel-file` (§2). *Pendiente de confirmar en la PR 3.*
6. **Límites comerciales por plan:** fuera de V1.
7. **Nueva:** RPC de confirmación `SECURITY DEFINER` con una función interna común (§3). *Pendiente de aceptar antes de la PR 2.*
