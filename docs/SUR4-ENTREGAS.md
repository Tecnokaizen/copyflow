# SUR4 — Registro de entregas E0–E11

Post-its, secuencia de trabajo (multirresponsabilidad), ficha y documentos A4.
Fuente de verdad: [ADR SUR4-01](adr/2026-10-27-sur4-ficha-postits-secuencia.md) y
[contrato técnico E0](SUR4-FICHA-POSTITS-CONTRATO.md). Este registro solo anota
estado y evidencias; si algo contradice al ADR o al contrato, mandan ellos,
salvo las enmiendas del propietario anotadas aquí (sección «Enmienda de
gobernanza»), que prevalecen.

## Enmienda de gobernanza (29/10/2026, propietario)

Corrección definitiva del propietario. Prevalece sobre el ADR (§23, N14, N15)
y el contrato en lo que diga de aceptaciones de SUR4:

- La aceptación de Tamara/SUR4 deja de ser condición de aprobación o de
  publicación de #146, #160 y de cualquier otra función.
- El propietario del producto hace la validación funcional en DEMO/Staging,
  decide las reglas de negocio (tienda en la Hoja, N10, N11, recomendaciones
  pendientes) y autoriza los despliegues.
- SUR4 puede probar el producto (pruebas reales a partir del viernes 30/10) y
  proponer mejoras después; su aceptación no bloquea ninguna entrega.
- Se mantienen todas las dependencias técnicas y los controles de seguridad:
  #146 entra en `main` antes que esta rama (la contiene), CI en verde, copia
  restaurable, migraciones verificadas una a una, rollback preparado y
  autorización expresa del propietario para cada merge, migración o
  despliegue en Production.
