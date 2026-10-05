# Presupuestos V1 — núcleo SQL comercial

Base revisada: `origin/main@a7fc903f0d32e77bf877ff61a3eb8ad7753c08bf`, consultada en GitHub el 5 de octubre de 2026. No hubo avances respecto a la auditoría del 1 de octubre. Rama: `feat/quotes-commercial-v1`.

## Alcance y arquitectura

Un repositorio, un deployment Vercel y un proyecto Supabase compartido. El aislamiento reutiliza `tenant_id`, memberships activas, `has_tenant_role`, `tenant_has_feature` y RLS. Los documentos de SUR4/Airtable son referencias funcionales; la arquitectura inmutable de COPYFLOW y la petición de este bloque prevalecen. SUR4/ANFRE solo aparece como fixture de la suite comercial.

Tres migraciones nuevas, sin modificar migraciones anteriores:

1. `20261005170000_quote_commercial_schema.sql`: columnas comerciales de `quotes`, versiones, partidas, restricciones compuestas y SELECT con RLS.
2. `20261005171000_quote_commercial_invariants.sql`: fiscalidad numeric, inmutabilidad, rollup y proyección.
3. `20261005172000_quote_commercial_rpcs_backfill.sql`: cuatro RPC públicas autenticadas, helpers privados y backfill idempotente.

No cambia referencias, contadores, estados existentes, grants por columna de `quotes`, conversión actual a pedido, endpoints o UI. `quotes.row_version` ya existe y se conserva. No se usa service_role en estas operaciones.

## Contrato RPC

Todas devuelven JSONB. Éxito: `{ "ok": true, "version": <fila quote_versions> }`. La ensure incluye `created`. Error de dominio: `{ "ok": false, "error": <código> }`; un conflicto incluye `row_version` actual. UUID inexistente, de otro tenant, membership ausente/revocada, viewer o feature OFF devuelven `not_found`. La autorización se comprueba antes del bloqueo de filas y antes de validar datos del cliente.

| Función | Argumentos | Comportamiento |
|---|---|---|
| `ensure_quote_draft_v1` | `p_quote_id uuid` | Devuelve la draft existente o crea v1 para un presupuesto compatible sin versiones. Histórico existente sin draft: `new_version_required`. |
| `save_quote_draft_v1` | `p_quote_id uuid, p_version_id uuid, p_expected_row_version bigint, p_header jsonb, p_items jsonb` | Reemplaza cabecera comercial y todas las partidas de una draft. Máximo 500 partidas. Detecta `conflict`, `immutable_version`, `not_found` e `invalid` estructural. |
| `create_quote_version_v1` | `p_quote_id uuid` | Clona la última prepared/sent en una nueva draft. Devuelve `draft_exists` si ya hay draft o `history_required` si no hay histórico. No copia IDs de partida ni pdf_file_id. |
| `prepare_quote_version_v1` | `p_quote_id uuid, p_version_id uuid, p_expected_row_version bigint` | Recalcula partidas, exige al menos una, toma snapshots del servidor, bloquea en prepared y proyecta importes. No cambia status_id ni sent_at del presupuesto. |

`p_header` es una sustitución completa de los campos opcionales: `title`, `description`, `terms`, `issue_date`, `valid_until`, `currency`, `prices_include_tax`, `contact_name`, `contact_email`, `contact_phone`, `billing_name`, `tax_id`, `billing_address`. Si falta description conserva la descripción anterior; issue_date, currency y prices_include_tax también conservan su valor si faltan. Los demás opcionales ausentes quedan NULL. La descripción operativa existente sigue siendo obligatoria y no vacía. client_id y otros enlaces operativos permanecen bajo el contrato anterior de quotes.

Cada elemento de `p_items`: `concept`, `description`, `quantity`, `unit`, `unit_price`, `discount_percent`, `tax_rate`. La posición la determina el orden del array (1..N). Descuento e IVA ausentes valen 0. quantity > 0, unit_price >= 0, descuento e IVA entre 0 y 100, concept no vacío. Money, IDs, estado y snapshots suministrados por cliente se ignoran. Payloads con valores inválidos fallan con errores PostgreSQL (23514/22xxx); la transacción completa revierte. El futuro adaptador HTTP deberá traducirlos a validación de entrada.

