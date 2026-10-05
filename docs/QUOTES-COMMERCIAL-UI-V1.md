# Presupuestos V1 — Draft Editor UI

Fecha: 5 de octubre de 2026. Worktree existente `gestcopy-quotes-commercial-v1`, rama `feat/quotes-commercial-v1`.

## Base y alcance

- SQL core: `62d03bedb4f6a3910a8ed7c6896b8f439c8827af`, sin cambios de migraciones en este bloque.
- HTTP + contratos consolidados por separado: `0ea956b` (`feat(quotes): add commercial quote HTTP contracts`).
- El editor usa los seis endpoints comerciales existentes. Las pequeñas extensiones de compatibilidad son `PATCH` con `operational_only: true` y el filtro de lectura `status=expired`.
- Arquitectura conservada: core, deployment y BD compartidos; contexto de tenant, memberships y RLS existentes. Sin condiciones especiales por tenant.
- Sin push, merge, despliegue, Production, edición de `sources/`, PDF/R2, envío, aceptación/rechazo, canal público, mensajería o conversión comercial.

## Auditoría y patrones reutilizados

| Área | Referencias y resultado |
|---|---|
| Fuentes del proyecto | Arquitectura inmutable, instrucciones, fuentes oficiales y PRD SUR4. La arquitectura compartida Copyflow prevalece; SUR4/Airtable es referencia operativa. |
| Listado | `components/quotes/quotes-list.tsx`: búsqueda, paginación, filtros en URL, tabla y tarjetas existentes. |
| Ficha y formularios anteriores | `app/quotes/[id]/page.tsx`, `components/quotes/quote-form.tsx`: el formulario anterior mezclaba documento y gestión en un PATCH completo; la ficha exponía estado, impresión y conversión. |
| Shell y estados | `AppShell`, `AppNav`, `PageHeader`, `SectionCard`, `LoadingState`, `ErrorState`, `EmptyState`, `QuoteStatusBadge`. |
| Orders / Clients / Settings | Formularios por secciones, guardado explícito, estado pendiente, `ClientSelector`, `DatePicker`, `RichTextEditor`, controles `gc-*` y errores que conservan los datos locales. |
| Responsive / dark | Tokens de `app/globals.css`, specs existentes de design system y dark mode. No segundo sistema visual. |
| Browser smoke | Reutiliza esbuild + Playwright del smoke Pedido V2, sin nuevas dependencias ni framework. |

## UX final

El listado conserva búsqueda, filtros, paginación y navegación. Añade versión, importes del servidor, moneda y fecha de emisión. El estado del presupuesto se muestra separado del estado de la versión. En móvil y tablet (<1024px) reutiliza las tarjetas, y en desktop la tabla con scroll horizontal dentro de su contenedor. No solicita la ficha para cada fila.

Filtros: todos, borradores, enviados, aceptados, rechazados y caducados, además del `pending` del catálogo cuando existe. Los nombres personalizados del tenant se conservan. Caducados es un filtro de lectura por `valid_until < fecha actual en Europe/Madrid`; excluye aceptados, rechazados y presupuestos convertidos. Se aplica en servidor antes de paginar. No crea un estado comercial ni modifica registros. Las fechas nulas y la validez del día actual no se consideran caducadas.

La ficha abre directamente la draft editable cuando existe. La cabecera incluye título, descripción enriquecida, cliente asociado en lectura, contacto, email, teléfono, nombre fiscal, NIF/CIF, dirección multilínea, emisión, validez, moneda, IVA incluido y términos enriquecidos. El cliente asociado se cambia explícitamente en Gestión operativa, porque el contrato `PUT /draft` no acepta `client_id`. No se sobrescriben automáticamente datos comerciales al cambiar el cliente.

Las partidas son filas/tarjetas con concepto, descripción, cantidad, unidad, precio, descuento e IVA. Se añaden, eliminan y reordenan con botones. Cada fila muestra subtotal, IVA y total guardados. No existe cálculo fiscal local. Con cambios pendientes, los importes por partida muestran `—` y los totales generales se etiquetan como últimos importes guardados.

