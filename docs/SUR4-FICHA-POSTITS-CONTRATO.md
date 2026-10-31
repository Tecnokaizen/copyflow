# Contrato técnico E0 — SUR4: ficha, post-its y secuencia

Oct 27, 2026 · Propuesta para revisión. No hay rama, archivo en el repositorio, migración ni despliegue.

Este contrato fija lo que todas las entregas dan por hecho: nombres, firmas, errores, campos impresos, puertas y pruebas. Si una entrega necesita cambiar algo de aquí, lo cambia antes en el contrato, con tu visto bueno. Nada de esto toca F7–F12.

## 1. Qué entrega E0

E0 se cerró en el documento el 27/10, sin rama. La primera rama que autorices añade al repositorio solo esto, sin cambiar su contenido:

- `docs/adr/2026-10-27-sur4-ficha-postits-secuencia.md`: el ADR SUR4-01.
- `docs/SUR4-FICHA-POSTITS-CONTRATO.md`: este contrato.

E0 es solo documental: no lleva código, migración ni concesiones, no consulta Production y no se fusiona hasta que pase la puerta de merge. Los módulos `lib/orders/order-features.ts` y `lib/orders/labels.ts` nacen en E2, su primer consumidor, con sus pruebas unitarias; E3 los reutiliza, y por eso depende de E2.

## 2. Cierre de E0 (27/10)

- [x] N22, N23 y N24 aprobadas el 27/10 con condiciones, y N25 (perfiles de la Hoja de trabajo) como condición sobre E2.
- [x] N15 aprobada: nada se fusiona hasta cerrar F12 y fusionar #146.
- [x] Las cuatro confirmaciones de *Contradicciones con lo aprobado*, resueltas el 27/10: ficha para todos, `order_work_sheet_ficha` en E5, perfil estándar con todos los campos de hoy salvo `orders.notes`, y Resguardo para todos.
- [x] Ajuste de N22 del 27/10: los motivos sin datos personales se conservan, y solo se sustituyen los que el owner señala.
- [x] Este contrato, revisado.
- [x] E0 cerrado documentalmente el 27/10. No autoriza E1–E11, ramas, commits, migraciones, merges ni despliegues.

Siguen pendientes, sin bloquear el cierre de E0, la auditoría de N23, que necesita su propia autorización, y la respuesta de SUR4 sobre la tienda, las dos antes del merge de E2. El significado de las fechas de prueba no bloquea ninguna entrega.

## 3. Puertas

