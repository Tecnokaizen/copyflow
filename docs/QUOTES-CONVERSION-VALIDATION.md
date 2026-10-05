# Accepted → Order y cierre de rama

6 octubre 2026. Worktree existente gestcopy-quotes-commercial-v1, rama feat/quotes-commercial-v1. Se respetan una codebase, Vercel/Supabase compartidos y aislamiento tenant_id + membership + RLS. No cloud, push, merge ni despliegue. sources/ intacto.

## Gate secuencial

Bloque 1 se cerró y comprometió antes de iniciar Bloque 2: 873 PASS / 879 tests, 6 SKIP, cero FAIL; phase42 y concurrencia PASS; UI 392 PASS; lint, tipos y Webpack PASS; migraciones desde cero PASS. Las cuatro suites SQL legacy con fallo conocido no empeoraron. Véase QUOTES-TRANSITIONS-VALIDATION.md.

## Contratos finales

- 20261006100000_quote_commercial_transitions.sql: transition_quote_v1, set_editable_quote_status_v1; guards de estados/documentos y create_quote_version_v1 adaptado.
- 20261006110000_quote_accepted_conversion.sql: nueva firma convert_quote_to_order(uuid,uuid,uuid,uuid,text,timestamptz,bigint), revocación de la firma legacy convert_quote_to_order(uuid), trigger quote_conversion_stable, índice único de converted_order_id, lectura order_source_quote_v2.
- POST /api/quotes/:id/send|accept|reject: version_id y expected_row_version del quote, resumen current_version, accepted_version_id y replayed.
- POST /api/quotes/:id/convert: store_id/service_id/assigned_team_member_id explícitos (UUID o null), priority, due_at (ISO con zona o null), expected_row_version. Devuelve order_id/reference, order, quote.converted_order_id, created/replayed.
- GET /api/orders/:id añade source_quote externo al DTO de pedido; IDs, referencia, total decimal textual, moneda, versión aceptada. La RPC liga host tenant + membership + feature + quote.converted_order_id + accepted version. No usa metadata del pedido como autoridad.
- UI: QuoteCommercialEditor + QuoteConversionDialog; QuoteDialog compartido permite campos y scroll móvil; OrderSourceQuote integrado en OrderWorkspace. Accepted mantiene el documento estable y no promete Nueva versión.

## Máquina de estados

Quote draft/pending con versión draft → preparar versión prepared (quote sin cambio) → generar PDF oficial ready → acción send (quote sent, versión sent) → accept/reject (quote accepted/rejected, versión sigue sent). accepted_version_id se fija exclusivamente al aceptar la current sent.

Sent/rejected → Nueva versión → nueva draft, quote draft, PDF e histórico antiguos conservados. Accepted no se versiona, ni pierde accepted_version_id. Accepted → convertir → mismo estado accepted, un único converted_order_id.

PATCH rechaza explícitamente status_id/current_version_id/accepted_version_id/converted_order_id; UPDATE(status_id) revocado a authenticated. RPC genérica solo draft/pending/expired desde editable. Trigger bloquea INSERT y cambios comerciales no controlados. Los códigos de catálogo ya eran inmutables; names/labels siguen configurables.

Locks quote → accepted/current version → operaciones de archivos cuando proceda. Row-version obligatorio para transición nueva; replay exacto de la misma versión/comando se reconoce antes de comparar token viejo. La conversión toma el lock antes de buscar converted_order_id: un ganador crea el pedido y las restantes llamadas devuelven ese ID sin modificar sus campos. accept vs reject serializado. El link convertido no se puede borrar ni cambiar posteriormente.

## Conversión y archivos

Solo accepted con accepted_version_id sent del mismo quote/tenant. Usa versión aceptada para título y descripción comercial; client_id del quote, catálogos explícitos activos del tenant, prioridad normal/high/urgent existentes y due_at explícito. Store sigue siendo opcional, conforme al modelo actual de orders. Reutiliza INSERT de orders: triggers de numeración, Activity y estado inicial activo único configurado en el tenant. Sin defaults de SUR4.

