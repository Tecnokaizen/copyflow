# P0 — Convertir presupuesto en pedido

Base auditada: `d2f6faf4912e9e92eb884233780d1c18375736c8` (`origin/main`).
Rama: `fix/quote-conversion-p0`. Fecha: 7 de octubre de 2026.

## Fuentes y alcance

La arquitectura oficial de `sources/Arquitectura inmutable de Copyflow.md` prevalece sobre las referencias históricas de SUR4/Airtable: un codebase, un proyecto/deployment de Vercel y un proyecto Supabase/PostgreSQL compartido; aislamiento por tenant_id, memberships y RLS. Las fuentes se consultaron sin modificarlas.

Solo conversión presupuesto → pedido. Sin configuración específica por tenant, cambios de infraestructura, notas internas, footer, ficha de cliente ni nuevas reglas de aceptación.

## Hallazgo reproducido y corrección

La acción existía en main, pero `QuoteCommercialEditor` ocultaba tanto el botón como su sección hasta disponer de una versión aceptada. En borrador, preparado sin PDF y otros estados no había indicación de cómo llegar a la conversión. La nueva prueba falla sobre main esperando encontrar “Convertir en pedido” en un borrador; pasa sobre la corrección.

La acción ahora aparece en la ficha actual desde el borrador, deshabilitada con instrucciones del paso pendiente. Se habilita cuando el estado es accepted, existe accepted_version_id y no hay converted_order_id. Tras convertir, la ficha muestra el pedido generado. La consulta de una revisión histórica mantiene su comportamiento de solo lectura.

Se conserva el requisito comercial ya implementado: preparar → PDF → registrar envío → registrar aceptación → convertir. No se permite convertir borradores ni presupuestos enviados/rechazados directamente. No se ha inspeccionado un presupuesto concreto de producción; el hallazgo reproducido es de visibilidad en el código de main.

Dos endurecimientos del mismo flujo:

- Recargar tras un conflicto cierra la confirmación antigua de conversión y exige abrir una nueva.
- La fecha de entrega usa el conversor común de Pedidos y rechaza horas locales inexistentes por cambio horario, en lugar de normalizarlas silenciosamente.

## Auditoría de API, schema y autorización

- `POST /api/quotes/[id]/convert` conserva `requireQuotesAccess`: sesión del usuario, contexto del tenant, rol operativo y feature quotes. `commercialQuoteInTenant` filtra id + tenant del contexto antes de la RPC. El payload solo pasa campos operativos explícitos y expected_row_version; no confía en tenant_id, created_by ni vínculos suministrados por el cliente.
- La RPC de siete argumentos `convert_quote_to_order` usa el helper privado `quote_commercial_lock_v1`: autoriza membership activa, rol owner/admin/manager/staff y feature antes de bloquear la fila. SECURITY DEFINER tiene search_path vacío y comprobaciones explícitas; no utiliza service_role como acceso del tenant. El overload antiguo de un argumento sigue revocado.
- Se requiere el estado accepted y la revisión aceptada del mismo presupuesto/tenant, bloqueada en estado sent. El reintento autorizado devuelve el pedido existente antes de comprobar el token antiguo. Una primera conversión exige row_version actual, relaciones activas del tenant, prioridad válida y un único estado inicial activo.
- INSERT del pedido y UPDATE del vínculo pertenecen a una única transacción. Los triggers existentes asignan referencia y actividad. El presupuesto y su documento original se conservan; no se duplican partidas ni PDF como archivos del pedido.
- `quotes_converted_order_fk` es compuesta por tenant_id + order_id. El índice único `quotes_one_conversion_order` y el trigger `quote_conversion_stable` protegen el enlace. Los grants por columna impiden escribirlo directamente desde authenticated. RLS permanece activa en quotes, quote_versions, quote_items y orders.
- El pedido conserva metadata de presupuesto/revisión y la ficha obtiene el origen con `order_source_quote_v2`, autorizado y acotado al tenant.

No se necesita una nueva migración: las garantías del servidor ya existen y se verificaron sin relajarlas.

## Validación

| Comprobación | Resultado |
| --- | --- |
| Prueba de navegador nueva contra main sin corregir | Falla al no encontrar el botón en borrador |
| Suite completa, Node 22.23.2 / TZ=UTC | 899 tests: 893 pass, 6 skipped, 0 fail |
| Navegador, componentes/CSS reales y dobles HTTP | 481 comprobaciones; 390/768/1280 px, claro/oscuro |
| SQL phase34, phase40, phase41, phase42 y phase43 ampliada | Todas correctas |
| Concurrencia phase43 | 8 conversiones del mismo presupuesto → 1 pedido y 1 evento; 4 presupuestos adicionales concurrentes → referencias distintas |
| Lint, TypeScript, build Webpack y diff check | Correctos |

La prueba HTTP añade identidad/vínculos manipulados y denegación de permisos de PostgreSQL. SQL añade token obsoleto, estado inicial ausente, conservación completa de revisión/partidas, vínculo de vuelta al original, roles operativos, membership inactiva y anon. Conserva los casos de viewer, feature desactivada, relaciones de otro tenant, relaciones inactivas e idempotencia.

Navegador añade visibilidad y explicación por estado, confirmación explícita, doble clic, pérdida de respuesta después de commit y reintento, respuesta reconocida con refresco fallido, recarga de conflicto y hora inexistente en Europe/Madrid. CI incorpora este smoke y se activa también por cambios en componentes de presupuestos.

Las pruebas SQL se ejecutaron en `quote_conversion_p0`, una copia desechable de la base local de pruebas. Se preservan propietarios de RPC, grants, políticas RLS, constraints y triggers de negocio. Se omiten únicamente los event triggers de automatización de DDL/recarga de APIs para evitar las restricciones de restauración de sus propietarios. No intervienen en las operaciones evaluadas. La build requirió acceso de red para la fuente Geist ya utilizada por el proyecto.

Evidencias locales en `../output/quote-conversion-p0/` (respecto al checkout): tests.log, lint.log, types.log, build.log, sql-results.json, logs SQL/concurrencia y ui/results.json con capturas. El navegador usa dobles HTTP; autorización y concurrencia se validan por separado en PostgreSQL real. No equivale a un recorrido con sesión real contra producción.

No se aplicaron migraciones ni se alteraron datos, overrides o despliegues de producción. La publicación de la corrección requiere revisión y merge mediante el flujo habitual del repositorio.
