# Hotfix UX: bloqueo de creación segura

Base auditada: `46038590cdfd6f6454ca2398659252bcafcc48ad`.
Rama: `fix/quotes-ux-flow-v1`.

## Diagnóstico

- `app/quotes/new/page.tsx` presenta `QuoteForm`, envía únicamente la ficha operativa a `POST /api/quotes` y redirige al detalle. No guarda partidas ni cabecera comercial.
- `app/api/quotes/route.ts` inserta un quote nuevo con UUID generado por PostgreSQL. No acepta identificador de operación ni recupera una creación anterior.
- Si PostgreSQL confirma el INSERT pero se pierde la respuesta HTTP, el navegador carece del ID. Repetir POST duplica el presupuesto. Conservar el ID después de recibir respuesta no cubre este caso.
- `POST /api/quotes/:id/draft` reutiliza `ensure_quote_draft_v1`, que abre o devuelve el borrador existente bajo bloqueo del agregado. Es reutilizable, pero requiere conocer el ID del quote.
- `PUT /api/quotes/:id/draft` utiliza control de concurrencia por versión. Ante respuesta perdida, debe releerse el detalle antes de continuar; no debe repetirse con otra versión sin comprobar el contenido.
- `lib/quotes/editor.ts::editorValues` lee contactos de quote, mientras `quote_client_snapshot_v1` aplica fallback al maestro. La interfaz omite datos que el snapshot sí puede contener.
- `quote-commercial-editor.tsx` muestra historial con cualquier versión y la tarjeta de estado con cualquier versión actual; expone `vN`. También hay etiquetas técnicas en lista y PDF.

## Extensión HTTP mínima propuesta, sin migración

1. La nueva pantalla genera un UUID estable por operación y conserva UUID y formulario para recuperar reintentos/recargas.
2. Extender POST `/api/quotes` con ese ID opcional; usar la PK existente como identidad de creación. Mantener compatibilidad con clientes legacy.
3. Validar permisos, tenant y relaciones como hoy. Insertar sin upsert que sobrescriba datos. Ante conflicto de PK, recuperar exclusivamente dentro del tenant y comprobar creador y compatibilidad de la solicitud. Conflictos incompatibles deben devolver 409; nunca revelar datos de otro tenant.
4. Una respuesta incierta se recupera por el mismo ID. No se crea otro UUID automáticamente. La unicidad existente en PostgreSQL resuelve llamadas concurrentes entre procesos HTTP.
5. Con el quote conocido, abrir el borrador con la RPC actual y guardar con la RPC actual. Conservar el mismo quote ante fallos parciales. Releer y reconciliar contenido ante resultado ambiguo o conflicto; no borrar automáticamente ni sobrescribir modificaciones concurrentes.
6. Redirigir solo tras confirmar el borrador completo. Preparar utiliza después la transición actual, conservando inmutabilidad, snapshots y autorización.

Esto ofrece creación recuperable, no una transacción atómica de los tres pasos. Puede existir temporalmente un quote incompleto tras un fallo; el reintento debe completarlo con la misma identidad. Una transacción totalmente atómica requeriría una RPC nueva, y no se propone SQL en esta fase.

## Estado

Se detiene la implementación conforme a la instrucción explícita de reportar antes de extender el backend cuando las APIs actuales no permitan reintentos seguros. No hay cambios de aplicación, esquema, migraciones, Production ni hardening de Next. No se han ejecutado suites ni validación visual; no existe todavía un hotfix funcional listo para merge.

Tras decidir la extensión HTTP, quedan pendientes el editor único, autofill por campos pristine, lenguaje de revisiones, pruebas de pérdida de respuesta/concurrencia y las validaciones de código y seis combinaciones de tamaño/tema solicitadas.
