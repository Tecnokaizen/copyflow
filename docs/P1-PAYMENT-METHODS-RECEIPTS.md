# P1 — Métodos de pago y justificantes

## Resultado

«Registrar entrega a cuenta» exige Efectivo, Tarjeta, Bizum, Transferencia u Otro y admite un justificante opcional. Cada movimiento muestra su método, fecha, importe y justificante con descarga privada. Los registros anteriores conservan su importe, identidad y anulación; su método NULL se presenta como «Sin especificar (histórico)». No se inventa un método ni se reescribe el histórico.

Arquitectura: el mismo repositorio Next.js, proyecto Vercel y Supabase PostgreSQL compartido. El nuevo vínculo contiene tenant, pedido y archivo y mantiene memberships/RLS. No hay infraestructura por tenant ni acceso de service_role para cobros.

## Contrato y flujo

Migraciones (renombradas el 15/10/2026 para ordenarse después de `main`; no se
habían aplicado en Staging ni en Production):

- `20261016090000_order_total_validation_p1.sql`: corrección de #91,
  `set_order_total_amount` solo traduce su propio `total_below_paid`. Sustituye a
  la PR #91, cuya parte de aplicación ya cubrió #93.
- `20261016091000_order_payment_methods_receipts_expand.sql`: paso **expand**
  descrito abajo.

- `order_payments.payment_method`: `cash`, `card`, `bizum`, `transfer`, `other`; obligatorio en nuevas inserciones, nullable para históricos.
- `receipt_file_id`: opcional, FK compuesta `(tenant_id, order_id, receipt_file_id)` a `order_files`; un justificante corresponde a un movimiento.
- RPC ampliada: `record_order_payment(uuid, text, timestamptz, text, text, uuid, uuid)`. El último argumento es el tenant resuelto por la API, nunca el tenant de un payload.
- **Expand/contract.** La firma antigua de cuatro argumentos sigue funcionando
  igual que en `main` durante el despliegue (método `NULL`, «Sin especificar»),
  para que la versión de la app en curso, Production incluida, no pierda la
  posibilidad de registrar entregas a cuenta. El trigger acepta `NULL` en
  inserciones en esta fase. La app nueva siempre envía método por la firma de
  siete argumentos. El paso **contract** (abajo) retira la vía antigua.
- El método y el vínculo son inmutables. Anular conserva ambos y el justificante.
- Las respuestas de colección incluyen exclusivamente ID/nombre del justificante, sin claves R2 ni URLs persistentes. La descarga solicita una URL temporal mediante la autorización existente del pedido/tenant y estado ready.

Orden de confirmación: INIT existente → PUT directo privado en R2 → COMPLETE existente (HEAD/verificación/HMAC) → registro del pago y asociación al archivo en una única transacción PostgreSQL.

Un fallo de INIT/PUT/COMPLETE no envía la escritura monetaria. Si se pierde COMPLETE, se reintenta COMPLETE del mismo archivo. Un archivo que queda confirmado antes de cancelar o de fallar el pago permanece como archivo del pedido y puede eliminarse si no está asociado a un cobro; no se registra dinero ni se enlaza a otro movimiento automáticamente.

Antes del POST monetario se guarda el payload exacto y la clave en sessionStorage, con la clave `gestcopy.payment-pending.v2` más tenant, usuario y pedido. Otra persona en el mismo navegador no recupera esa confirmación. La respuesta incierta congela importe, fecha, método y justificante. Cerrar/reabrir o recargar recupera la confirmación pendiente de esa misma sesión; el usuario confirma su reintento. No se realiza ninguna escritura monetaria automática. Un replay debe coincidir en importe, fecha, método y archivo; anular y reintentar no revive ni duplica el movimiento. La firma antigua de cuatro argumentos solo puede repetir un movimiento ya guardado: no inserta un cobro nuevo sin método.

## Carrera entre cobro y borrado

Registro y soft-delete bloquean primero el pedido, después el archivo. El API de borrado ejecuta la autorización/reserva de borrado SQL antes de eliminar R2. Un justificante asociado, incluso a una entrega anulada, no alcanza el borrado del blob. El guard y la FK también protegen sus metadatos.

Si falla R2 después de reservar el borrado, se devuelve 502 `R2_DELETE_PENDING`. Los metadatos quedan soft-deleted y no pueden asociarse a un pago; repetir DELETE con los mismos IDs completa el borrado. El diálogo conserva el error para reintentar. No debe interpretarse el error como borrado físico confirmado; el registro soft-deleted permite identificar el objeto para su recuperación operativa. No se ejecuta limpieza de R2 para un justificante del ledger.

## Despliegue expand/contract

1. **Expand** (migración `20261016091000`): aplicar antes que la app. Es
   compatible con la app anterior: columnas nuevas nulas, snapshot de cobros
   con campos añadidos y la firma de cuatro argumentos intacta.
