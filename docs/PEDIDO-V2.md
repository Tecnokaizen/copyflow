# Pedido V2 — issue #36

Implementación sobre `main` `db8af4c`, en `codex/issue-36-pedido-v2`.

## Comportamiento

- El propietario configura cada campo de Pedido rápido como **Principal**, **Más opciones** u **Oculto**. Los ocultos no se renderizan en `/orders/quick`; siguen disponibles en creación completa y en la ficha.
- La preferencia conserva `tenant_settings.preferences.quick_order_layout_v1`, `version: 1`. La extensión es aditiva: acepta las once posiciones antiguas sin modificarlas e incorpora `file_status` y `files` en Más opciones cuando faltan. No requiere backfill ni migraciones. Guardar conserva las preferencias vecinas y la protección owner-only existente en PostgreSQL.
- El estado operativo se guarda en `orders.file_status_id`, validando formato y pertenencia al tenant. Las opciones proceden de `file_statuses` activos del tenant autenticado. La ficha lo identifica expresamente como **Estado de archivos**.
- Los adjuntos físicos siguen siendo `order_files`. Seleccionarlos no cambia el estado operativo. Se reutiliza Files V1: INIT → PUT directo mediante URL firmada R2 → COMPLETE, con sus límites, cuotas, capacidades y autorización existentes.
- Los archivos se mantienen en memoria hasta crear el pedido. Se guarda una sola vez, se conserva su ID y se completa la cola con concurrencia máxima de dos. No se navega automáticamente antes de terminar las subidas.
- Un error parcial conserva el pedido y permite reintentar solo los archivos fallidos. Si falla COMPLETE, se conserva el `file_id` y se vuelve a confirmar el mismo archivo, evitando una segunda subida por pérdida de respuesta. El doble clic no duplica la creación ni la cola.
- La creación de clientes inline, la asignación sugerida y los valores por defecto existentes se conservan. Oculto solo cambia la presentación del formulario rápido; no elimina columnas ni cambia sus reglas de negocio.

## Arquitectura y seguridad

Se mantiene la [arquitectura oficial](./Arquitectura%20inmutable%20de%20Copyflow.md): un codebase, un proyecto Vercel, un Supabase/PostgreSQL compartido y N tenants, aislados por `tenant_id`, membership, autorización y RLS. No se introduce almacenamiento, infraestructura, claves, migraciones o accesos mediante service role.

El backend toma el tenant de la sesión/contexto. La API rechaza estados de archivo de otro tenant; la FK compuesta `(tenant_id, file_status_id)` y RLS ofrecen la comprobación independiente de base de datos. Las rutas Files V1 y la edición existente conservan sus controles de roles, pedidos archivados y capacidades.

## Validación local (2026-09-23)

- Node 22.23.2, dependencias instaladas con `npm ci`.
- TypeScript: `npx tsc --noEmit`, correcto.
- Lint: `npm run lint`, correcto.
- Build: `npm run build`, correcto.
- Suite general: `TZ=UTC node --import tsx --test`: **665 passed, 0 failed, 6 skipped**. Las seis omitidas pertenecen al arnés opcional de búsqueda PostgREST local, no a Pedido V2. UTC reproduce el supuesto de una prueba preexistente de fechas; no se modifica Kiosk.
- Integración de handlers reales con dobles de contexto/BD/storage: creación con estado, payloads antiguos, IDs inválidos y de otro tenant, viewer/no autenticado, opciones aisladas, Files LIST/INIT y denegación cross-tenant.
- SQL contra PostgreSQL/Supabase local con todas las migraciones, fixtures aisladas y rollback: `pedido_v2.sql`, `phase17_order_files.sql`, `phase22_tenant_file_limits.sql`, todas correctas. Cubren owner-only, staff/viewer, aislamiento, FK del estado, Files/capacidades, límites y cuotas.
- Chromium a **390 y 1280 px**: componentes reales de creación y Settings con HTTP/R2 simulados. Verificados hidden fuera del DOM, More solo visible al desplegar, persistencia de Settings, cliente inline, orden POST→INIT→PUT→COMPLETE, doble clic, recuperación de COMPLETE sin reupload, listado/descarga, reset, formulario completo y ausencia de desbordamiento horizontal. Capturas revisadas visualmente.
- Workflow `Pedido V2` reproduce los gates de aplicación, navegador y SQL en la PR.

### Reproducir navegador

```sh
npm install --prefix /tmp/pedido-v2-browser --ignore-scripts --no-audit --no-fund playwright@1.58.2
node /tmp/pedido-v2-browser/node_modules/playwright/cli.js install chromium
PLAYWRIGHT_MODULE=/tmp/pedido-v2-browser/node_modules/playwright/index.mjs node scripts/pedido-v2-ui-smoke.mjs
```

El script usa los componentes, CSS y utilidades reales; solo sustituye navegación Next y los límites HTTP externos. Devuelve la ruta temporal de capturas y `results.json`. No necesita secretos ni datos de producción. El workflow instala Chromium con sus dependencias de sistema.

## Límites y riesgos

- No se ha realizado una subida contra R2 de producción ni un smoke con cuentas reales de SUR4/DEMO. El navegador usa dobles de HTTP; las suites SQL sí prueban PostgreSQL real. Conviene verificar el flujo con la configuración R2 del entorno de preview antes del merge.
- La cola vive en la pestaña: recargar/cerrar pierde los archivos locales pendientes, no el pedido ya creado. Hay aviso al salir del documento y texto explícito tras un fallo. Se puede abrir la ficha y volver a adjuntarlos.
- Los fallos INIT/PUT conservan la política de Files V1 de preparar una nueva subida al reintentar; las reservas pendientes quedan sujetas a su limpieza existente. Los fallos COMPLETE reusan el archivo ya enviado.
- Un rollback al lector antiguo puede mostrar el layout por defecto al no reconocer los nuevos campos/posiciones; no elimina preferencias ni datos. En esta versión, las preferencias V1 antiguas se conservan y se leen correctamente.

No se modifican Kiosk, Presupuestos, Billing, Stripe, fiscalidad ni arquitectura. Esta rama se entrega mediante PR contra `main`, sin merge.