- Stripe Live y la suscripción comercial siguen en paralelo; el SMTP y la
  ronda C no bloquean las mejoras operativas.

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
| E2 · Impresión segura | Hecha en local | `b28bd2e` | La Hoja no lee ni imprime `orders.notes` en ningún tenant (select cerrado `WORK_SHEET_SELECT`); aviso solo en pantalla si el pedido tiene notas. Perfil `standard` = HTML de hoy menos la sección de notas (prueba de igualdad); perfil `ficha` solo con `order_work_sheet_ficha`, decidido en el servidor. Cinco muestras A4 de sur4-0134 caben en una hoja. En local con textos testigo: la Hoja ficha de `sur4lab` saca solo los post-its imprimibles; no salen notas, post-its internos, Drive ni notas del cliente; `baselab` imprime lo de hoy sin notas. `lib/print` 58/58. El E2E de Staging de formato de texto comprueba que las notas ya no salen | N15 (técnica), auditoría N23 (lectura en Production, con autorización). Tienda y N11: decide el propietario (enmienda 29/10) |
| E3 · Ficha reorganizada | Hecha en local | `9b37118` | Cabecera con pedido y cliente a la izquierda e importes y entrega a la derecha, para todos los tenants; etiquetas de SUR4 solo con `order_custom_labels` (en `baselab` siguen «Total del pedido», «Entregado a cuenta», «Pendiente de cobro» e «Instrucciones»). Dos columnas desde `lg`, una en móvil. Textos de historial de post-its y pasos sin texto de notas (T9). Comprobado en el navegador a 390 px y escritorio | N15 |
| E4 · Resguardo PDF | Hecha en local | `b28bd2e` | `GET /api/orders/[id]/receipt`: PDF de servidor, `private, no-store`, sin R2; 404 para otro tenant. Texto extraído del PDF real en local: cliente, importes, fechas, tienda y descripción; ningún texto testigo de notas o post-its, sin estado ni prioridad (N17) | N15, N9, N12 |
| E5 · Post-its: base de datos | Hecha en local | `ca03c4e` | Migración `20261028120000_order_notes_v1.sql`: tablas `order_notes`, `order_note_versions` y `order_note_events` (historial solo de añadir), funciones `order_sticky_notes`, `order_custom_labels` y `order_work_sheet_ficha` apagadas por defecto, RLS de lectura por miembro y función activa, escritura solo por RPC. Base local aislada desde cero: invariantes del release gate PASS, `phase61_order_notes_v1.sql` PASS (roles, tres tenants, función apagada y retirada, impresión con autorización, N4/N5, «Pasar a post-it», historial, purga y supresión T11/T12), `phase61_order_notes_concurrency.sh` PASS (C4, C5, C6, C7, C9, sesiones nuevas, baja de tenant). Rollback `supabase/rollbacks/20261028120000_order_notes_v1.sql` probado (quitar y volver a aplicar). Ambas suites añadidas al CI | N15, N3, N4, N5, N8 |
| E6 · Post-its: API y ficha | Hecha en local | `01170c8` | Rutas de notas con 404 sin la función y para otro tenant; 40 pruebas HTTP y de reglas. En el navegador (`sur4lab`): «+ Añadir nota» abre el compositor, aviso de teléfono, confirmación de imprimible, «Pasar a post-it» y cambio de estado posterior sin conflicto; historial con `order.note_created`, `order.note_printable_authorized` y `order.legacy_notes_converted`. `baselab` mantiene «Notas internas» | N15, N3, N4, N5, N8 |
| E7 · Secuencia: base de datos | Hecha en local | `99207b4` | Migración `20261028130000_order_work_sequence_v1.sql`: `work_stages` (catálogo por tenant, sin semilla, nunca se borra) y `order_work_steps` (1–10 pasos, persona opcional mientras está pendiente, ejecutor, cuenta que marca, «Le toca» calculado). Función `order_work_sequence` apagada por defecto. RPC `replace_order_work_steps_v1`, `set_order_work_step_done_v1`, `team_work_load_v1`, `upsert_work_stage_v1` y `create_suggested_work_stages_v1`. `phase62_order_work_sequence_v1.sql` PASS (D5, D6, D14, D15, R6, tenants, roles, escritura directa, archivado, carga sin duplicar, retirada y vuelta de la función, purga), `phase62_order_work_sequence_concurrency.sh` PASS (C1, C2/C11, C3, C4, C8, C12, C13, C14, sesiones nuevas, TRUNCATE, baja de tenant), `phase63_order_features_isolation.sql` PASS (matriz de cuatro tenants, T1, T2, T4, T9, T10). Rollback probado: se niega con datos, quita concesiones y se vuelve a aplicar. Las 45 suites de la base del release gate PASS en local con E5 y E7 | N15 |
| E8 · Secuencia: API, Configuración y ficha | Hecha en local | `ac83417` | Rutas de pasos y fases con 404 sin la función; 51 pruebas. En el navegador: marcar un paso con ejecutor, «Paso hecho: Preparación, por Raquel» en el historial, cambio de estado posterior sin conflicto, editor con pasos hechos bloqueados, lista vertical a 390 px, Configuración › Fases de trabajo | N15 |
| E9 · Secuencia: listas y panel | Hecha en local | `df7856d` | Indicador «Le toca» y filtros «Le toca a» y «Participa» en Pedidos; grupos de Mis pedidos; Mostrador; «Le toca ahora» en el panel. Sin la función o sin fases activas, respuestas iguales a HEAD (13 peticiones comparadas). Recuento sin duplicar comprobado en PostgREST y SQL. En el navegador con `sur4lab` | N15 |
| E10 · Integración | Preparada | `9e612ef` | E2E de DEMO de los cuatro tenants `e2e-sur4-*` (`seed-sur4.ts`, `sur4-features.ts`): PASS en local el 28/10 con la matriz, post-its y secuencia desde la ficha, Hoja, resguardo, retirada y vuelta de funciones, `viewer` y aislamiento. Ensayo de fusión con `97fbc59` hecho. Candidato `496bf6b` (29/10). Falta la ventana de Staging | OK del propietario a la ventana (CI del candidato en verde y hosts `e2e-sur4-*` dados de alta el 29/10; la ronda C ya no bloquea: cambio de puerta del 29/10) |
| E11 · Ayuda y cierre | Ayuda hecha | — | Cuatro artículos nuevos (post-its, secuencia, fases, Hoja y resguardo) con los nombres finales de los botones; `crear-pedido` ya no dice que las notas se imprimen. Pruebas de ayuda 27/27. Novedades, con la fecha del merge | E10 |

N15 = F12 cerrada (hecho, 28/10) y #146 fusionada en `main` antes que
cualquier PR de esta rama. Desde la enmienda del 29/10 es solo una dependencia
técnica: #146 está aceptada funcionalmente por el propietario y no espera a
Tamara.