2. **App**: desplegar el código de esta PR. Si la app llega antes que la
   migración (p. ej. una Preview contra una base sin aplicar), listar archivos
   sigue funcionando sin marcas de justificante: `receiptSchemaUnavailable`
   reconoce tanto el error de caché de esquema de PostgREST como el 42703
   («column … does not exist»). Ese 42703 era la causa del «Could not list
   files». Registrar cobros con método exige la migración.
3. **Contract** (PR posterior, cuando no quede ningún cliente con la versión
   anterior, p. ej. 24 h tras el despliegue): una migración nueva que
   - en `tg_order_payment_details_guard` vuelve a rechazar
     `tg_op = 'INSERT' and new.payment_method is null` con
     `invalid_payment_method` (23514);
   - redefine `record_order_payment(uuid, text, timestamptz, text)` para que
     solo repita movimientos ya guardados y devuelva `invalid_payment_method`
     en cualquier inserción nueva (cuerpo ya escrito en la versión original de
     esta PR, commit `94fb2a4`).
   No se borran columnas ni filas: los cobros `NULL` registrados durante el
   expand quedan como «Sin especificar».

Rollback: la expand es compatible con la app anterior, así que volver atrás es
solo revertir el código. No se revierte la base de datos tras registrar cobros.

### Corrección respecto a #96

La versión original redefinía `soft_delete_order_file` a partir de la anterior
a #96 (cola transaccional de borrado en R2, `20261014120000`). Aplicada
después de #96, habría eliminado el encolado del borrado: con esa función,
`phase46_files_storage_deletion` falla («delete returns task id»). Ahora se
parte de la versión de #96 y se añaden solo el bloqueo `FOR UPDATE` del
pedido y la protección del justificante. El borrado HTTP es el de `main`: la
API nunca borra en R2 directamente y un fallo de R2 queda pendiente para el
cron (204), en lugar del 502 `R2_DELETE_PENDING` anterior.

## Dependencias

La rama empezó en `main` `58525fb93c88e20d2547032a68194ffbc2fd012c` y conserva por merges locales los commits exactos de las PR pendientes:

- #92: `9c991fc5e60006b231cf4fd1b1a2ba4d73cd6620`, validación de fechas, incluida la hora inexistente del cambio horario. El popup nuevo usa su aviso de selección incompleta. La corrección de total de #91 no se reescribe aquí: `set_order_total_amount` sigue siendo la de esa PR.
- #93: `dd836e757adb184ff627bcf63a934c0053db17c9`, refresco de versión antes de cambiar el total y recuperación del 409 sin reintentar dinero.

Ambos heads son ancestros de la rama. No se han cambiado sus ramas, PR, estados ni contenido. Integrar y validar #92/#93 antes de esta PR; cuando estén en main, el diff quedará centrado en métodos/justificantes. No hacer squash de esta rama para eludir la validación de las dependencias.

## Evidencia local — 13 de octubre de 2026

- TypeScript: sin errores.
- ESLint: sin errores; cuatro avisos ya existentes en `quote-situation.test.ts`.
- Suite Node completa con TZ=UTC (igual que CI): 1008 pruebas, 1002 aprobadas y 6 omitidas por disponibilidad del harness local.
- Integración de los handlers reales: 8 pruebas incluidas en la suite anterior, con dobles solo en límites de contexto/BD/R2. Validación, tenant falsificado, roles, DTO privado, conflictos, protección previa a R2 y descarga segura.
- Chromium, componentes/CSS reales con HTTP/R2 simulados: 59 comprobaciones. Escritorio 1280 y móvil 390, claro/oscuro, subida ordenada, descarga, anulación, PUT fallido, COMPLETE incierto, pérdida de respuesta monetaria + recarga + replay, archivo opcional, conflicto de total #93 y ausencia de escritura para viewer/archivado. El popup admite scroll en pantallas bajas.
- Migración aplicada y suites SQL `phase46_payment_receipts`, `phase45_commercial_operations`, `phase17_order_files` y `phase22_tenant_file_limits`: aprobadas en una BD PostgreSQL local aislada, clonando el esquema local y el catálogo de funcionalidades; sin datos de usuarios ni acceso a Supabase remoto.
- Concurrencia `phase45`: cinco entregas de 30 contra un total de 100 producen tres movimientos (90); cuatro reintentos crean un movimiento.
- Concurrencia `phase46`: claves distintas para un mismo justificante producen un movimiento; cuatro reintentos exactos con justificante producen un movimiento; carrera pago/borrado nunca deja un cobro apuntando a un archivo soft-deleted. Fixtures y secreto ficticio se limpian al terminar.
- `npm run build -- --webpack`: aprobado. `npm run build` con Turbopack se intentó y queda pendiente en CI: el entorno local impide abrir el puerto interno del procesador de estilos. No se cambió el compilador predeterminado del proyecto.

