# ADR SUR4-01 — Ficha de pedido, post-its y secuencia de trabajo

Fecha: 27 de octubre de 2026. Estado: **aceptado; E0 cerrado documentalmente el 27/10**. Se aprobaron D1–D17 como orientación funcional, con cambios en D5, D6 y D14, y 18 decisiones: N1, N2, N6, N7, N10 y N13–N25, N18 con seis condiciones, N20 con ajustes y N22–N24 con condiciones. N25 limita la Hoja de trabajo nueva a los tenants con concesión y ajusta N13, N19 y N20, y N15 fija la puerta de merge. N3–N5, N8, N9, N11 y N12 se cierran por entrega. Las seis contradicciones con lo aprobado se cerraron el 27/10, con un ajuste de N22 sobre los motivos (sección 8 del documento). El cierre no autoriza E1–E11, ramas, commits, migraciones, merges ni despliegues. Siguen pendientes la auditoría de N23, con su propia autorización, y la confirmación de SUR4 sobre la tienda, las dos antes del merge de E2. No hay rama, archivo en el repositorio, migración ni despliegue.

## Contexto

- SUR4 pide tres cosas: varios trabajadores por pedido en secuencia, post-its con autoría y estados, y una ficha y un A4 reorganizados.
- Hoy `orders.notes` es un único bloque sin autor. La impresión actual lo muestra como «Notas internas», y arrastra notas internas de presupuestos y datos de contacto del kiosco.
- Los importes (`order_collection_v1`) están en *Cobro y entrega*, lejos de la cabecera.
- R5 (`tg_orders_write_guard`) y R6 (`team_member_is_assignable`) cambian cómo se escribe en pedidos. A1 permite conceder funciones por tenant y ya está en Production.

## Decisiones aprobadas el 27/10

