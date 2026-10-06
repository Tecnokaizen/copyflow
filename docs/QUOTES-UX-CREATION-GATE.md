# Presupuestos V1: creación idempotente y UX

Base: `46038590cdfd6f6454ca2398659252bcafcc48ad`.
Rama: `fix/quotes-ux-flow-v1`.

## Diagnóstico y contrato final

El flujo anterior creaba solo la ficha básica y redirigía al detalle para abrir/editar el documento comercial. El editor leía contactos vacíos del quote aunque el snapshot heredaba datos del cliente. Mostraba estados operativos y documentales a la vez, `vN`, historial inicial y una tarjeta comercial sin acciones.

La propuesta HTTP-only inicial queda sustituida: el cliente autenticado NO tiene `INSERT(id)` en quotes. No se amplía ese permiso y no se usa service_role en la creación.

La migración no publicada `20261006130000_quote_draft_creation.sql` incorpora:

- Un registro privado `quote_draft_creations` con identidad, tenant, actor, solicitud original, resultado original y `acknowledged_at`. RLS habilitado y todos los privilegios directos revocados para public/anon/authenticated/service_role. Su FK liga la identidad al quote del mismo tenant.
- `create_quote_draft_v1`, SECURITY DEFINER, search_path vacío, ejecutable solo por authenticated. Autoriza actor, rol operativo, membership activa, feature y tenant activo, y valida las relaciones de cliente/servicio/responsable dentro del tenant. No otorga INSERT(id).
- Un bloqueo transaccional por UUID que serializa creaciones concurrentes. Repetir la solicitud original con el mismo actor/tenant devuelve el resultado original, incluso después de preparar/editar el quote. Una solicitud diferente o una colisión devuelve un conflicto sin modificar ni revelar el presupuesto ajeno.
- Creación de quote, apertura del primer draft, guardado completo de cabecera/partidas y preparación opcional en UNA transacción, reutilizando las RPC comerciales actuales. Errores intermedios revierten también la referencia y su contador.

La ampliación añade `recover_quote_draft_creations_v1` y `ack_quote_draft_creation_v1`, con SECURITY DEFINER, search_path vacío y ejecución solo para authenticated. La lista sin identidad devuelve únicamente recibos no reconocidos de los últimos 30 días del mismo actor+tenant. La consulta de una identidad conocida sirve también después del ACK o fuera de esa ventana: permite recuperar una URL antigua sin convertirla en una creación nueva. Las respuestas solo incluyen identidad, referencia y fechas; no exponen request/result privados.

Los campos manuales se registran como metadatos opcionales de `quote_versions`, separados de los valores del snapshot. `save_quote_draft_v1` mantiene su firma y contrato anterior: llama al guardado existente, ahora privado, y guarda los metadatos solo cuando se incluyen. El clonado de una revisión conserva estos metadatos. `change_quote_draft_client_v1` guarda cliente, asociaciones, cabecera, partidas y metadatos en una transacción, con autorización y los dos tokens row_version. No añade grants de escritura directa.

El resultado de creación es un acuse estable, no una lectura del estado actual. La pantalla redirige al detalle después de confirmarlo y obtiene allí el contenido actual.

## UX

`Nuevo presupuesto` abre el editor completo, con selección/creación de cliente, servicio/responsable, datos de contacto/facturación, trabajo, partidas y condiciones. Un submit guarda todo; preparar guarda y prepara dentro de la misma transacción. No se suben archivos antes de guardar.

Los cinco campos de cliente se completan al seleccionar. Empresa tiene preferencia sobre nombre. La dirección sigue siendo manual. Se conservan los campos tocados por el usuario al cambiar/quitar cliente, incluidos campos vaciados mientras se edita. En un borrador ya guardado, cambiar el cliente solicita confirmación y guarda asociación y cabecera coherentemente en una operación. La procedencia manual persiste al recargar y crear revisiones. En drafts anteriores sin metadatos se protegen conservadoramente todos los campos poblados; no se puede reconstruir si se introdujeron a mano o por autofill.

El estado principal se deriva del estado comercial visible: Borrador, Preparado, Enviado, Aceptado/Rechazado, Convertido en pedido. Se ocultan las acciones vacías y el historial cuando solo existe una revisión. Las revisiones reales usan `Revisiones` y `Revisión N`; PDF y lista usan el mismo lenguaje.

Para presupuestos preparados, la cabecera se lee de una proyección explícita de los seis campos congelados. Los snapshots internos completos y la identidad del cliente dentro de ellos NO se devuelven como DTO. La preparación, PDF, accepted_version_id, conversión, separación quote/order e invariantes existentes permanecen intactos.

## Recuperación de fallos

Cada editor tiene un `operation_id` UUID conservado en `?op=<uuid>` y usado como `creation_id`. El recibo local se guarda con clave `tenant + actor + operation_id`. Una pestaña limpia exclusivamente su operación. Dos pestañas nuevas tienen identidades distintas; copiar la URL comparte identidad. Web Locks serializa los envíos de esa operación entre pestañas y storage events sincroniza su solicitud congelada; PostgreSQL sigue protegiendo la concurrencia entre dispositivos. Si Web Locks no está disponible, el guardado falla de forma segura.