No copia notas internas a pedidos. No INSERT en order_files, PUT R2, nuevo archivo ni cuota de PDF. Origen autoritativo: quotes.converted_order_id + accepted_version_id. En pedido se muestra referencia, importe, Aceptado/vN y Ver presupuesto → /quotes/:id, donde el PDF oficial original sigue protegido y autenticado.

## Validación final

Node 22.23.2, TZ=UTC para paridad con CI.

| Gate | Resultado |
|---|---|
| Tests completos | 883 total; 877 PASS, 0 FAIL, 6 SKIP previos |
| Quotes focalizados | 98/98 PASS, cero SKIP |
| Lint | PASS, cero errores/avisos |
| tsc --noEmit | PASS |
| Webpack build | PASS |
| Turbopack | FAIL ambiental EPERM en proceso/puerto PostCSS, react-day-picker/style.css; mismo fallo previo |
| Migraciones desde cero | PASS, ambas migraciones nuevas, base local aislada 55422 |
| SQL | 38/42 PASS; cuatro fallos legacy idénticos al baseline |
| Concurrencia | 11/11 ejecuciones PASS; además phase43 ampliada con cuatro conversiones distintas y cinco referencias únicas PASS |
| Smoke UI | 458 assertions PASS; 390/768/1280, claro/oscuro, componentes/CSS reales con HTTP doubles |
| Diff y sintaxis shell | PASS |

SQL completa inicialmente dio 37/42 por la llamada legacy de phase35. Se adaptó a accepted + payload explícito y la repetición focalizada de phase35/phase43 pasó; resultado consolidado 38/42. Tests adaptados phase33/34/35/38 usan fixture pg_temp de aceptación legacy solo dentro de pruebas; phase42/43 ejercitan realmente PDF firmado → send → accept y concurrencia. La fixture nunca es migración/RPC de producto. CI incorpora phase41/42/43 y sus pruebas concurrentes, después de suites de archivos para evitar colisión de credenciales de fixtures.

Fallos previos pendientes: phase11 min(uuid) inexistente; phase2a espera 42501/recibe GTI01; phase7 not authenticated; quick_order_layout requiere seed. Los seis SKIP son el harness PostgREST que no está levantado en este entorno aislado.

Scope del smoke: componentes y CSS reales, HTTP doubles. Seguridad/transacciones/concurrencia verificadas con handlers y PostgreSQL real local. No smoke cloud R2 ni prueba E2E contra servicios Production.

## Next y riesgos

Next instalado 16.3.4; eslint-config-next 16.3.4. Informe npm audit local previo: 10 avisos, 9 high + 1 critical. Critical: GHSA-vcvr-r3jv-pc5j, RCE en next/og ImageResponse Node con contenido SVG controlado por atacante. Rango >=16.2.0 <16.3.6; corregido desde 16.3.6. Informe local propone 16.3.8, patch. Sin CVE publicado en la ficha consultada.

Fuente pública verificada: https://github.com/advisories/GHSA-vcvr-r3jv-pc5j . Búsqueda en app/lib/components no encuentra next/og ni ImageResponse; no se ha identificado el camino vulnerable descrito en esta rama. Esto no certifica toda la seguridad de dependencias.

No se actualiza Next: aunque el candidato es patch, el baseline ya documenta discrepancias de npm ci con dependencias opcionales del lockfile. No se ha demostrado un cambio completamente aislado y compatible. Hardening separado antes de Production: reconciliar lockfile, actualizar Next/eslint-config-next a patch corregida compatible, revisar transitive diff, repetir install/build/SSR/smoke y audit.

La consulta nueva npm audit fue rechazada por revisión automática por posible egress del árbol de dependencias. Se completó la revisión con el informe local y el advisory público. También se rechazaron restaurar permisos directos y eliminar una credencial de fixture; se mantuvo la revocación y se reconstruyó la base local aislada como alternativa. No queda una acción funcional pendiente de aprobación.

Rama lista para auditoría final previa a merge. No equivale a validación Production: siguen la deuda SQL legacy, PostgREST harness, Turbopack ambiental y hardening de dependencias. Email real, aceptación pública, WhatsApp, firma y recordatorios quedan fuera del alcance.