**Orden de merge.** Esta rama contiene #146 (merge `c123e80`, ocho commits
con el mismo contenido). Fusionarla en `main` publicaría también #146. Por eso
#146 entra en `main` primero, con su propia autorización, y después las PR de
esta rama (plan en `docs/SUR4-PLAN-PUBLICACION.md`). El lote #149 → #139 → #156 llegó a
`main` (`25f6460`, Production `dpl_HLW3tQt1…`, 28/10 21:16Z) y se fusionó
aquí en `aaf9ba8`. Único conflicto, el previsto: `order-header.tsx`, con la
prop `currentStatusName` de #156 en `<OrderQuickActions>`. Novedades: una
release por día en `lib/help/changelog.ts`; la entrada de esta rama irá dentro
del bloque del día del merge (el 28/10 ya tiene «Búsquedas y estados de
pedido»).

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
| E7 | Las RPC ponen `app.order_write` y entran en `phase58_order_rpc_integrity` | No la mencionan; sus pruebas están en `phase62` | Invariante 7c del release gate, como en E5 |
| E7 | Errores de F1·01/02 | `member_unavailable` pasa a `member_unassignable` (contrato). Más `invalid_action` en marcar, y `invalid_name`, `invalid_icon`, `invalid_sort_order`, `duplicate_name` y `too_many_stages` en fases | Entradas mal formadas no deben caer en un 500 |
| E7 | RPC de fases sin definir en F1·01/02 | `upsert_work_stage_v1` (alta y cambio, incluida la desactivación) y `create_suggested_work_stages_v1` (*Crear fases sugeridas*, idempotente). Máximo 30 fases por tenant | El contrato pide una RPC de fases; F1 solo describía la RLS de catálogo |
| E7 | — | Las fases y los pasos tampoco se leen con `service_role` (solo `authenticated`, con RLS) | Mismo patrón que las líneas de pedido; ninguna ruta de servidor los lee con la clave de servicio |
| E7 | — | `team_work_load_v1` también devuelve `current_unassigned` y `current_unavailable` (turnos sin persona o con persona no elegible) | Para el filtro *Pasos sin asignar* y el aviso de D6 sin otra consulta |
| E7 | Paso hecho: ejecutor «Lo hice yo» u otra persona elegible | El ejecutor debe cumplir R6 (activa y puede recibir pedidos), como la persona asignada | Una sola regla de elegibilidad (ajuste 2) |
| E5/E7 | Pruebas «desde phase60» (contrato, §pruebas) | `phase61` (post-its), `phase62` (secuencia) y `phase63` (aislamiento) | `phase60_commercial_plans_pro.sql` ya existe en `gestcopy-staging` (plan Pro, sesión de Stripe). Renumeradas el 28/10 para no chocar al integrar; las cinco suites vuelven a pasar en local con el nombre nuevo |
| E2/E4 | Entregas separadas | Un solo commit | Una prueba de la Hoja importa el select del Resguardo |
| E4 | `loadCustomerReceipt(id)` | Recibe también el cliente y el tenant ya comprobados por la ruta | Evita autenticar dos veces |
| E4 | — | El Resguardo imprime el servicio con la misma regla que la Hoja (solo si no está en la descripción) | Misma regla en los dos documentos |
| E6 | Rutas del contrato | Más `GET .../notes/[noteId]` (historial y versiones) | Lo necesita el diálogo de historial |
| E6 | — | Texto plano escapado a `<p>`; vacío o solo script → 422 `invalid_body`; versión mal formada → 422 `invalid_version` | Entradas mal formadas no deben caer en un 500 |
| E6 | — | «Pasar a post-it» desactivado mientras se edita el pedido | Si no, guardar el borrador volvería a escribir las notas |
| E8 | — | Más 422 `invalid_body`, `invalid_version`, `invalid_executor`, `invalid_active` | Entradas mal formadas no deben caer en un 500 |
| E8 | — | La página de fases se puede leer por cualquier miembro con la función; el enlace de Configuración solo lo ven owner, admin y manager | El índice de Configuración ya era solo de gestión |
| E9 | «Me toca» | En Mis pedidos y el filtro «Mis pedidos» del Mostrador cae en el responsable si no hay secuencia o ha terminado; el filtro «Le toca a» y el panel solo cuentan el paso actual | F1 §3 y la aceptación; el panel sigue a `team_work_load_v1` |
| E9 | Función concedida | Función y al menos una fase activa | Un tenant con la función y sin fases ve lo de hoy |

## Correcciones de CI (28/10)

Dos checks fallaron en la PR #160 (`a4ad811`). Ninguno se resolvió
desactivando una garantía.

| Check | Causa | Corrección | Evidencia |
| --- | --- | --- | --- |
| Kiosk Database · `phase62_order_work_sequence_concurrency.sh`, C4 «a mark after archived_at» | Falso fallo de la prueba. El marcado y `archive_order` bloquean la fila del pedido antes de mirar `archived_at`, así que nunca se acepta una marca después del archivo. Pero las dos guardan `now()`, la hora de inicio de la transacción: un archivo que empieza antes y consigue el bloqueo después queda con una hora anterior a marcas que fueron antes. En `ef31ee1` pasó y en `a4ad811` (solo documentación) falló | C4 deja de comparar horas y comprueba el orden de bloqueo con `orders.row_version` (sube uno en cada escritura, con el bloqueo tomado): una versión por marca aceptada, versiones seguidas, el archivo la última escritura, un evento de actividad por marca y el pedido archivado. Es más estricta que antes. C6 de los post-its no tiene el problema: sus eventos usan `clock_timestamp()` al insertar | Reproducido en local 5/5 con el archivo esperando 0,3 s tras empezar (criterio de horas falla, `row_version` correcto). C4 nueva PASS 6/6, también con ese retraso. Mutante sin la comprobación de `archived_at`: C4 falla 3/3; función restaurada con el mismo md5 |
| Backup recovery (B1.3) · `public.constraints_md5` | Una sola restricción: `work_stages.work_stages_name_length` (E7). `char_length(name) between 1 and 40 and name = btrim(name)` se guarda como un AND anidado, porque `BETWEEN` se convierte en AND al analizarse; `pg_dump` lo escribe con paréntesis y al restaurar se lee aplanado. Misma regla, otro texto, otro md5 | La restricción se escribe sin `BETWEEN` (`>= 1 and <= 40 and …`), que se lee igual antes y después. Se corrige en la propia `20261028130000`, que solo está aplicada en bases locales (ni Staging ni Production). El resto de `BETWEEN` de E5/E7 van solos o dentro de un OR y no cambian | Simulacro B1.3 en local: antes falla con los mismos md5 que el CI (`42a1b238…` / `8c4e1c01…`) y el diff de restricciones origen/restaurado da solo esa línea; después 9/9 y `RECOVERY_TEST_SUCCESS`. La definición nueva se relee idéntica; la antigua no. Guardia de migraciones PASS (dos migraciones nuevas, ninguna aplicada modificada) |