Antes de crear y bajo el lock, se comprueba el servidor y se relee el recibo local. Si la operación ya se ejecutó, se abre el mismo quote; nunca se genera otro UUID para un reintento. Después de recibir la creación se envía ACK, y solo después se limpia su recibo local. ACK es idempotente y no altera el resultado original de creación ni su timestamp de confirmación en replays. ACK significa que el navegador conoce la creación; no garantiza que se haya mostrado toda la ficha. Si se pierde la respuesta del ACK, URL y recibo siguen recuperando esa misma operación.

Si se pierde localStorage, la URL recupera el resultado ejecutado. Si también se pierde la URL, la lista privada de recibos recientes bloquea el formulario y muestra «Hay un presupuesto cuya creación no pudimos confirmar», con «Abrir presupuesto existente» o «Crear otro presupuesto». La segunda acción crea una identidad distinta y registra esa decisión en la URL (`new=1`) para conservarla al recargar. Los recibos anteriores se conservan; no se deduplica por contenido. El acceso incierto al servicio de recuperación bloquea la creación. Si la operación nunca llegó al servidor, su payload local permite reintentar; si se perdieron también payload e identidad, no hay un quote ejecutado que recuperar.

Ante validación 400/invariante 422, que no deja escrituras parciales, se habilita corregir sin regenerar el UUID. Los metadatos de campos manuales se recuperan junto con el recibo local. No se guardan tokens ni secrets.

Se conserva la semántica existente de snapshots: valores NULL de contacto/facturación heredan del maestro al construir el snapshot. Este hotfix protege los campos vaciados durante el cambio de cliente, pero no introduce una semántica nueva para suprimir datos heredados al preparar.

## Validación y límites

Evidencias locales en `output/quotes-recovery-20261006/` del workspace padre. Instalación reproducible offline con Node 22.23.2; sin cambios de dependencias, Next ni hardening.

- Suite Node completa: 898 tests; 892 pasan y 6 omitidos existentes, cero fallos, con TZ=UTC. La ejecución inicial en Europe/Madrid detectó el test existente del kiosk que fija una conversión horaria UTC; no se modifica como parte del hotfix.
- HTTP real de la ruta con dependencias simuladas: autorización antes de escribir, tenant fijado por host, un solo RPC, normalización, conflictos y resultados inciertos. PostgreSQL se valida separadamente con roles reales.
- Reset Supabase local con todas las migraciones aplicado. Phase40–44 pasan. Phase40–43 concurrency y ocho creaciones concurrentes phase44 pasan. Se comprueban ausencia de fichas parciales, numeración única, replay después de preparar, rechazo de actor/tenant/payload incompatible, ACK cross-user/cross-tenant, ocho ACKs concurrentes, rollback del cambio de cliente y denegación de acceso directo al registro privado.
- Editor nuevo y primer borrador en 390/768/1280, light/dark: 365 comprobaciones de navegador, incluidos recuperación y cliente guardado. Edición/PDF: 278; transiciones: 392; conversión: 458. Componentes y CSS reales con dobles HTTP. Capturas inspeccionadas de las seis combinaciones; sin overflow horizontal.
- Lint y TypeScript pasan. Build de producción con Webpack pasa. La build estándar Turbopack sigue sin validarse en este entorno: en la auditoría anterior falló por `binding to a port / Operation not permitted`; no equivale a una build estándar verde y debe verificarse en CI antes de avanzar.

## Secuencia de publicación obligatoria (NO ejecutada)

1. Reauditar el nuevo SHA; estado de esta entrega: READY FOR RE-AUDIT, sin publicar. Antes de abrir PR, comprobar de nuevo origin/main y obtener el veredicto correspondiente. CI debe quedar verde, incluida la build estándar del proyecto. No promover un deployment desde esta validación local.
2. Aplicar únicamente esta migración revisada en Supabase Production, cuando se autorice el paso operativo; mantener el deployment actual mientras tanto. Es backward-compatible con 46038590..., cuya ruta legacy y firmas RPC se conservan. Se ha demostrado con reset del esquema hasta 20261006120000, phase40–43 antes del upgrade y phase40–44 y concurrencias tras aplicar únicamente 20261006130000. El wrapper de save y el clonado conservan el contrato anterior para payloads sin metadatos.
3. Verificar firma de RPC, SECURITY DEFINER/search_path, grants, RLS del registro privado, persistencia de la denegación INSERT(id), versión de migración y caché de schema PostgREST. Comprobar descubrimiento HTTP con autenticación normal sin crear presupuestos de prueba en Production.
4. Solo después promocionar el deployment Vercel que incluya este código. Un core, un Vercel y un Supabase para todos los tenants; ninguna excepción SUR4.

Si hay que revertir la aplicación, el código anterior puede seguir operando con la migración presente. No borrar recibos, historial o presupuestos como parte de una reversión improvisada. Production, merge y despliegue quedan fuera de esta ejecución.
