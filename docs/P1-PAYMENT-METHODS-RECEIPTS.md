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