Capturas y resultados de navegador se guardan localmente en `output/payment-receipts-ui/`, fuera del commit. Las suites nuevas están conectadas a los workflows existentes de CI.

## Validación DEMO y paso a producción

> Plan inicial, anterior al despliegue expand/contract. Lo sustituyen la
> validación en Staging y el gate final de integración (más abajo): la expand
> mantiene la firma de cuatro argumentos, así que no hace falta una ventana sin
> escrituras de cobros.

No se ha aplicado la migración al Supabase remoto ni hecho merge/deploy de producción. Una Preview automática de Vercel conserva el mismo proyecto y no activa por sí sola la migración.

**La BD es compartida: una migración no se aplica únicamente al tenant DEMO.** Retirar la firma antigua deja sin capacidad de registrar nuevas entregas a los clientes antiguos. Por ello, la aplicación de esta migración requiere coordinar una ventana sin escrituras de cobros en el entorno compartido, tener preparada la Preview y mantener esta PR en borrador hasta validar DEMO. No aplicar el SQL remoto como una operación aislada en horario operativo. Si no existe esa ventana, preparar una transición de contrato compatible antes de aplicar; no aceptar silenciosamente pagos sin método.

Validación requerida con la Preview y el entorno compartido autorizado:

1. Verificar e integrar según aprobación las dependencias #92/#93; comprobar persistencia del total y fecha.
2. Registrar en DEMO una entrega sin justificante y otra con cada método. Leer posteriormente el movimiento desde PostgreSQL para confirmar método, tenant, pedido y FK.
3. Descargar el justificante con una sesión autorizada; comprobar 403/404 con otro tenant, incluidos usuarios con varias memberships.
4. Simular caída de PUT y pérdida de COMPLETE: ningún pago antes de confirmar archivo; reintento sin doble cobro.
5. Simular respuesta perdida tras registrar el pago, cerrar/recargar, volver a confirmar: un solo ID y un solo importe en el ledger.
6. Anular la entrega: cambia el pendiente, conserva método/justificante y bloquea borrado desde ficha, listado y API.
7. Intentar sobrepago y clave repetida con datos distintos; verificar rechazo sin modificación del ledger.
8. Probar móvil, viewer, pedido archivado y #93 cambiando otros campos antes de editar el total.

Solo después de evidencia DEMO y autorización de integración: quitar borrador, integrar y promover la versión de aplicación coordinada con el contrato de BD. No borrar columnas ni vínculos como rollback tras registrar pagos: una recuperación posterior debe ser hacia adelante y conservar el ledger.

## Validación en Staging — 15 de octubre de 2026

Supabase Staging (`fmmfsbhcwxkaszrrarpw`), tenant sintético `e2e`, R2
`gestcopy-files-staging`. Sin service_role en el navegador; Production no se toca.

| Paso | Resultado |
| --- | --- |
| `db push --dry-run` | Solo `20261016090000` y `20261016091000` pendientes |
| Migraciones aplicadas (versiones exactas) | OK; hash de suscripciones/planes/precios/overrides/tenants sin cambios; los 9 cobros previos idénticos |
| **Expand con la app anterior** (E2E V0 sin método, antes de desplegar el código) | 3/3 PASS, `E2E-0013`: cobro de 20 € con método `NULL` («Sin especificar») |
| Despliegue del código (`gestcopy-staging` `7db5d5d`, con #105 y #99) | OK |
| E2E V0 de esta rama (Bizum + justificante + descarga) | 3/3 PASS, `E2E-0015`: INIT → PUT R2 → COMPLETE → cobro; descarga desde el bucket de Staging con SHA-256 idéntico |
| Listado de archivos del pedido y biblioteca del tenant | 200; el justificante aparece como documento protegido |
| Reintento con la misma clave | Un solo movimiento; misma clave con otro importe → 409 |
| Justificante reutilizado / de otro tenant / inexistente / sin método | 409 / 422 / 422 / 422, sin dinero añadido |
| Descarga de un archivo de otro tenant | 404 |
| Borrar un justificante | 409, también tras anular su entrega; anular dos veces → 409 |
| Anulación | Conserva método y justificante |
| Viewer | Lee (200); registrar y borrar → 403 |
| Ficha y diálogo en 1440 px y 375 px, claro y oscuro | Sin scroll horizontal; método y «Adjuntar justificante» visibles |

Local (BD aislada con `main` + esta rama): invariantes de seguridad, todas las
suites del Release Gate, `phase45_commercial_operations`,
`phase46_order_total_validation`, `phase46_payment_receipts`,
`phase46_files_storage_deletion`, `phase17`, `phase22`, `tamara_operational_access`
y las concurrencias `phase45`, `phase46_payment_receipts` y
`phase46_files_storage_deletion`: PASS. Unitarias: 1088 (1082 PASS, 0 FAIL, 6
omitidas por el arnés local). TypeScript y ESLint sin errores; migration guard PASS.

Integración: Production todavía no tiene la expand. Orden: 1) `db push` de las
dos migraciones (dry-run previo), 2) merge y despliegue, 3) contract en otra PR
cuando no queden clientes antiguos. Hasta el merge, el workflow `E2E staging`
lanzado desde `main` no elige método y fallaría contra un Staging con esta PR;
el runner de esta rama ya lo hace.