1. **Responsable principal y secuencia (N1, D1–D17).** Un responsable principal por pedido (`orders.assigned_team_member_id`, *Responsable* en pantalla) y una secuencia opcional de trabajadores. D1–D17 quedan aprobadas como orientación funcional.
2. **Quién marca un paso (D5).** Cualquier rol operativo puede marcar como hecho el paso de otra persona. El paso guarda por separado a quién estaba asignado, qué trabajador lo hizo (`executed_by_team_member_id`), qué cuenta autenticada lo marcó (`completed_by`) y cuándo. Desactivar al trabajador o la cuenta no cambia ni borra nada de eso.
3. **Personas inactivas (D6).** Las asignaciones históricas se conservan. Un paso pendiente de una persona inactiva muestra un aviso y la opción *Reasignar*, y no se marca como hecho hasta reasignarlo.
4. **Pasos sin asignar (D14).** Un paso pendiente puede quedar sin persona, pero no se puede marcar como hecho sin una persona elegible asignada.
5. **Visibilidad de los post-its (N2).** Dos niveles: interno, por defecto, e imprimible. Marcar uno como imprimible pide confirmar el texto completo y avisa si lleva un email o un teléfono. El Resguardo del cliente nunca incluye notas ni post-its.
6. **Notas heredadas (N6 y N7).** `orders.notes` no se imprime en ningún documento; solo se imprime lo que se pase a post-it imprimible. En la V1, el kiosco y la conversión de presupuestos siguen escribiendo en `orders.notes`.
7. **Impresión de notas (N18).** Los tenants sin post-its no imprimen notas en la V1. E2 deja de imprimir `orders.notes` en todos los documentos sin depender de E5. La Hoja de trabajo solo incorpora post-its marcados expresamente como imprimibles, y el Resguardo nunca incluye notas ni post-its. Toda autorización o cambio de la visibilidad imprimible queda registrado con usuario y fecha.
8. **Activación (N13, ajustada por N25).** Secuencia y post-its, piloto solo para SUR4 por concesión A1 (`order_work_sequence` y `order_sticky_notes`). La ficha reorganizada es para todos, con las etiquetas y funciones de SUR4 aisladas por concesión A1; la Hoja de trabajo nueva, solo con `order_work_sheet_ficha`. No se activa nada sin una autorización aparte.
9. **Referencia visual (N14).** La ficha real del pedido sur4-0134, «Encuadernaciones Magerit», recibida el 27/10. Sustituye a la *Hoja de producción* del 30/09, y los dibujos de la ficha y de los A4 ya la siguen.
10. **Jerarquía de la cabecera.** La ficha abre con pedido y cliente, estado, prioridad, los tres importes y la fecha de entrega, visibles sin desplazar, con el reparto de sur4-0134: pedido y cliente a la izquierda, importes y entrega a la derecha. La Hoja del perfil ficha sigue el mismo reparto, pero con la prioridad en la fila de abajo y sin estado (N19).
11. **Nombres de los importes (N16).** *Total pedido*, *A cuenta* y *Falta por abonar* solo para SUR4, con la concesión A1 `order_custom_labels` (renombrada por N21). Extenderlos a otros tenants exige otra decisión.
12. **Cabecera del Resguardo (N17).** Los mismos datos e importes que la ficha, sin estado ni prioridad.
13. **Dos documentos, dos listas cerradas.** La Hoja de trabajo es interna y el Resguardo es para el cliente. Cada uno imprime solo los campos de su perfil, y la Hoja tiene dos (N25).
14. **Hoja de trabajo como sur4-0134 (N19, perfil ficha).** Pedido y cliente a la izquierda; importes, entrega y prueba a la derecha; descripción en un recuadro grande; responsable, y una fila de abajo con archivos, prioridad, recepción y presupuesto. No imprime el estado.
15. **Campos de la Hoja de trabajo (N20, con ajustes, perfil ficha).** No imprime canal, contexto, terminado, entregado ni la lista de archivos; terminado y entregado siguen en la ficha. Imprime el estado de archivos, el servicio solo si su nombre no aparece en la descripción, y los pasos y los post-its imprimibles solo si los hay. La tienda se imprime junto a la referencia cuando el pedido la tiene y el tenant tiene más de una activa, si SUR4 lo confirma.
16. **Etiquetas de SUR4 (N21).** «Descripción» en la ficha y en la Hoja, solo en SUR4. La concesión se llama `order_custom_labels` y agrupa las etiquetas de la ficha y los importes. Los textos de los demás tenants no cambian.
17. **Datos de la prueba (N10).** *Requiere prueba*, *Fecha de envío prueba* y *Fecha prueba* son espacios en blanco del A4, para rellenar a mano. No hay columnas ni migraciones hasta que SUR4 defina qué significa cada fecha.
18. **Supresión del texto de un post-it (N22, ajustada el 27/10).** El texto vive en `order_note_versions`, y `order_note_events` no lo copia. `redact_order_note_v1`, para owner con la función concedida o para el operador con `service_role`, vacía el texto de todas las versiones y conserva la autoría, las fechas y las acciones. Los motivos de anulación y de auditoría se conservan: solo los que el owner señala por contener un dato personal pasan a «\[motivo suprimido\]», y el motivo de la propia supresión sale de una lista cerrada, sin texto libre. El procedimiento escrito recoge que los respaldos conservan el texto hasta caducar. `order_sticky_notes` no se concede en Production hasta probar la supresión en Staging.
19. **Salvaguardas de E2 (N23).** Antes del merge, una consulta de solo lectura cuenta por tenant los pedidos con notas; esos tenants reciben aviso, Novedades sale con E2 y la vista de impresión avisa solo en pantalla. Las pruebas de textos testigo garantizan que ninguna impresión saca las notas heredadas.
20. **Integración y cierre (N24).** E10 prueba juntas la ficha, los documentos, los post-its y la secuencia, con y sin funciones opcionales; E11 es el cierre.
21. **Perfiles de la Hoja de trabajo (N25).** Un solo núcleo con dos perfiles cerrados. El estándar, para todos, imprime lo de hoy, también los justificantes y las subidas pendientes, sin «Notas internas»: E2 solo quita `orders.notes` y lo que N6 y N18 prohíben, y no retira otro campo sin autorización. El ficha (N19 y N20) solo se ve con `order_work_sheet_ficha`, que registra la migración de E5. E2 implementa los dos perfiles sin activar el ficha; SUR4 lo valida antes con muestras de las pruebas, y se activa después de E5.
22. **Ficha y Resguardo para todos (27/10).** El rediseño de la ficha es para todos los tenants, con las etiquetas y funciones de SUR4 aisladas por concesión A1. El Resguardo es un documento adicional para todos: no sustituye la impresión actual y nunca incluye notas internas ni post-its.
23. **Puerta de merge (N15).** Nada se fusiona hasta cerrar F12 y fusionar #146. Aprobada el 27/10, al cerrar E0 en el documento.

