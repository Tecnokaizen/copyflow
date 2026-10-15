# Mejoras operativas de Tamara

Base auditada: main `2c3ddff1557ec1dd216b0f8da1387655eb07cc5c`, 9 de octubre de 2026.
PR abiertas al iniciar: #58 (logos), #32 (kiosk), #11 y #2 (drafts). No se incorporan sus cambios.

## Arquitectura y permisos

Prevalece `Arquitectura inmutable de Copyflow.md`: un codebase, un proyecto/deployment Vercel, un Supabase compartido, tenant_id + membership activa + RLS. Los documentos SUR4/Airtable son referencia operativa histórica, no infraestructura de este SaaS.

El bloqueo de Personal era de navegación: `homePathForRole` redirigía a Mis pedidos y el menú ocultaba Inicio y Todos los pedidos. Las consultas ya permitían a una membership activa consultar los pedidos del tenant.

- Personal accede a Inicio, Todos los pedidos y Calendario en Pedidos; conserva Mis pedidos, Mostrador y Pedido rápido.
- `/orders` tiene guard de servidor; GET orders/dashboard rechazan contexto ausente y roles desconocidos antes de consultar.
- Se usan clientes Supabase de sesión, nunca service role; consultas con tenant_id y RLS existentes (`orders_select_member`, `is_tenant_member`). No se amplían políticas.
- Dashboard de Personal/Viewer contiene exclusivamente indicadores operativos de pedidos y carga activa. Las cifras de presupuestos solo se consultan para owner/admin/manager.
- Configuración, Equipo, Actividad, gestión de usuarios y sus acciones mantienen sus permisos. Presupuestos sigue su autorización/feature existente. Viewer conserva consulta sin escritura.

## Pedidos

- Calendario semanal: cuadrícula lunes–sábado, sin desplazamiento horizontal; seis columnas desde tablet, dos en móvil ancho y una en móvil estrecho.
- La consulta mantiene límites semanales de siete días, zona horaria tenant y navegación por semanas. Ningún registro ni due_at cambia.
- Si hay entregas de domingo, aparecen en una lista accesible debajo, con hora y enlace. Si no hay, no se muestra domingo ni aviso. Las mismas entregas siguen en la lista general.
- Dentro de Lista hay iconos accesibles Lista/Cuadrícula. `layout=grid` cambia exclusivamente presentación; mantiene dataset, filtros, búsqueda, ordenación, página y permisos. Ordenación en tarjetas mediante selector; la tabla conserva sus encabezados ordenables. Calendario y Por Servicio siguen disponibles.

## Auditoría comercial

Main ya contiene la migración `20261007190056_commercial_operations_v1.sql`:
`orders.total_amount` nullable (`numeric(20,2)`) + movimientos canónicos `order_payments` no anulados. El saldo es derivado. `payment_status_id` es una etiqueta independiente.
Los RPC de cobro ya bloquean el pedido, validan total/pagos y deduplican movimientos con idempotency_key. No debe añadirse otro anticipo/saldo almacenado ni escribir cobros directamente.
Crear pedido, definir total y registrar anticipo son operaciones distintas. Evitar un alta que cree el pedido y falle a mitad del cobro sin identificar el pedido guardado. La distribución del formulario en columnas permanece pendiente del croquis.

Presupuestos ya tiene impresión operativa A4 (`/quotes/[id]/print`) para datos guardados; el botón se ocultaba al existir una revisión comercial. El PDF comercial preparado/versionado es un documento diferente con sus controles existentes. No inventar importes ni usar notas internas en impresión.

## Validación

- Node 22 (no Node 25); instalación con npm ci sin cambiar dependencias/lockfile.
- Suite completa con TZ=UTC, igual que CI; hay una prueba heredada de kiosk que asume UTC y falla si se ejecuta con TZ Europe/Madrid.
- HTTP dashboard con Personal/Viewer, owner y contextos denegados.
- SQL `tamara_operational_access.sql`: dos tenants, staff, membership inactiva, anon, configuración protegida y carga aislada; fixtures en transacción con rollback, local/CI exclusivamente.
- `tamara-orders-ui-smoke.mjs`: componentes reales con HTTP simulado, móvil/escritorio, filtros/búsqueda/ordenación compartidos, sábado/domingo, sin aviso de domingo vacío y sin overflow.
- Lint conserva cuatro avisos previos en `lib/orders/quote-situation.test.ts`; ningún error nuevo.

No cambia esquema, billing/Stripe, secretos ni datos de producción. El despliegue de estas vistas no requiere migración.

Resultado local de la PR de permisos/vistas: 982 tests aprobados, 6 omitidos (988 total), typecheck y build correctos. SQL transaccional correcto. Browser integration correcto a 390 y 1280 px. Capturas disponibles en el informe local de QA; producción se comprueba por separado después del merge.


## Pedido rápido e impresión (segunda PR)

El bloque canónico de cobro de la ficha se muestra después del alta en Pedido rápido, sin abandonar esa pantalla. Permite definir total y registrar entregas, con total/entregado/pendiente siempre derivados por los mismos RPC. Se muestra solamente cuando el pedido ya existe; no se declara un cobro antes de confirmarlo. Crear otro se bloquea mientras hay diálogo/operación de cobro. Los errores quedan dentro del bloque del pedido guardado y el reintento no recrea el pedido. La ficha completa y el formulario rápido consultan exactamente la misma fuente.

Imprimir presupuesto se muestra también con revisión comercial. Es la hoja de control A4 ya existente, basada en la ficha guardada, sin cambiar estados ni generar una nueva revisión. El botón queda desactivado si hay cambios sin guardar o una operación en curso. El PDF comercial versionado conserva su generación, términos y líneas/importe propios; no se sustituyen ni mezclan documentos. Los datos de notas internas no se imprimen. No cambian modelos, RPC ni reglas de cobro.

Resultado local segunda PR: suite completa 982 aprobadas + 6 omitidas; navegador Pedido rápido a 390/1280 px confirma 85,00 € de total, 30,00 € entregados y 55,00 € pendientes, reintento con la misma clave, un solo pedido y Crear otro bloqueado durante cobro. Prueba de editor de presupuestos: 290 aserciones, a 390/768/1280 px en claro/oscuro, impresión con revisión y bloqueo por cambios sin guardar. SQL prueba total indefinido, exceso, total inferior a pagos, replay y otro tenant; rollback correcto.

## Comprobación real de impresión

La hoja de control de DEMO-P0004 (revisión 3 preparada) abría correctamente, pero imprimía Borrador al leer el catálogo operativo antiguo. El loader de impresión reutiliza ahora `commercialStatus`, igual que la ficha y la lista, tomando el estado de la revisión actual ya incluido en QUOTE_SELECT. No escribe estados, no prepara versiones ni modifica el PDF comercial. Mantiene la autorización/feature y las consultas con tenant_id. Pruebas del loader cubren preparado, enviado, aceptado, convertido, presupuesto básico y denegación de acceso.