## Orden de migraciones

`20261028120000` (E5) y la de E7 van detrás de `20261028090000` (plan Pro),
aplicada en Staging pero no en Production. En Staging el orden es natural. En
Production, si E5/E7 llegan antes que el plan Pro, la migración del plan Pro
quedaría por detrás de la última aplicada y `supabase db push` pediría
`--include-all`. El orden se acuerda con la sesión de Stripe en la PR de
Production, no aquí.

## Datos que no dependen del código

- Tienda en la Hoja: decide el propietario (enmienda 29/10). Mientras no diga
  otra cosa, se queda su regla del 27/10: solo si el pedido tiene tienda y el
  tenant tiene más de una activa. Ya no se espera respuesta de SUR4.
- Auditoría N23 en Production, con su propia autorización (antes del merge de E2).
- ~~Visto bueno de Tamara para #146 (puerta N15).~~ Ya no hace falta: el
  propietario aceptó #146 funcionalmente el 29/10.
- Significado de las fechas de prueba (N10): no bloquea ninguna entrega.

## Ventana de Staging (E10)

Coordinada con la sesión de release (28/10, 01:55Z: no necesita ventana en
Staging; F12.2 es de solo lectura en Production desde las 20:03Z) y con la
sesión de Stripe, dueña de `20261028090000`, la última migración aplicada en
Staging (87).

**Staging congelado (28/10).** La sesión de Stripe tiene en curso su E2E de
facturación, que fija el despliegue `1ea797e` en `gestcopy-staging`. Hasta que
confirme el final (su paso S9), esta rama no mueve `gestcopy-staging` ni aplica
migraciones en Staging, salvo decisión del propietario. El runner de copias de
Staging se puede usar en modo lectura, nunca a la vez que otra copia.
El propietario lo confirmó el 28/10 (~19:05Z): se espera a S9. La sesión de
integración dejó Staging libre por su parte a las 21:16Z, pero solo quiere
decir que su lote ya no lo bloquea: no autoriza el despliegue. Sigue haciendo
falta el fin de S9 y el OK expreso del propietario en esta sesión, que ha
dejado dicho en la sesión de Stripe que Staging no se libera para Post-its sin
su autorización. Mejor esperar también a que el propietario termine el alta C
de #161 (Chrome → Safari, unos 5 minutos), que debe correr entera sobre
`97fbc59` para cerrar las verificaciones de PKCE.

**Estado de S9 (sesión de Stripe, 28/10 ~21:25Z).** S9 (limpieza de los datos
de prueba de Billing Pro) va después de la ronda C del alta pública, y esa ronda
espera a que Auth de Staging tenga SMTP propio (Brevo, etapas E1–E4): no hay
fecha. Ni S9 ni la liberación de Staging se hacen sin el propietario. E10 no
depende de S9:
- No usa nada de su inventario (`d3-pendiente`, `s10-onboarding-1028`, los
  usuarios `+d3pendiente`, `+s10` y `+authfix*`). Usa `e2e`, solo para leer, y
  cuatro tenants sintéticos nuevos `e2e-sur4-*` (matriz del contrato, §11),
  dentro del prefijo `e2e-*` que S9 conserva.
- No envía correos de Auth: los usuarios de prueba se crean con la API de
  administración ya confirmados (`email_confirm`) y entran con contraseña. No
  hay altas públicas, invitaciones, recuperaciones ni enlaces mágicos, así que
  el SMTP propio y su límite de 30 por hora no les afectan.
- Necesita un bloque de 1,5–2 h sin otra copia, despliegue, S9 ni cambio de
  SMTP a la vez. `gestcopy-staging` está en `97fbc59` (#161 de
Stripe, `dpl_BEPEcxjr…`, 19:41Z; rollback `dpl_7HARpUQ…`).

