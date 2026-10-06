# Presupuestos UX — Corrección de recuperación y validación

Estado: **READY FOR RE-AUDIT**. No equivale a READY FOR PR. Rama local `fix/quotes-ux-flow-v1`, base `46038590cdfd6f6454ca2398659252bcafcc48ad`. Parte del HEAD auditado `5c8ae249601399ab7ffbeaa6b95cb261445553db`. No se ha publicado, abierto PR, mergeado, desplegado ni tocado Production.

## Cierre de los findings aprobados

- **HIGH entre pestañas:** `?op=<uuid>` identifica una operación; el recibo local y Web Lock usan tenant+actor+operation_id. Cleanup elimina exclusivamente esa clave. Copiar una URL comparte operación; dos editores nuevos tienen identidades distintas. SQL serializa los reintentos entre navegadores/dispositivos. El smoke reproduce A ejecutada con respuesta perdida, B guardada, A recargada: exactamente dos quotes y recuperación intacta. Dos pestañas con mismo op convergen en un quote.
- **HIGH pérdida de storage/identidad:** consulta exacta al servidor antes de crear. `acknowledged_at` distingue ejecución de confirmación conocida por el navegador. ACK restringido, idempotente, sin modificar el resultado original. Recuperación por URL funciona con storage perdido y también después del ACK. Sin URL ni storage, la lista de recibos recientes no reconocidos bloquea el formulario hasta Abrir presupuesto existente / Crear otro presupuesto. Esta última decisión conserva su nueva identidad en URL; no deduplicamos por contenido. Fallar la consulta de recuperación bloquea la creación.
- **MEDIUM PDF:** sin etiqueta para primera revisión; Revisión N para posteriores, en título, cabecera y pie. Los PDF ya guardados no se regeneran. Se ha comprobado texto visible y metadatos con fixtures renderizados.
- **MEDIUM cliente de draft guardado:** metadatos `client_manual_fields` se guardan con el draft y se clonan en revisiones. Autofill respeta cada campo manual, incluido un valor igual al maestro. Sin metadatos históricos, todos los campos poblados se protegen conservadoramente. Cambiar cliente, asociaciones, cabecera y partidas se guarda en una transacción con CAS de quote y versión. Smoke cubre editar, guardar, recargar, cambiar cliente y recargar otra vez. SQL prueba rollback de asociación ante ítem inválido y bloqueo de prepared.
- **MEDIUM aceptado/documentado:** vacío → NULL → herencia del maestro sigue vigente. No se añade contrato para suprimir datos. Prepared/sent congelan snapshots y mantienen PDF, accepted_version_id y conversión.

## Cambio SQL y DB-first

Se modifica la migración no publicada `20261006130000_quote_draft_creation.sql`, sin otra migración. Añade ACK y recuperación limitada por actor/tenant, más metadatos opcionales de campos manuales y RPC para cambiar cliente+borrador atómicamente.

`save_quote_draft_v1` conserva firma y parámetros. El guardado existente pasa a helper privado; el wrapper no cambia su comportamiento para cabeceras del código base sin metadatos. `create_quote_version_v1` mantiene lógica, autorización, inmutabilidad y contrato, y copia únicamente la nueva metadata opcional. No se cambian valores de snapshots preparados existentes.

Todas las funciones expuestas son SECURITY DEFINER, search_path vacío y execute para authenticated únicamente. Helper privado, receipts con RLS y sin grants directos, INSERT(id) aún denegado. HTTP deriva tenant del contexto autorizado; nunca acepta tenant/actor del body. Recuperación devuelve solo identidad, referencia y fechas, sin request/result privados. ACK no reconoce operaciones de otro usuario ni tenant, incluso con memberships en ambos.

**DB-first backward-compatible con 46038590...: SÍ.** Reset del esquema hasta `20261006120000`, phase40–43 antes del upgrade, aplicación de únicamente la migración revisada y phase40–44 más todas las concurrencias después: exit 0. El código base puede seguir insertando quotes por la ruta legacy y ejecutando las firmas originales mientras corre este esquema. La reversión de aplicación no requiere eliminar receipts ni metadatos.

## Validación reejecutada

| Prueba | Resultado |
|---|---|
| Reset local con todas las migraciones | Exit 0 |
| phase40–44 SQL | Exit 0; phase44 incluye actor/tenant, replay incompatible, rollback segundo ítem+actividad+contador y ACK |
| SQL adicional cliente/revisión | Exit 0: procedencia manual, cliente+snapshot coherentes, rollback, ambos CAS, prepared inmutable, metadata clonada |
| Concurrencia phase40–44 | Exit 0; ocho creaciones y ocho ACKs con resultado/timestamp estables, un quote/draft/receipt/ítem/contador |
| Upgrade DB-first | Exit 0; SQL legacy antes y regresiones+concurrencias después |
| Node 22.23.2: TZ=UTC node --import tsx --test | 898 tests, 892 pass, 6 skipped, 0 fail |
| npm run lint | Exit 0 |
| npx tsc --noEmit --incremental false | Exit 0 |
| npm run build -- --webpack | Exit 0 |
| git diff --check | Exit 0 |
| Secret scan de archivos modificados/nuevos | Sin coincidencias en patrones de claves/JWT revisados; verificación heurística |
| Smoke creación/recuperación/cliente guardado | 365 comprobaciones PASS |
| Smoke edición/PDF | 278 comprobaciones PASS |
| Smoke transiciones/revisiones | 392 comprobaciones PASS |
| Smoke aceptación/conversión | 458 comprobaciones PASS |
| PDFs renderizados primera/segunda revisión | Texto visible y metadatos PASS |

Casos de recuperación cubiertos: dos pestañas distintas con respuesta perdida tras ejecución; misma pestaña recargada; cierre/reapertura con URL; pérdida localStorage; pérdida URL+storage con ambas decisiones; dos pestañas mismo op concurrentes; pérdida respuesta de ACK; ACK cross-user/cross-tenant; replay incompatible; servidor de recuperación inaccesible. Responsive 390/768/1280 light/dark, overflow y capturas revisadas en los seis diseños.

Límites: UI con componentes/CSS reales y dobles HTTP; SQL con roles reales en PostgreSQL local. No se afirma E2E contra servicios externos. Las creaciones sin identidad se buscan en una ventana de 30 días; identidad conocida se recupera sin ese límite y después de ACK. ACK confirma que el navegador conoce el quote, no que toda la ficha se haya mostrado. Sin Web Locks el navegador bloquea el guardado. La build estándar Turbopack queda pendiente de un entorno sin las restricciones ya documentadas; Webpack sí está validado.

Las evidencias están en `output/quotes-recovery-20261006/` del workspace padre. Ningún log o fixture forma parte de una escritura en Production.

## Próximo paso

Reauditar el nuevo SHA completo, con especial atención a la migración ampliada, wrapper compatible, metadatos y recuperación. Antes de cualquier PR, comprobar de nuevo origin/main. Publicación, PR y cualquier paso operativo quedan pendientes.
