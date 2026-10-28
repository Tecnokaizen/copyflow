# SUR4 — Registro de entregas E0–E11

Post-its, secuencia de trabajo (multirresponsabilidad), ficha y documentos A4.
Fuente de verdad: [ADR SUR4-01](adr/2026-10-27-sur4-ficha-postits-secuencia.md) y
[contrato técnico E0](SUR4-FICHA-POSTITS-CONTRATO.md). Este registro solo anota
estado y evidencias; si algo contradice al ADR o al contrato, mandan ellos.

Rama de trabajo: `feat/sur4-postits-secuencia`, desde `main` `e218939`.
Autorización del propietario (28/10/2026): desarrollo completo E0–E11, ramas,
commits, pruebas y PR en borrador. **No autorizado:** merge a `main`,
migraciones o despliegues en Production, datos reales de SUR4, cambios
destructivos. Migraciones y despliegues en Staging solo tras comprobar copia
y compatibilidad, y con ventana acordada con las sesiones de Stripe y release.

## Estado

| Entrega | Estado | Commit | Evidencias | Bloqueos para el merge |
| --- | --- | --- | --- | --- |
| E0 · Decisiones | Hecha | `0cf2639` | ADR y contrato copiados sin cambios: SHA-256 `eff3f524…` y `9e4c37c5…`, iguales a la exportación del documento (rev 17 y rev 10) | N15 |
| E1 · Pistas PostgREST | Hecha | `d0129d8` | `!orders_team_member_fk` en los cinco embeds reales del responsable (el documento contaba seis: `orders/mine` y la revisión solo leen la columna). `team_members(*)` pasa a `(id, name, active)`. `lib/orders/postgrest-hints.test.ts` falla sin la pista (comprobado quitándola). PostgREST local responde 200 con las pistas | N15 |
| E2 · Impresión segura | Pendiente | — | — | N15, N11, auditoría N23, tienda (SUR4) |
| E3 · Ficha reorganizada | Pendiente | — | — | N15 |
| E4 · Resguardo PDF | Pendiente | — | — | N15, N9, N12 |
| E5 · Post-its: base de datos | Hecha en local | `ca03c4e` | Migración `20261028120000_order_notes_v1.sql`: tablas `order_notes`, `order_note_versions` y `order_note_events` (historial solo de añadir), funciones `order_sticky_notes`, `order_custom_labels` y `order_work_sheet_ficha` apagadas por defecto, RLS de lectura por miembro y función activa, escritura solo por RPC. Base local aislada desde cero: invariantes del release gate PASS, `phase60_order_notes_v1.sql` PASS (roles, tres tenants, función apagada y retirada, impresión con autorización, N4/N5, «Pasar a post-it», historial, purga y supresión T11/T12), `phase60_order_notes_concurrency.sh` PASS (C4, C5, C6, C7, C9, sesiones nuevas, baja de tenant). Rollback `supabase/rollbacks/20261028120000_order_notes_v1.sql` probado (quitar y volver a aplicar). Ambas suites añadidas al CI | N15, N3, N4, N5, N8 |
| E6 · Post-its: API y ficha | Pendiente | — | — | N15 |
| E7 · Secuencia: base de datos | Hecha en local | `99207b4` | Migración `20261028130000_order_work_sequence_v1.sql`: `work_stages` (catálogo por tenant, sin semilla, nunca se borra) y `order_work_steps` (1–10 pasos, persona opcional mientras está pendiente, ejecutor, cuenta que marca, «Le toca» calculado). Función `order_work_sequence` apagada por defecto. RPC `replace_order_work_steps_v1`, `set_order_work_step_done_v1`, `team_work_load_v1`, `upsert_work_stage_v1` y `create_suggested_work_stages_v1`. `phase61_order_work_sequence_v1.sql` PASS (D5, D6, D14, D15, R6, tenants, roles, escritura directa, archivado, carga sin duplicar, retirada y vuelta de la función, purga), `phase61_order_work_sequence_concurrency.sh` PASS (C1, C2/C11, C3, C4, C8, C12, C13, C14, sesiones nuevas, TRUNCATE, baja de tenant), `phase62_order_features_isolation.sql` PASS (matriz de cuatro tenants, T1, T2, T4, T9, T10). Rollback probado: se niega con datos, quita concesiones y se vuelve a aplicar. Las 45 suites de la base del release gate PASS en local con E5 y E7 | N15 |
| E8 · Secuencia: API, Configuración y ficha | Pendiente | — | — | N15 |
| E9 · Secuencia: listas y panel | Pendiente | — | — | N15 |
| E10 · Integración | Pendiente | — | — | Staging autorizado |
| E11 · Ayuda y cierre | Pendiente | — | — | E10 |

N15 = F12 cerrada y #146 fusionada en `main`.

## Decisiones pendientes y cómo se implementan mientras tanto

Se implementa la recomendación escrita en el documento (sección 8). Cada una
queda aislada para cambiarla sin rehacer la entrega, y ninguna entrega que la
use se fusiona hasta que el propietario la cierre.