**Decisión del propietario (28/10, ~21:40Z).** La ventana de Post-its (E10)
se abre después de la ronda C del alta pública (#161), sin esperar a S9. El
bloqueo real es la ronda C y, por ella, el SMTP de Brevo. Condiciones:

1. Ronda C terminada correctamente sobre la versión actual de Staging
   (`97fbc59`).
2. PR #160 con todas las comprobaciones de CI aprobadas.
3. Ventana prevista comunicada a las sesiones de integración y de Stripe.
4. Autorización expresa del propietario en esta sesión antes del despliegue.
5. Ventana exclusiva de 1,5–2 h, sin S9, cambios de SMTP, copias ni otros
   despliegues a la vez.
6. Validación de los cuatro tenants sintéticos `e2e-sur4-*`, incluido el
   aislamiento por `tenant_id`, permisos y RLS.
7. Resultados registrados aquí. E10 se cierra solo con todas las pruebas en
   PASS.

**Cambio de puerta (29/10, instrucción del propietario «Staging funcional»).**
La prioridad pasa a tener las funciones operativas en Staging; Stripe Pro y el
onboarding siguen en paralelo sin bloquearlas. #146 y #153 están aceptadas
funcionalmente por el propietario: no se vuelve a pedir validación a Tamara ni
al propietario. SUR4 es cliente piloto y fuente de sugerencias, no aprueba el
desarrollo.

- **Puerta anterior** (28/10, ~21:40Z): E10 después de la ronda C de #161,
  que depende del SMTP propio de Staging (Brevo, etapas E1–E4, sin fecha).
- **Propuesta:** quitar la dependencia cronológica SMTP / ronda C → E10, y
  tampoco esperar a S9. Motivos:
  1. E10 no usa correo. `seed-sur4.ts` crea los usuarios con la API de
     administración ya confirmados (`email_confirm`). No hay altas públicas,
     invitaciones, recuperaciones ni enlaces mágicos. El seeder de DEMO
     tampoco envía correos.
  2. El candidato no toca auth ni facturación. El diff `97fbc59..496bf6b` en
     `app/auth`, `lib/auth`, `proxy.ts`, `lib/supabase`, `app/onboarding`,
     `app/api/billing`, `lib/billing` y `app/api/stripe` está vacío, byte a
     byte.
  3. El despliegue es un avance rápido (FF) sobre `97fbc59`, así que #161
     queda intacta. La ronda C se puede hacer después sobre la cabeza nueva,
     con el mismo código de auth, y su resultado vale igual.
  4. No toca el inventario de S9 (`d3-pendiente`, `s10-onboarding-1028`,
     usuarios `+d3pendiente`, `+s10` y `+authfix*`, suscripciones, ofertas y
     Stripe Test).
- **Condiciones que se mantienen:**
  - CI en verde en la cabeza de integración;
  - copia B1.3 verificada de menos de 2 h;
  - las dos migraciones por separado, cada una con su comprobación
    (`~/copyflow-ops/staging-e10-20261029/verify-staging-e10.sql`);
  - ventana exclusiva sin operaciones de Stripe en Staging (S9, SMTP, ronda
    C, despliegues), avisada a las sesiones de Stripe e integración;
  - OK expreso del propietario antes de empezar;
  - los cuatro tenants `e2e-sur4-*` en PASS, con aislamiento, concesiones,
    RLS, permisos e impresión;
  - resultados registrados aquí.
- **Hosts (corrección del propietario, 29/10 ~11:50Z, acta A1.8):** no se
  crea infraestructura por tenant, así que la opción A (cuatro dominios en
  Vercel) queda descartada. Ninguno de los cuatro hosts `e2e-sur4-*` tiene
  certificado hoy: Vercel solo tiene `e2e`, `demo`, `audit` y el comodín de
  Production, que cubre un solo nivel.
  E10 usa lo que ya existe:
  - La URL de rama de `gestcopy-staging` (`VERCEL_BRANCH_URL`, certificado
    `*.vercel.app`). En Preview es un host «app» y acepta el selector de
    tenant `?tenant=<slug>` (`lib/tenant/preview-tenant.ts`, cookie
    `gc_preview_tenant`; `lib/tenant/trusted-host.ts`). Entra con el bypass
    de automatización de Vercel, como el resto de E2E de Staging.
  - El smoke del camino por subdominio, en `e2e.preview…` y
    `demo.preview…`.
  Hay que añadir al E2E el modo `staging-branch` (guarda y arnés). Solo
  cambian las pruebas; el código desplegado no cambia.
- **Hosts, decisión nueva del propietario (29/10, mensaje a la sesión de
  integración; sustituye al punto anterior):** «Autorizamos preparar la
  opción A: registrar exclusivamente los cuatro dominios sintéticos e2e-sur4-*
  dentro del proyecto Vercel existente, vinculándolos a la rama
  gestcopy-staging.» Condiciones:
  - mismo proyecto, core, despliegue y Supabase Staging;
  - nada por tenant ni DNS;
  - TLS y asociación a Preview confirmados antes de cualquier E2E;
  - sin Production ni tenants reales.

  La sesión de integración los dio de alta entre las 12:15 y las 12:16Z:
  - `verified=true` y sin cambios de DNS;
  - certificado de Let's Encrypt válido hasta el 27/01/2027;
  - alias del despliegue de `97fbc59`, con 302 al SSO de Vercel como `e2e`.

  E10 queda así:
  - **Prueba principal:** por host real (`E2E_SUR4_MODE=staging`), igual que
    en Production.
  - **Complemento:** el modo `staging-branch`, para comprobar el aislamiento al
    cambiar de tenant con el selector.

  La autorización del despliegue y de las migraciones de E10 sigue siendo
  aparte. El propietario decidirá si los hosts se retiran al cerrar E10 o se
  quedan hasta publicar; hasta entonces no se tocan.
- **N15:** la aceptación funcional de #146 (29/10) cubre la parte funcional de
  la puerta. El merge a `main` sigue siendo un paso aparte, con autorización
  (plan de publicación, `docs/SUR4-PLAN-PUBLICACION.md`).
- **Candidato:** rama `integration/staging-20261029-sur4`, `496bf6b`: merge
  de `c549951` sobre `97fbc59` con las seis resoluciones del ensayo
  `2619ff9`. En local: 1723 pruebas (0 fallos), tipos, lint, build y guarda
  de migraciones. #160 no se fusiona en `main`.

Varias funciones pueden avanzar a la vez en ramas o sesiones distintas, pero
lo que modifica Staging se coordina y va de uno en uno. S9 conserva todos los
tenants `e2e-*`, también los que se creen después (confirmado por la sesión de
Stripe, que no borrará por patrón).

Pasos, en este orden y sin saltarse ninguno:

1. Confirmación de la sesión de Stripe (S9 terminado). Volver a leer
   `origin/gestcopy-staging` justo antes de empezar (hoy `97fbc59`). Con el
   OK del propietario, avisar antes a la sesión de integración con la hora y
   el despliegue nuevo; ella se lo pasa a Stripe, que tiene pendiente la ronda
   E2E del propietario sobre #161.
2. Copia de Staging verificada de menos de 2 h con el runner B1.3 de Staging
   (`~/copyflow-ops/staging-backups`), sin otra copia en marcha.
3. Rama de integración propia (`integration/staging-<fecha>-sur4`) desde
   `origin/gestcopy-staging`, con esta rama fusionada encima (merge, nunca
   rebase ni force push). CI en verde en esa rama. Ensayo local del 28/10
   contra `97fbc59` (commit local `2619ff9`, sin rama ni push): seis
   conflictos, todos con resolución clara. Después, `tsc`, lint, 1711
   unitarias y build OK:
   - `.github/workflows/kiosk-supabase.yml`: se quedan las rutas de voz de
     Staging (`lib/ai/**`, `app/api/ai/**`) y la de las suites
     (`supabase/tests/phase6[0-9]_*`).
   - `app/api/orders/options/route.ts`: lado de Staging. La voz (#90) la pasó a
     `lib/orders/options-load.ts`, ya con el filtro de R6, que es lo único que
     `main` cambiaba ahí; esta rama no la toca.
   - `components/orders/detail/order-header.tsx`: estructura de E3, con
     `currentStatusName` de #156 en el único `<OrderQuickActions>`.
   - `components/orders/detail/order-production.tsx`: la importación de
     `orderLabels` (E2).
   - `components/orders/detail/order-workspace.tsx`: van las dos cosas. Orden
     en la ficha: cabecera, seguimiento de #153 (`<OrderTracking>`), post-its
     fijados, secuencia, presupuesto de origen.
   - `lib/help/changelog.ts`: el bloque del 28/10 de `main`, ya publicado en
     Production.
   Los ficheros de texto enriquecido de #146 ya no chocan. Migraciones tras la
   fusión: `20261028090000` (Stripe), `20261028120000`, `20261028130000`.
   Si la punta de Staging cambia, se repite la fusión con estas reglas.
4. `supabase db push --dry-run` contra Staging: solo puede listar
   `20261028120000` y `20261028130000`. Se aplican por separado, cada una con
   su comprobación (tablas, RLS, funciones apagadas en todos los tenants).
5. Despliegue de la rama de integración en Staging como avance rápido (FF)
   sobre la punta de `gestcopy-staging`, sin force, para no perder
   `/auth/confirm`. Smoke de pedidos sin funciones (tenant `e2e`): ficha, Hoja
   estándar sin notas, Resguardo. Ninguna escritura en `e2e` sin coordinarla
   antes con Stripe.
6. Hosts de los tenants de prueba. **Hecho el 29/10, 12:16Z:** opción A, con
   los cuatro hosts dados de alta por la sesión de integración (ver «Cambio
   de puerta»). Lo que sigue queda como historial. **Decisión del propietario (28/10,
   ~22:35Z): opción A.** En la ventana, y solo después de su OK expreso al
   despliegue, se añaden únicamente los cuatro hosts `e2e-sur4-*` al proyecto
   `copyflow` con la rama `gestcopy-staging`, y se quitan al cerrar E10. Nada
   antes de ese OK; ningún otro dominio ni cambio de DNS.
   Comprobación en modo lectura (28/10, ~22:25Z):
   - DNS: cubierto. `gestcopy.com` está en Cloudflare, que delega la subzona
     `app.gestcopy.com` entera a Vercel DNS (`ns1.vercel-dns.com`, comprobado
     preguntando a Cloudflare). El comodín `*.preview.app.gestcopy.com` ya
     apunta a Vercel; `e2e-sur4-base` resuelve a las mismas IP que `e2e` y
     `demo`.
   - App: cubierta. En Preview acepta cualquier slug de una etiqueta bajo
     `TENANT_PREVIEW_BASE_DOMAIN` (`lib/tenant/hostname.ts`), sin lista ni
     ajuste por tenant.
   - Vercel: **no cubierto**. El proyecto `copyflow` solo tiene el comodín
     `*.app.gestcopy.com` (Production, sin rama), que cubre un nivel
     (`sur4.app.gestcopy.com`) y no `x.preview.app.gestcopy.com`. Los hosts de
     Preview están uno a uno con la rama `gestcopy-staging` (`e2e`, `demo`,
     `audit`) y cada uno tiene su certificado. Un host que Vercel no conoce,
     como `e2e-sur4-base` o uno inventado, falla en el TLS, antes de llegar a
     la app.
   Opciones:
   - **A, mínima:** los cuatro hosts, igual que `e2e`, `demo` y `audit`:
     `e2e-sur4-base.preview.app.gestcopy.com`,
     `e2e-sur4-postits.preview.app.gestcopy.com`,
     `e2e-sur4-secuencia.preview.app.gestcopy.com` y
     `e2e-sur4-completo.preview.app.gestcopy.com`. Proyecto `copyflow`
     (equipo Tecnokaizen), entorno Preview, rama `gestcopy-staging`. Sin cambio
     de DNS; Vercel saca el certificado de cada uno solo. Production no cambia:
     sus dominios no se tocan, el comodín de Production no llega a dos niveles
     y estos hosts sirven el despliegue de Staging, con la base de Staging. Se
     pueden quitar al cerrar E10.
   - **B, sin ajuste por tenant:** un solo dominio `*.preview.app.gestcopy.com`
     con la rama `gestcopy-staging`. Cubre cualquier tenant de Staging futuro.
     Corrección (28/10, ~23:00Z): como la subzona `app.gestcopy.com` ya está en
     Vercel DNS, Vercel puede validar el certificado comodín por sí mismo, igual
     que el de `*.app.gestcopy.com`; no haría falta tocar Cloudflare. Aun así es
     un cambio de configuración aparte, no para esta ventana. Queda como mejora
     futura de Staging (decisión del propietario, 28/10).
   En la ventana no se tocan DNS, el comodín de Production ni la
   configuración de Supabase.
   DEMO: concesiones solo en tenants sintéticos según la matriz del contrato
   (§11), recorrido E2E y retirada y vuelta de cada función con datos dentro.
   Nunca en el tenant real de SUR4. Con los scripts de abajo:
   `seed-sur4.ts` y después `sur4-features.ts`.
7. Registro PASS/FAIL en este documento. Si algo falla: retirar concesiones y,
   si hace falta, los ficheros de `supabase/rollbacks/` en orden inverso.
   Al cerrar E10, pase o falle, se quitan de Vercel los cuatro hosts
   `e2e-sur4-*` y se comprueba que `e2e`, `demo`, `audit` y los dominios de
   Production siguen igual.

### E2E de DEMO (preparado el 28/10)

Dos scripts en `e2e/staging/`, con el mismo guard, harness y redactor que el
E2E de Staging V0:

- `seed-sur4.ts` (servidor, clave de servicio): crea o re-sincroniza los
  cuatro tenants `e2e-sur4-*` con `create_internal_organization_v1`, un
  propietario sintético por tenant (`{slug}-owner@example.com`, confirmado por
  la API de administración, sin correo) y un `viewer` en `completo`. Pone las
  cuatro funciones según la matriz con `set_tenant_feature_v2` (auditada, solo
  si el estado cambia; `E2E_SUR4_OPERATOR` dice quién lo autoriza). No borra
  nada ni toca otro tenant.
- `sur4-features.ts` (navegador): por tenant, equipo (dos personas que
  reciben pedidos y una que no), servicio, tiendas y cuatro pedidos por la
  API; lo que muestran la ficha, la API, la Hoja de trabajo y el PDF del
  resguardo según sus funciones; post-its desde la ficha (interna, imprimible
  con confirmación, fijar y desfijar, anulada, «Pasar a post-it») y secuencia
  desde la ficha (fases sugeridas, tres pasos: dos personas y uno sin asignar,
  el primero hecho). Después: cada función se apaga y se enciende con los datos
  intactos (siempre se restaura la matriz); el `viewer` lee y no escribe; cada
  tenant recibe 404 en pedidos, notas, pasos, Hoja y resguardo de los demás, y
  con su propio JWT PostgREST no ve filas ajenas (todas las suyas llevan su
  `tenant_id`), las RPC rechazan ids ajenos y la inserción directa falla.
- El guard deriva los cuatro hosts (no los lee del entorno) y rechaza
  Production, otros tenants y buckets ajenos. `E2E_SUR4_MODE=local` solo
  admite `http://{slug}.localhost:<puerto>` y Supabase en `127.0.0.1`, sin R2.

Prueba local (28/10, 22:07Z, pila aislada con las 2 migraciones): **PASS**.
4 tenants, 0 errores de consola, 0 peticiones bloqueadas; aislamiento con
38–40 intentos ajenos denegados por tenant. Durante el ajuste solo se
corrigió el propio script (el aviso que deja «Pasar a post-it» hasta recargar,
el botón de secuencia que solo aparece con fases, y textos en mayúsculas por
CSS en la Hoja); ningún fallo de la aplicación. Tipos, lint, pruebas del guard
(12) y de la puerta de release (41) OK.

Variables del E2E en Staging (fichero local `.env.e2e-sur4.local`, fuera de
git): `E2E_SUPABASE_URL`, `E2E_R2_BUCKET`, `E2E_SUPABASE_SECRET_KEY`,
`E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUR4_PASSWORD`, `E2E_SUR4_OPERATOR`,
`VERCEL_AUTOMATION_BYPASS_SECRET` y `PLAYWRIGHT_MODULE`.

### Resultado de E10 (29/10/2026): PASS

GO del propietario a las 13:08Z para W0–W8 y W10 con el candidato `c7067b9`.
Cierre a las 15:00Z aproximadamente.

- **W0–W1.** Staging en reposo, `gestcopy-staging` en `97fbc59`. Copia nueva
  `20261029T131008Z`, verificada y restaurada en aislado (RTO 37 s); el primer
  simulacro chocó con una pila local de restauración que seguía levantada y se
  repitió con permiso del propietario.
- **W2–W3.** `20261028120000` y `20261028130000` aplicadas por separado, con
  dry-run delante; verificación 42/42 y 64/64; 89 migraciones.
- **W4.** FF de `gestcopy-staging` a `c7067b9`; despliegue
  `dpl_44GE1RhvVHAi4gruaHRqU1E2CTqq` READY con los hosts de Staging y los
  cuatro `e2e-sur4-*`.
- **W5–W6.** Seed de los cuatro tenants `e2e-sur4-*` (sin correos);
  `sur4-features.ts` PASS por host real y con cambio de tenant: matriz,
  post-its, secuencia, Hoja, Resguardo, `viewer` y aislamiento (38–40 accesos
  ajenos denegados por tenant).
- **W7.** El primer intento (run 40882850916) falló por tres aserciones del
  E2E desfasadas respecto a #160; la aplicación era correcta y el propietario
  ordenó STOP. Recuperación autorizada: una rama solo de tests,
  `e2e/e10-w7-fix` (`86e3813`), y un permiso temporal en el entorno `staging`
  de GitHub solo para esa rama, retirado al terminar (entorno idéntico al
  original). El run 40893480059 terminó en `success`, con 12/12 pasos. B2 de
  `integration-batch` se omite porque el catálogo de servicios de `e2e` está
  vacío, igual que el 27/10. Sin tráfico a Production ni respuestas 5xx.
- **W8.** Smoke sin sesión en `e2e.preview` y `demo.preview`: 10/10, sin
  errores de consola ni 5xx.
- **W10.** Escrituras solo en `e2e` y `e2e-sur4-*`; facturación sin cambios;
  ninguna tabla sin RLS; 74 políticas; 89 migraciones.

Pendiente antes de P-3: llevar a #160 las tres correcciones de
`e2e/e10-w7-fix` (`run.ts`, `quotes.ts` y `order-rich-text.ts`). Siguen fuera de
este GO W9, el seeder de DEMO y Production. Evidencias completas en
`~/copyflow-ops/staging-e10-20261029/artifacts/E10-EVIDENCIAS.md`, fuera del
repositorio.