Guardar envía un reemplazo completo de cabecera y partidas por `PUT /draft`, con `version_id` y el `row_version` de **quote_versions**, no el de `quotes`. Se bloquean controles durante la petición, se conservan las entradas si falla y se confirma discretamente el éxito. La versión e importes de la respuesta se adoptan antes de refrescar las partidas mediante GET. Si ese GET falla después de una escritura correcta, se conserva el nuevo token y los totales autoritativos, se comunica el problema de lectura y no se repite automáticamente la escritura.

Un `409 stale_row_version` abre un diálogo modal con foco contenido: “Este presupuesto ha cambiado desde que lo abriste.” Recargar toma los datos actuales; cancelar conserva lo escrito localmente. No hay force save ni sobrescritura silenciosa. Si falla la recarga, el error permanece visible dentro del diálogo. El estado cargado y los valores editados se mantienen separados para una futura resolución de conflictos.

Preparar está disponible solo en una draft con cabecera válida y partidas válidas. Requiere confirmación de bloqueo, guarda explícitamente los cambios pendientes y prepara con el token devuelto por ese guardado. Después adopta `prepared_version` y `quote` y refresca la ficha. La versión queda bloqueada y el editor pasa a lectura; `quote.status` no se modifica ni se presenta como enviado por esta acción. No se ofrecen CTAs de PDF/envío comercial.

El historial muestra número, estado de versión, creación, bloqueo/envío cuando existe y total. Seleccionar una versión histórica muestra únicamente su resumen en lectura; no reutiliza el editor writable. Se conserva el borrador local al consultar el resumen. “Nueva versión” llama a POST `/versions` y abre la única draft actual, también con `replayed: true`; un doble submit no duplica versiones. Las versiones actuales prepared/sent se muestran en lectura.

Un presupuesto legacy sin versión conserva su contenido visible y permite abrir explícitamente el primer borrador mediante POST `/draft`. Se mantiene su impresión legacy existente. Las versiones comerciales no ofrecen esa impresión, porque la hoja operativa anterior no representa partidas ni importes comerciales. Las rutas legacy siguen existiendo.

Files, Actividad y enlaces a pedidos ya asociados se conservan. La ficha comercial no ofrece cambios de estado, envío ni conversión a pedido. El layout de Quotes y el guard compartido siguen bloqueando viewer y feature OFF. Se avisa al salir por navegación interna o al cerrar/recargar con cambios pendientes; no se añade autosave.

## Solapamientos con PATCH legacy

| Datos | Fuente/escritura usada en la nueva ficha |
|---|---|
| Título, descripción, contacto, billing, emisión, validez, moneda, fiscalidad, términos y partidas | Únicamente `PUT /draft`. |
| `client_id`, `service_id`, `assigned_team_member_id` | PATCH explícito `operational_only: true`; usa `quotes.row_version` y alcance por tenant. No incluye campos documentales. |
| `quotes.notes` | El SQL comercial existente proyecta `quote_versions.terms` en `quotes.notes`. Se trata como términos documentales, no como un segundo campo editable de notas internas. |
| PATCH completo anterior | Sigue admitido para clientes legacy. Su parser y forma de llamada se conservan. La nueva UI no lo utiliza para editar documentos. |
| Cliente durante draft con cambios pendientes o versión bloqueada | La nueva UI deshabilita el cambio de asociación. Servicio/responsable siguen editables sobre versiones bloqueadas. |

El PATCH `operational_only` acepta exclusivamente su discriminante, token y los tres IDs operativos. Rechaza añadir campos documentales. Se conserva el guard, la validación de relaciones del tenant y la concurrencia de quotes.

## Corrección compartida justificada por el smoke

`RichTextEditor` llamaba a Tiptap `setEditable` con su valor predeterminado `emitUpdate=true`. Alternar disponibilidad durante el guardado emitía una edición inexistente, marcaba la draft como sucia y borraba el mensaje de guardado. Se usa `setEditable(!locked, false)`. El smoke verifica que guardar no vuelve a producir cambios pendientes; no se cambia el contenido ni el formato del editor.