## Decisiones pendientes

- N3–N5, N8, N9, N11 y N12, que se cierran antes de la entrega que las usa (tabla de la sección 8).
- Confirmar con SUR4 si la Hoja de trabajo debe mostrar la tienda (N20), antes del merge de E2. Lo que significa cada fecha de prueba (N10) no bloquea ninguna entrega.
- Auditoría de N23 antes del merge de E2, con su propia autorización: una consulta de solo lectura por tenant en Production, que todavía no se ha hecho.

## Decisión técnica

- **Post-its:** tablas `order_notes`, `order_note_versions`, con el texto de cada versión, y `order_note_events`, de solo inserción y sin texto. Se leen con RLS (`is_tenant_member` y la función `order_sticky_notes`) y se escriben solo con `create_order_note_v1`, `update_order_note_v1`, `set_order_note_state_v1`, `convert_order_legacy_notes_v1` (*Pasar a post-it*) y `redact_order_note_v1` (`SECURITY DEFINER`, `search_path ''`, marca `gestcopy.order_notes_write`). Sin la función, todas responden `not_found` a `authenticated`; solo el operador, con `service_role`, puede suprimir en un tenant sin ella. *Pasar a post-it* exige la versión del pedido y crea la nota antes de vaciar `orders.notes`, en una sola transacción: si algo falla, no cambia nada. Crear o pasar una nota a imprimible, o editar el texto de una imprimible, exige `p_confirm_printable`. `printable_authorized_by` y `printable_authorized_at` guardan quién lo autorizó y cuándo, un `CHECK` los exige en las imprimibles y `order_note_events` guarda cada autorización, edición y vuelta a interna.
- **Secuencia:** `work_stages` y `order_work_steps`, como en F1·01/02, con tres cambios: `team_member_id` es opcional mientras el paso está pendiente, `executed_by_team_member_id` guarda qué trabajador lo hizo y un `CHECK` exige persona asignada, trabajador, fecha y cuenta en todo paso hecho. `completed_by` es la cuenta autenticada, con clave foránea compuesta a `memberships` y `ON DELETE RESTRICT`, como `orders.created_by`; las claves hacia `team_members` no tienen cascada. La elegibilidad la decide `team_member_is_assignable` de R6, solo cuando una persona entra o cambia. Las RPC bloquean el pedido con `FOR UPDATE` y a las personas con `FOR SHARE`, rechazan `step_unassigned`, `member_unassignable` y `step_done`, y ponen la marca de R5.
- **Impresión:** el Resguardo y los dos perfiles de la Hoja (N25) tienen su lista cerrada de campos, con un cargador y un modelo por documento (`loadWorkSheet` y `loadCustomerReceipt`, contrato E0), y pruebas de textos testigo. `workSheetProfile` elige `standard` o `ficha` según `order_work_sheet_ficha`; el perfil solo decide qué bloques salen y en qué orden. E2 implementa los dos y no activa el ficha en ningún tenant: sus pruebas generan muestras A4 para que SUR4 lo valide, sin ningún interruptor en la app. Ningún modelo tiene campo para `orders.notes`, desde E2 y sin depender de E5: la Hoja solo sabe si el pedido tiene notas, para avisarlo en pantalla (N23), y el cargador del Resguardo no lee notas ni post-its. En el perfil ficha, el servicio sale solo si su nombre no aparece en el texto plano de la descripción, y la tienda solo si el pedido la tiene y el tenant tiene más de una tienda activa. La Hoja de trabajo se imprime en el navegador. El Resguardo es un PDF de servidor con `@react-pdf/renderer`, no se guarda en R2 y se sirve con `Cache-Control: private, no-store`.
- **Ficha:** la cabecera lee los importes de `order_collection_v1`, como hoy, y no cambia quién los ve (N11). Los nombres de los importes y «Descripción» dependen de `order_custom_labels`: la migración de E5 añade la función al catálogo y, mientras no exista o no esté concedida, se ven los nombres actuales.
- **E0:** solo documentos, el ADR y el contrato; se cerró en el documento el 27/10, sin rama. `lib/orders/order-features.ts` y `lib/orders/labels.ts` nacen en E2, su primer consumidor, y E3 los reutiliza.

## Invariantes