## Gate final de integración — 16 de octubre de 2026

Rama actualizada con `main` `8e5dfe1` (#106, #99, #105 y #94) en `e9363b8`, sin
conflictos.

| Comprobación | Resultado |
| --- | --- |
| tsc · lint · build | OK (lint: 0 errores; 4 avisos ya existentes en `main`) |
| Unitarias | 1153/1153 |
| Guarda de migraciones | PASS: 2 migraciones, posteriores a la última de `main` |
| Smokes de navegador | Justificantes (85 aserciones), cobro (234), alta de pedidos (3/3 anchos), cliente en línea (8/8), borrador de presupuestos (290) |
| SQL de esta rama desde cero (`main` + #95) | 54/54, concurrencias incluidas |
| **App actual de Production sobre la expand** | Las 51 suites SQL de `main` (`8e5dfe1`) sobre `main` + #95: 51/51. Por PostgREST, con las llamadas exactas de la app actual: total, cobro con 4 argumentos (método `NULL`), reintento idempotente y `total_below_paid`; lectura de `order_payments` con las columnas nuevas. La llamada nueva de 7 argumentos también funciona. El código de cobros, total, archivos y ficha no ha cambiado desde `03fa094`, la versión con la que pasó `E2E-0013` en Staging |
| Production, solo lectura | Historial = `main` (67); `order_collection_snapshot`, `record_order_payment` (4 argumentos), `set_order_total_amount` y `soft_delete_order_file` con el mismo md5 que `main`; sin columnas, restricciones ni triggers de #95; 20 cobros, 141 archivos, 291 pedidos; ningún pedido con total inferior a lo cobrado |
| Dry-run en Production | Solo `20261016090000` y `20261016091000` |
| Preview de `e9363b8` | Comprobación sin sesión de #94: 25/25 |
| Reversión | `supabase/rollbacks/20261016091000_order_payment_methods_receipts_expand.sql`: probada; deja funciones, permisos, columnas, restricciones, triggers y comentarios iguales que `main`, y se niega a ejecutarse si ya hay cobros con método o justificante |

### Procedimiento (migraciones antes del merge; requiere autorización)

1. Revalidar la PR: head, todos los checks en verde, `CLEAN` y `main` sin
   cambios.
2. Foto de Production en solo lectura justo antes de migrar: historial, huellas
   del libro de cobros, de los totales y de los archivos, y md5 de las funciones.
3. `db push --dry-run --linked` desde un directorio con exactamente las
   migraciones del head: debe listar solo las dos. Si lista otra cosa, parar.
   Después, `db push --linked`.
4. Comprobación inmediata: 69 migraciones; huellas del libro, totales y archivos
   idénticas a la foto; ningún cobro con método ni justificante; funciones con el
   md5 esperado y la firma de 4 argumentos intacta; restricciones y triggers
   nuevos presentes; comprobación HTTP sin sesión en verde. La app actual sigue
   funcionando sobre la expand.
5. Squash merge con `--match-head-commit`. Esperar el Release Gate de `main` y el
   deployment de Production; repetir la comprobación HTTP.
6. Lanzar el workflow `E2E staging` desde `main`: con #95 integrada elige método
   y debe pasar 3/3 contra Staging.
7. Cerrar #91 como sustituida (con autorización).
8. Contract en otra PR cuando no quede ningún cliente con la versión anterior
   (al menos 24 h después), con su propia autorización.

### Recuperación

- **Falla una migración**: `20261016091000` va en una transacción (`begin`/
  `commit`); `20261016090000` es una sola redefinición. Si falla la segunda, la
  primera sola es compatible con la app actual. Parar y revisar.
- **La app actual falla tras migrar, antes del merge**: aplicar
  `supabase/rollbacks/20261016091000_order_payment_methods_receipts_expand.sql`
  y `supabase migration repair --status reverted 20261016091000 20261016090000`.
  Solo es posible mientras no haya cobros con método o justificante.
- **Falla la app nueva tras el merge**: revertir el código (PR de revert, o
  restaurar en Vercel el deployment anterior mientras tanto). La base de datos
  se queda: la expand es compatible con la app anterior. Con cobros con método
  ya registrados, la recuperación es siempre hacia delante y conserva el libro.