## Validación

Runtime: Node 22.23.2. Resultados finales sobre el código entregado.

| Comprobación | Resultado |
|---|---|
| Suite completa en UTC, con PostgREST local aislado | 848/848 PASS, 0 fallos, 0 omitidos |
| Quotes focalizado | 63/63 PASS, 0 fallos, 0 omitidos |
| Browser smoke | 218 comprobaciones PASS; 390/768/1280px × claro/oscuro |
| ESLint | PASS |
| TypeScript `--noEmit` | PASS |
| Webpack | PASS |
| Turbopack, sandbox y ejecución escalada local | EPERM reproducido en ambos al crear proceso/abrir puerto para `react-day-picker/src/style.css` |
| Diff y `git diff --check` | Revisados / PASS |

El smoke usa componentes y CSS reales con HTTP controlado. Comprueba listado, ausencia de N+1, cabecera, validación, adición/borrado/reordenación, conservación tras fallo, importes autoritativos, conflicto/cancelación/recarga, preparación confirmada con guardado previo, lectura prepared/sent, estado comercial intacto, histórico en lectura, replay de nueva versión, ensure legacy, fallo de GET tras PUT correcto, PATCH sin documento y errores de acceso sin ofrecer edición. Los tests HTTP/SQL existentes cubren el gate real y la BD; las capturas no se presentan como prueba de un despliegue real.

Capturas y JSON: `../output/quotes-draft-ui-20261005/`. Logs: `/tmp/quotes-ui-{tests,focused,lint,tsc,webpack,turbopack,turbopack-unrestricted,smoke}.log`. No se repiten migraciones ni se altera SQL en este bloque.

## Límites y siguiente bloque

- El historial HTTP disponible es resumido. No permite recuperar cabecera completa, snapshots ni partidas de una versión histórica. La UI muestra únicamente datos históricos que recibe, sin rellenarlos con datos de la versión actual. La lectura documental histórica completa necesita una ampliación de contrato autorizada en un bloque posterior.
- La asociación de cliente y el documento tienen dos acciones explícitas porque `client_id` no pertenece al contrato comercial. No son una transacción única. Los snapshots continúan bajo control de las RPC.
- Los importes pendientes no se calculan localmente; requieren guardar.
- El PATCH legacy completo continúa disponible fuera de esta UI por compatibilidad. Una futura retirada/endurecimiento de esos campos exige evaluar sus consumidores; la nueva ficha ya no produce esas escrituras duplicadas.
- Preparar una draft vacía queda deshabilitado. Persisten los límites del contrato, incluido IVA 0–100 % y máximo 500 partidas.
- Siguiente bloque recomendado: **PDF + R2 / document preparation**, generado desde una versión bloqueada y snapshots autoritativos. Antes de ofrecer lectura histórica completa, definir su contrato sin volver editable la historia.

## Archivos del bloque UI

- `app/api/quotes/[id]/route.ts`
- `app/api/quotes/route.ts`
- `app/quotes/[id]/page.tsx`
- `components/quotes/quote-commercial-editor.tsx`
- `components/quotes/quote-dialog.tsx`
- `components/quotes/quote-draft-form.tsx`
- `components/quotes/quote-operational-form.tsx`
- `components/quotes/quotes-list.tsx`
- `components/rich-text/rich-text-editor.tsx`
- `docs/QUOTES-COMMERCIAL-HTTP-V1.md`
- `docs/QUOTES-COMMERCIAL-UI-V1.md`
- `lib/files/preview-ui.test.ts`
- `lib/files/quote-files.test.ts`
- `lib/print/documents.test.ts`
- `lib/quotes/editor.test.ts`
- `lib/quotes/editor.ts`
- `lib/quotes/http.test.ts`
- `lib/quotes/list-http.test.ts`
- `lib/quotes/payload.ts`
- `lib/quotes/workflow.test.ts`
- `lib/quotes/workflow.ts`
- `scripts/quotes-draft-ui-smoke.mjs`