| Puerta | Afecta a | Condición |
| --- | --- | --- |
| Merge | Todas, también E0 | F12 cerrada y #146 en `main` (N15) |
| Base de datos | E5 y E7 | R5 (#147) y R6 (#148) en `main`, y migración posterior a `20261022130000` |
| Production con migración | E5 y E7 | Dry-run que solo lista su migración, lote v2 verificado de menos de 2 h y autorización propia. Nunca en el mismo push que otra migración |
| Merge de E2 | E2 | N11 cerrada, consulta de N23 hecha con el aviso a los tenants que usan notas, y respuesta de SUR4 sobre la tienda |
| Merge de E4 | E4 | N9 y N12 cerradas |
| Merge de E5 | E5 | N3, N4, N5 y N8 cerradas |
| Conceder `order_sticky_notes` en Production | SUR4 | E5 y E6 en `main`, supresión probada en Staging y procedimiento de supresión escrito (N22) |
| Conceder order\_work\_sheet\_ficha | SUR4 | E5 en `main` y aplicada, visto bueno visual de SUR4 a las muestras A4 de E2, comparándolas con sur4-0134 (N14), y tu autorización expresa (N25) |
| Cualquier concesión | DEMO y SUR4 | Primero DEMO; después SUR4, con motivo, fecha de revisión y tu autorización expresa (N13) |
| Cierre | E11 | E10 en verde |

## 4. Funciones A1

| Código | Nombre en el catálogo | La registra | La usan | Sin concesión |
| --- | --- | --- | --- | --- |
| `order_custom_labels` | Etiquetas propias de la ficha | E5 | E2, E3 y E4 | Etiquetas actuales |
| `order_sticky_notes` | Post-its del pedido | E5 | E6 y la Hoja de trabajo | Notas como hoy, con «No se imprime» |
| `order_work_sequence` | Secuencia de trabajo | E7 | E8, E9 y la Hoja de trabajo | Nada nuevo en pantalla ni en papel |
| order\_work\_sheet\_ficha | Hoja de trabajo con el reparto de la ficha | E5 | E2, en la Hoja de trabajo | Perfil estándar: la Hoja de hoy sin notas internas |

- Cada migración inserta su fila en `public.features` con un id fijo, el siguiente libre de la serie `31000000-0000-4000-8000-0000000000NN` (hoy, desde `…011`), y `on conflict (code) do update`, como `quotes`. Ningún plan las incluye y no se crea ningún override: nacen apagadas.
- `tenant_has_feature` devuelve `false` para un código que no existe. Por eso E2 y E3 pueden salir antes que E5: el perfil ficha y los nombres de SUR4 aparecen cuando E5 registre las funciones y existan las concesiones. Hasta entonces, todos los tenants, también SUR4, imprimen el perfil estándar. El ficha llega implementado en E2, pero nada en la app lo activa sin la concesión.
- La app solo las lee en el servidor, con `tenantHasFeature`, y nunca se fía del cliente. `lib/orders/order-features.ts`, que nace en E2, exporta los cuatro códigos y `loadOrderFeatures(supabase, tenantId)`, que devuelve `{ customLabels, stickyNotes, workSequence, workSheetFicha }` con cuatro llamadas en paralelo.
- La base de datos también lo comprueba: las RPC y la RLS de las tablas nuevas exigen la función, como los presupuestos, y sin ella responden `not_found` a `authenticated`, sin excepciones. Solo el operador, con `service_role`, puede suprimir el texto de un post-it en un tenant al que se retiró la función (N22). Ninguna RPC ni ruta que ya existe cambia de firma, de respuestas ni de códigos HTTP.

## 5. Etiquetas

`lib/orders/labels.ts`, que nace en E2, exporta `orderLabels({ custom })`, y `custom` sale de `order_custom_labels`.

| Clave | Sin concesión | Con `order_custom_labels` |
| --- | --- | --- |
| `total` | Total del pedido | Total pedido |
| `paid` | Entregado a cuenta | A cuenta |
| `due` | Pendiente de cobro | Falta por abonar |
| `description` | Instrucciones | Descripción |

El Resguardo titula siempre el recuadro «Descripción del trabajo», si se aprueba N12. Los textos que hoy están en `components/orders/detail/order-collection.tsx` pasan a este módulo en E3, sin cambiar para nadie más (T10).

## 6. Impresión (E2 y E4)

| Pieza | Hoja de trabajo (E2) | Resguardo (E4) |
| --- | --- | --- |
| Ruta | `/orders/[id]/print`, la de hoy | `GET /api/orders/[id]/receipt` |
| Cargador | `loadWorkSheet(id)`, que sustituye a `loadOrderPrint` | `loadCustomerReceipt(id)`, propio |
| Perfil | workSheetProfile(features): standard por defecto, ficha con order\_work\_sheet\_ficha (N25) | Uno solo, para todos |
| Modelo | `WorkSheetModel` | `CustomerReceiptModel` |
| Consulta | `WORK_SHEET_SELECT` | `CUSTOMER_RECEIPT_SELECT` |
| Nunca lee | `orders.notes`, post-its internos o anulados, `clients.notes`, `external_folder_url` y detalle de cobros. El perfil ficha tampoco lista archivos; el estándar lista los de hoy, con justificantes y subidas pendientes | Lo mismo, más post-its, personal, estado, prioridad, nombres de archivos y estado de archivos |
| Respuesta | Página del navegador | `application/pdf` con `Cache-Control: private, no-store` y `Content-Disposition: inline; filename="Resguardo-<referencia>.pdf"` |
| Otro tenant | 404 | 404 |

- Perfiles (N25): un solo cargador, un solo `WorkSheetModel` con `profile: "standard" | "ficha"` y los mismos bloques; el perfil solo decide qué bloques salen y en qué orden. El estándar imprime lo mismo que `orderPrintModel` hoy (cliente, pedido, fechas, instrucciones, producción, cobro y entrega, y archivos, con justificantes y subidas pendientes), sin `notes`. El ficha es el de N19 y N20. E2 implementa los dos, y `workSheetProfile` devuelve `ficha` solo con `order_work_sheet_ficha`, sin parámetro de URL ni otro interruptor. Las muestras A4 del ficha para SUR4 salen de las pruebas, que renderizan el perfil con pedidos de prueba y lo imprimen a PDF.
- Ningún modelo tiene un campo para las notas. La Hoja solo sabe si el pedido las tiene: `hasLegacyNotes(supabase, tenantId, orderId)` lee `orders.notes` aparte, devuelve un booleano y descarta el texto. Con él, la vista de impresión muestra el aviso con una clase que lo oculta al imprimir (N23).
- Hoy `ORDER_PRINT_SELECT` pide `notes`, `client.notes` y `external_folder_url`, aunque no los imprima todos. Las consultas nuevas solo piden los campos de su lista cerrada (sección 4 del documento), y una prueba de código falla si alguna contiene `notes` o `external_folder_url`.
- Servicio, solo en el perfil ficha: `printableService(serviceName, descriptionHtml)` compara el nombre con `richTextToPlainText(description)`, los dos en minúsculas, sin tildes y con espacios simples, y lo imprime si no está dentro. El estándar lo imprime como hoy.
- Tienda, solo en el perfil ficha: `printableStore(storeName, activeStoreCount)` la imprime si el pedido tiene tienda y el tenant tiene más de una activa. El recuento sale de `stores` con `active = true`, sin traer filas. El estándar la imprime como hoy.
- Los nombres de los importes y de la descripción salen de `orderLabels` (sección 5).
- Los pasos y los post-its imprimibles solo salen con su función concedida y si hay datos, nunca como un título vacío.

## 7. Base de datos de los post-its (E5)

| Pieza | Contrato |
| --- | --- |
| `order_notes` | Las columnas de la sección 3, más `current_version_id`, `redacted_at` y `redacted_by` |
| `order_note_versions` | `id`, `tenant_id`, `note_id`, `version`, `body`, `created_at`, `created_by`, `redacted_at`, `redacted_by`. FK compuesta a `order_notes(tenant_id, id)`. `body` solo puede pasar a `null`, y solo con el marcador `gestcopy.order_notes_redact` |
| `order_note_events` | `id`, `tenant_id`, `order_id`, `note_id`, `action`, `actor_user_id`, `actor_name`, `created_at`, `before` y `after` en jsonb sin texto, `version_before_id`, `version_after_id` y `reason`. Solo inserción; la única escritura posterior es sustituir `reason` por «\[motivo suprimido\]» cuando la supresión lo señala |
| Acciones | `created`, `edited`, `printable_authorized`, `made_internal`, `pinned`, `unpinned`, `resolved`, `reopened`, `voided`, `converted_from_legacy` y `redacted` |
| RPC | `create_order_note_v1`, `update_order_note_v1`, `set_order_note_state_v1`, `convert_order_legacy_notes_v1` y `redact_order_note_v1`, con `SECURITY DEFINER`, `search_path ''` y respuesta `{ok, error}`. Solo `authenticated`; la supresión, también `service_role` |
| Errores | Los de la sección 3, más `no_legacy_notes` en *Pasar a post-it*, y `confirmation_required`, `invalid_reason_code` e `invalid_reason_target` en la supresión |
| RLS | `SELECT` con `is_tenant_member` y `tenant_has_feature(tenant_id, 'order_sticky_notes')`. Ninguna escritura directa |
| Guardianes | Marcador `gestcopy.order_notes_write` en las tres tablas, y `gestcopy.order_notes_redact` para vaciar textos y sustituir los motivos señalados. Los eventos rechazan `UPDATE` (salvo ese), `DELETE` y `TRUNCATE`. Solo se purgan al borrar el pedido, como `order_items` |
| Pasar a post-it | `convert_order_legacy_notes_v1(p_order_id, p_expected_row_version)`, para owner, admin, manager y staff. Bloquea el pedido con `FOR UPDATE`, exige su versión (`conflict` si cambió) y, en una sola transacción, crea la nota, su versión y su evento antes de vaciar `orders.notes`, con la marca de R5. Sube `orders.row_version` y registra `order.legacy_notes_converted` con el id de la nota, sin el texto. Cualquier error (`invalid_body`, `too_many_notes`, `order_archived`, `no_legacy_notes`) lo deshace todo: `orders.notes` nunca se vacía si la nota no se crea |
| Actividad | Una fila por evento en `activity_log`, sin texto ni motivos (T9) |
| Reversión | `supabase/rollbacks/<marca>_order_notes_v1.sql`, que solo deshace lo que crea la migración |
| Supresión (N22) | `redact_order_note_v1(p_note_id, p_reason_code, p_reason_event_ids, p_confirm)`: owner con la función concedida, o el operador con `service_role`. `p_reason_code` es `personal_data_request` o `personal_data_found`, sin texto libre. Vacía `body` en todas las versiones y conserva los motivos; cada evento de `p_reason_event_ids` pasa su `reason` a «\[motivo suprimido\]», y también `void_reason` si es el de la anulación. Conserva autoría, fechas y acciones, y añade `redacted` con el código y lo que vació, sin texto. Limitaciones del procedimiento escrito: los respaldos conservan el texto hasta caducar, y tras restaurar uno se repiten las supresiones anotadas en el registro de operaciones |

## 8. Base de datos de la secuencia (E7)

El diseño es el de la sección 2 y el de F1·01/02: `work_stages` y `order_work_steps`, con `executed_by_team_member_id` y `completed_by` (FK compuesta a `memberships`, `ON DELETE RESTRICT`), y las RPC `replace_order_work_steps_v1`, `set_order_work_step_done_v1` y la de fases de F1·01/02. Errores: `step_unassigned`, `member_unassignable` y `step_done`. El contrato solo añade dos cosas: la función `order_work_sequence` se comprueba igual que en E5, y la FK nueva hacia `team_members` entra en la revisión de pistas de E1.

## 9. Rutas (E6 y E8)

| Ruta | Método | RPC |
| --- | --- | --- |
| `/api/orders/[id]/notes` | GET, POST | Lectura con RLS y `create_order_note_v1` |
| `/api/orders/[id]/notes/[noteId]` | PATCH | `update_order_note_v1` |
| `/api/orders/[id]/notes/[noteId]/state` | POST | `set_order_note_state_v1` |
| `/api/orders/[id]/notes/[noteId]/redact` | POST | `redact_order_note_v1`, solo owner |
| `/api/orders/[id]/notes/convert-legacy` | POST | `convert_order_legacy_notes_v1` |
| `/api/orders/[id]/work-steps` | GET, PUT | Lectura con RLS y `replace_order_work_steps_v1` |
| `/api/orders/[id]/work-steps/[stepId]/done` | POST | `set_order_work_step_done_v1` |
| `/api/work-stages` | GET, POST, PATCH | La RPC de fases de F1·01/02 |

Errores en HTTP: `not_found` es 404; `forbidden`, 403; `conflict`, `order_archived` y `step_done`, 409; el resto de errores de validación, 422; sin sesión, 401 (T6). El tenant sale siempre de la sesión, nunca del cuerpo de la petición.

## 10. Pruebas y nombres

- Suites SQL con el siguiente número libre al abrir cada rama (hoy, desde `phase60`): `order_notes_v1`, `order_notes_concurrency` (`.sh`), `order_work_sequence_v1`, `order_work_sequence_concurrency` (`.sh`) y `order_features_isolation`, con T1–T11.
- Textos testigo: `TESTIGO-NOTAS-PEDIDO`, `TESTIGO-NOTAS-CLIENTE`, `TESTIGO-POSTIT-INTERNO`, `TESTIGO-POSTIT-ANULADO`, `TESTIGO-POSTIT-SUPRIMIDO`, `TESTIGO-DRIVE`, `TESTIGO-COBRO` y `TESTIGO-IMPRIMIBLE`. Solo el último puede aparecer impreso, y solo en la Hoja de trabajo desde E6.
- Perfil estándar: una prueba compara su modelo con el `orderPrintModel` de hoy sobre el mismo pedido, con justificantes y subidas pendientes, y solo admite como diferencia `notes`.
- Perfil ficha: con pedidos de prueba que reproducen sur4-0134, las pruebas generan muestras A4 en PDF para el visto bueno de SUR4. Otra prueba comprueba que `workSheetProfile` devuelve `standard` sin la concesión, para cualquier tenant y cualquier parámetro de la petición.
- Supresión: sin motivos señalados, `void_reason` y los `reason` no cambian; con uno señalado, solo ese pasa a «\[motivo suprimido\]»; un evento de otra nota da `invalid_reason_target`; repetirla con otro motivo solo cambia ese, y sin nada nuevo no escribe.
- Supresión repetida y selectiva: una nota con tres motivos, dos con textos testigo, se suprime dos veces, señalando uno distinto cada vez. Solo cambian los señalados, el tercero queda intacto, y hay dos eventos `redacted` con cuenta, fecha y acción. Una consulta recorre `order_note_versions`, `order_note_events`, `order_notes` y `activity_log`, y no encuentra ningún texto testigo.
- *Pasar a post-it*: con fallos forzados en la creación (texto demasiado largo y 200 notas), `orders.notes` y `orders.row_version` no cambian.
- E2E en Staging, con el reconocimiento de presupuestos de #149.

## 11. Matriz de integración (E10)

| Tenant de prueba en Staging | `order_custom_labels` y `order_work_sheet_ficha` | `order_sticky_notes` | `order_work_sequence` | Qué comprueba |
| --- | --- | --- | --- | --- |
| Base | No | No | No | Lo que verá cualquier tenant tras E2–E4, con la Hoja del perfil estándar |
| Solo post-its | No | Sí | No | Post-its sin secuencia; Hoja con notas imprimibles y sin pasos |
| Solo secuencia | No | No | Sí | Pasos sin post-its; listas y panel |
| SUR4 de prueba, con dos tiendas activas | Sí | Sí | Sí | Todo junto, con los nombres de SUR4 y la Hoja del perfil ficha |

En cada tenant se recorren estos pedidos: sin nada; con notas heredadas; con y sin tienda, en un tenant de una tienda y en otro de dos; con el servicio dentro y fuera de la descripción; con pasos hechos, pendientes y sin asignar; con post-its internos, imprimibles, anulados y suprimidos, con y sin motivos señalados; y archivado. Además se retira y se vuelve a conceder cada función con datos dentro, y se crean un pedido de kiosco y una conversión de presupuesto.

## 12. Qué no hace E0

E0 se cerró en el documento el 27/10 y es solo documental: no abre rama, no crea código ni migraciones, no cambia nada en pantalla ni concede funciones. Tampoco consulta Production: la consulta de N23 forma parte de E2 y necesita su propia autorización. No toca las ramas, PR, migraciones ni despliegues de F7–F12. Su cierre no autoriza E1–E11: cada rama, commit, migración, merge y despliegue necesita tu autorización.