`expected_row_version` corresponde a la versión comercial, no a quotes. Es un token opaco: cada cambio de cabecera/partida hace avanzar el contador; no asumir incrementos de uno por RPC. La proyección también hace avanzar el contador existente de quotes. El cliente debe usar siempre el token devuelto por la última RPC.

## Invariantes y cálculo

UNIQUE protege version_number por quote y un índice parcial protege una sola draft. FKs compuestas protegen versiones, partidas, current_version_id, accepted_version_id y pdf_file_id por tenant/presupuesto. El puntero aceptado exige una versión sent mediante guard. El índice compuesto adicional de quote_files prepara la integración del PDF sin generar archivos.

Los triggers rechazan UPDATE/DELETE de prepared/sent y INSERT/UPDATE/DELETE de sus partidas. Las identidades de versiones y partidas son inmutables. El modo fiscal solo puede cambiar en una draft sin partidas; save vacía y repone las partidas dentro de la misma transacción. Los importes enviados por cliente nunca se guardan como resultados fiscales.

Todo se calcula en numeric. Se aplica descuento al bruto, se divide por 1+IVA para precios incluidos y se redondea cada componente de cada partida a dos decimales. El documento suma los componentes ya redondeados de las partidas, incluido total; no recalcula el IVA sobre el agregado. tax_breakdown agrupa los mismos importes por tipo impositivo. El redondeo de numeric es el de PostgreSQL, incluyendo los medios céntimos. No convertir importes a float en el futuro adaptador.

Cada RPC serializa el agregado mediante bloqueo de quote y después versión. UNIQUE sigue siendo la defensa estructural contra duplicados. Sin escrituras INSERT/UPDATE/DELETE/TRUNCATE directas de authenticated en las tablas nuevas. SECURITY DEFINER con search_path vacío y EXECUTE únicamente para authenticated en las cuatro RPC públicas; helpers y funciones de triggers no se exponen.

## Backfill y compatibilidad

Cada presupuesto anterior obtiene una v1 sin partidas ni importes inventados: total, subtotal y tax_total = 0. draft/pending -> draft; sent/accepted/rejected -> sent bloqueada; otros estados históricos -> prepared bloqueada. accepted enlaza accepted_version_id a esa versión sent. La hora de envío desconocida queda NULL. El helper privado se ejecuta en la migración y puede probarse como propietario de BD; no es una RPC de cliente. Repetirlo no duplica versiones.

Las referencias de presupuestos y pedidos y sus contadores no se modifican. Los estados y timestamps históricos existentes permanecen. issue_date/currency/prices_include_tax reciben los defaults aditivos iniciales (fecha de aplicación/EUR/false); no constituyen evidencia recuperada de un documento antiguo. No hay datos económicos anteriores que permitan inferir impuestos.

## Pendientes deliberados

- La UI y endpoints actuales siguen operando con su contrato previo. La edición comercial necesita un adaptador que utilice estas RPC; no se ha conectado la UI a versiones.
- Envío explícito, aceptación/rechazo/expiración, PDF/R2 y conversión comercial a pedido quedan fuera. No existe RPC de envío y este bloque no permite actualizar prepared a sent. El siguiente diseño de envío debe conservar contenido inmutable y definir cómo registrar su transición/evento sin permitir editar el documento.
- pdf_file_id es nullable y protegido por FK. Adjuntarlo después de preparar requerirá una asociación de entrega/archivo compatible con la inmutabilidad; no abrir una excepción genérica de UPDATE.
- El snapshot vendedor utiliza únicamente datos existentes: tenant_id, business_name, logo_url y branding. No inventa NIF/dirección del vendedor; la futura configuración fiscal deberá proveerlos.
- El backfill masivo bloquea presupuestos y actualiza su row_version; revisar duración/ventana antes de una futura aplicación autorizada. Este trabajo solo lo aplicó en una base local aislada.

Siguiente bloque recomendado: adaptador HTTP y contratos de lectura/edición comercial, conservando importes decimales y manejo de conflictos, seguido de UI de draft/preparación. El envío/PDF debe diseñarse como bloque separado.