| # | Recomendación implementada | Dónde vive | Si cambia |
| --- | --- | --- | --- |
| N3 | Estados Abierta, Resuelta y Anulada, más fijar | `order_notes.state`, `set_order_note_state_v1` | Un `CHECK` y una rama de la RPC |
| N4 | Solo el autor edita sus notas abiertas; anulan el autor, owner, admin y manager | `update_order_note_v1`, `set_order_note_state_v1` | Dos comprobaciones de rol en la RPC |
| N5 | Los post-its no suben `orders.row_version` | RPC de notas | Añadir el `UPDATE` con la marca de R5 |
| N8 | Destinatario «Para» opcional y sin avisos | `addressee_team_member_id` | Sin cambios de esquema |
| N9 | Hoja en el navegador; Resguardo en PDF de servidor, sin guardar en R2 | E4 | Solo E4 |
| N11 | Importes visibles para todos los miembros, como hoy | E2/E3 | Solo la ficha |
| N12 | Instrucciones en el Resguardo como «Descripción del trabajo» | E4 | Un bloque del PDF |

## Desviaciones respecto al documento

Anotadas para la revisión del propietario. Ninguna cambia una decisión de negocio.

| Entrega | Documento | Implementado | Motivo |
| --- | --- | --- | --- |
| E1 | Seis embeds sin pista | Cinco | `orders/mine` y la revisión leen la columna, no embeben la persona |
| E1 | Riesgo R1: embeds ambiguos al crear las tablas | En local, con E5 y E7 aplicadas, `orders → team_members` sin pista sigue respondiendo 200 (PostgREST 16.2 no trata `order_work_steps` como tabla puente). `order_work_steps → team_members` sin pista sí da 300 (`PGRST201`) | E1 se mantiene como defensa y por R2 (columnas explícitas). La prueba de E1 obliga a poner pista también en el código de E8 |
| E5 | Las RPC ponen la marca `app.order_write` | No la mencionan | Invariante 7c del release gate: solo funciones INVOKER que actualizan `orders` pueden nombrarla. Las RPC son DEFINER y R5 ya exime a su propietario |
| E5 | Errores del contrato | Más `invalid_visibility`, `invalid_action` e `invalid_reason` (422) | Entradas mal formadas no deben caer en un 500 |
| E5 | Motivo solo al anular | Opcional al fijar, resolver o reabrir; obligatorio al anular | N22/T12 pide suprimir varios motivos de una misma nota |
| E5 | — | Cualquier acción sobre una nota anulada responde `conflict` | La anulación es definitiva; evita reabrir por carrera |
| E5 | — | La supresión de texto funciona también en pedidos archivados | Una petición de datos personales no espera a que el pedido vuelva a estar activo |
| E5 | — | El trigger de actividad de contenido no copia `orders.notes` cuando lo vacía «Pasar a post-it» | Si no, el texto antiguo acabaría en `activity_log` |
| E7 | Las RPC ponen `app.order_write` y entran en `phase58_order_rpc_integrity` | No la mencionan; sus pruebas están en `phase61` | Invariante 7c del release gate, como en E5 |
| E7 | Errores de F1·01/02 | `member_unavailable` pasa a `member_unassignable` (contrato). Más `invalid_action` en marcar, y `invalid_name`, `invalid_icon`, `invalid_sort_order`, `duplicate_name` y `too_many_stages` en fases | Entradas mal formadas no deben caer en un 500 |
| E7 | RPC de fases sin definir en F1·01/02 | `upsert_work_stage_v1` (alta y cambio, incluida la desactivación) y `create_suggested_work_stages_v1` (*Crear fases sugeridas*, idempotente). Máximo 30 fases por tenant | El contrato pide una RPC de fases; F1 solo describía la RLS de catálogo |
| E7 | — | Las fases y los pasos tampoco se leen con `service_role` (solo `authenticated`, con RLS) | Mismo patrón que las líneas de pedido; ninguna ruta de servidor los lee con la clave de servicio |
| E7 | — | `team_work_load_v1` también devuelve `current_unassigned` y `current_unavailable` (turnos sin persona o con persona no elegible) | Para el filtro *Pasos sin asignar* y el aviso de D6 sin otra consulta |
| E7 | Paso hecho: ejecutor «Lo hice yo» u otra persona elegible | El ejecutor debe cumplir R6 (activa y puede recibir pedidos), como la persona asignada | Una sola regla de elegibilidad (ajuste 2) |

## Orden de migraciones

`20261028120000` (E5) y la de E7 van detrás de `20261028090000` (plan Pro),
aplicada en Staging pero no en Production. En Staging el orden es natural. En
Production, si E5/E7 llegan antes que el plan Pro, la migración del plan Pro
quedaría por detrás de la última aplicada y `supabase db push` pediría
`--include-all`. El orden se acuerda con la sesión de Stripe en la PR de
Production, no aquí.

## Datos que no dependen del código

- Respuesta de SUR4 sobre si la Hoja muestra la tienda (antes del merge de E2).
- Auditoría N23 en Production, con su propia autorización (antes del merge de E2).
- Visto bueno de Tamara para #146 (puerta N15).
- Significado de las fechas de prueba (N10): no bloquea ninguna entrega.