- El Resguardo nunca contiene notas, post-its, nombres del personal, estado, prioridad, enlaces privados ni justificantes.
- Ninguna impresión contiene `orders.notes` ni post-its internos o anulados. Solo se imprime lo marcado expresamente como imprimible y confirmado.
- Ninguna nota es imprimible sin la cuenta y la fecha de su autorización, y cada autorización o cambio queda en `order_note_events`.
- Ningún evento ni fila de actividad copia el texto de un post-it. El texto solo vive en `order_notes` y `order_note_versions`, y solo `redact_order_note_v1` puede vaciarlo, sin tocar la autoría, las fechas ni las acciones. Los motivos se conservan, salvo los que la supresión señala por contener un dato personal, que pasan a «\[motivo suprimido\]».
- Una supresión repetida solo cambia los motivos que señala, y cada una deja su propio evento con la cuenta, la fecha y la acción. Ningún texto suprimido queda en las versiones, los eventos ni la actividad.
- La Hoja de un tenant sin `order_work_sheet_ficha` imprime lo mismo que hoy, incluidos los justificantes y las subidas pendientes, salvo las notas internas.
- Sin la concesión, las RPC nuevas responden `not_found` y la RLS de las tablas nuevas no devuelve filas. Ninguna RPC ni ruta que ya existe cambia de firma ni de respuestas.
- Ningún paso hecho queda sin persona asignada ni persona que lo hizo, y su asignación ya no cambia.
- Los pasos hechos conservan asignación, trabajador, cuenta y hora aunque esas personas o esa cuenta se desactiven. `team_members` y `memberships` no se borran mientras tengan historial.
- Los nombres de los importes y «Descripción» solo cambian en los tenants con la concesión `order_custom_labels`.
- No hay columnas ni migraciones para los datos de la prueba hasta que SUR4 defina qué significa cada fecha.
- Ningún dato de un tenant aparece en otro: el tenant sale del slug, las tablas nuevas solo admiten lectura por RLS y las RPC comprueban la pertenencia.
- Los post-its no suben `orders.row_version`; los cambios de secuencia sí.
- Las migraciones nuevas van después de `20261022130000` (R6). Cada una necesita su propia autorización en Staging y en Production.
- Nada de esto toca las ramas, PR, migraciones ni despliegues de F7–F12.

## Consecuencias

- Los pedidos actuales no se migran. En los tenants con post-its, `orders.notes` queda como «Notas anteriores», de solo lectura.
- Ningún tenant imprime ya las notas del pedido, desde E2. Quien las necesite en papel las pasa a un post-it imprimible; los tenants sin post-its no tienen esa opción en la V1 (N18). Entre E2 y E6 tampoco SUR4 imprime notas.
- Los demás tenants mantienen su Hoja de trabajo, el perfil estándar: solo deja de imprimirse «Notas internas», y todo lo demás sale como hoy. SUR4 valida su Hoja en E2 con muestras de las pruebas (N14), y la usa cuando E5 registra `order_work_sheet_ficha` y se le concede.
- Un motivo con un dato personal solo se suprime si el owner lo señala. El detector de N2 avisa al escribirlo y al suprimir, pero no decide, y la supresión se puede repetir para señalar otro motivo más tarde.
- El plan pasa a 12 entregas: E10 prueba juntas las cuatro líneas y E11 cierra (N24). E3 depende de E2, que trae los módulos de funciones y etiquetas.
- El contacto del kiosco y las notas internas de los presupuestos convertidos dejan de salir en papel sin tocar esas funciones.
- Los demás tenants mantienen «Total del pedido», «Entregado a cuenta», «Pendiente de cobro» e «Instrucciones».
- `order_work_steps` lleva una FK más hacia `team_members` (`executed_by_team_member_id`), que E1 tiene en cuenta en las pistas de PostgREST.
- Una cuenta o un trabajador con pasos hechos no se puede borrar, solo desactivar.
- Los datos de la prueba que pide sur4-0134 no existen en Gestcopy. La Hoja de trabajo los deja en blanco para rellenar a mano (N10); guardarlos será una entrega propia, con migración, cuando SUR4 defina qué significa cada fecha.

## Paso al repositorio

E0 se cerró en el documento el 27/10, sin rama. Este ADR se copiará a `docs/adr/2026-10-27-sur4-ficha-postits-secuencia.md` en la primera rama que autorices, sin cambiar su contenido, junto con el contrato de Contrato E0 (`docs/SUR4-FICHA-POSTITS-CONTRATO.md`), con tu autorización. Hoy esos archivos no existen.
