# Presupuestos V1: creación idempotente y UX

Base: `46038590cdfd6f6454ca2398659252bcafcc48ad`.
Rama: `fix/quotes-ux-flow-v1`.

## Diagnóstico y contrato final

El flujo anterior creaba solo la ficha básica y redirigía al detalle para abrir/editar el documento comercial. El editor leía contactos vacíos del quote aunque el snapshot heredaba datos del cliente. Mostraba estados operativos y documentales a la vez, `vN`, historial inicial y una tarjeta comercial sin acciones.

La propuesta HTTP-only inicial queda sustituida: el cliente autenticado NO tiene `INSERT(id)` en quotes. No se amplía ese permiso y no se usa service_role en la creación.

La migración `20261006130000_quote_draft_creation.sql` añade exclusivamente:

- Un registro privado `quote_draft_creations` con identidad, tenant, actor, solicitud original y resultado original. RLS habilitado y todos los privilegios directos revocados para public/anon/authenticated/service_role. Su FK liga la identidad al quote del mismo tenant.
- `create_quote_draft_v1`, SECURITY DEFINER, search_path vacío, ejecutable solo por authenticated. Autoriza actor, rol operativo, membership activa, feature y tenant activo, y valida las relaciones de cliente/servicio/responsable dentro del tenant. No otorga INSERT(id).
- Un bloqueo transaccional por UUID que serializa creaciones concurrentes. Repetir la solicitud original con el mismo actor/tenant devuelve el resultado original, incluso después de preparar/editar el quote. Una solicitud diferente o una colisión devuelve un conflicto sin modificar ni revelar el presupuesto ajeno.
- Creación de quote, apertura del primer draft, guardado completo de cabecera/partidas y preparación opcional en UNA transacción, reutilizando las RPC comerciales actuales. Errores intermedios revierten también la referencia y su contador.

El resultado de creación es un acuse estable, no una lectura del estado actual. La pantalla redirige al detalle después de confirmarlo y obtiene allí el contenido actual.

## UX

`Nuevo presupuesto` abre el editor completo, con selección/creación de cliente, servicio/responsable, datos de contacto/facturación, trabajo, partidas y condiciones. Un submit guarda todo; preparar guarda y prepara dentro de la misma transacción. No se suben archivos antes de guardar.

Los cinco campos de cliente se completan al seleccionar. Empresa tiene preferencia sobre nombre. La dirección sigue siendo manual. Se conservan los campos tocados por el usuario al cambiar/quitar cliente, incluidos campos vaciados mientras se edita. En un borrador ya guardado, cambiar el cliente desde gestión solicita confirmación antes de actualizar la cabecera local; esta se persiste al guardar el borrador.

El estado principal se deriva del estado comercial visible: Borrador, Preparado, Enviado, Aceptado/Rechazado, Convertido en pedido. Se ocultan las acciones vacías y el historial cuando solo existe una revisión. Las revisiones reales usan `Revisiones` y `Revisión N`; PDF y lista usan el mismo lenguaje.

Para presupuestos preparados, la cabecera se lee de una proyección explícita de los seis campos congelados. Los snapshots internos completos y la identidad del cliente dentro de ellos NO se devuelven como DTO. La preparación, PDF, accepted_version_id, conversión, separación quote/order e invariantes existentes permanecen intactos.

## Recuperación de fallos

Antes del primer envío se conserva únicamente el guardado pendiente (UUID, formulario y acción), en almacenamiento local del navegador, con clave por tenant + actor. Se borra después del acuse del servidor. No se guardan tokens ni claves.

Ante respuesta perdida/error incierto, el editor conserva la solicitud original y la deja sin cambios hasta confirmarla. `Reintentar guardado` envía exactamente esa operación. También se recupera al recargar o cerrar/reabrir la pestaña. Ante validación 400/invariante 422, que no deja escrituras parciales, se habilita corregir el formulario sin regenerar automáticamente el UUID.

Si se borra el almacenamiento del navegador, se pierde esta recuperación automática; los presupuestos creados siguen en la lista. La RPC garantiza idempotencia por UUID, no deduplicación de dos solicitudes distintas con UUID distintos.

Se conserva la semántica existente de snapshots: valores NULL de contacto/facturación heredan del maestro al construir el snapshot. Este hotfix protege los campos vaciados durante el cambio de cliente, pero no introduce una semántica nueva para suprimir datos heredados al preparar.

## Validación y límites

Evidencias locales en `output/quotes-ux-flow-v1/` del workspace padre. Instalación reproducible offline con Node 22.23.2; sin cambios de dependencias, Next ni hardening.

- Suite Node completa: 893 tests; 887 pasan y 6 omitidos existentes, cero fallos, con TZ=UTC. La ejecución inicial en Europe/Madrid detectó el test existente del kiosk que fija una conversión horaria UTC; no se modifica como parte del hotfix.
- HTTP real de la ruta con dependencias simuladas: autorización antes de escribir, tenant fijado por host, un solo RPC, normalización, conflictos y resultados inciertos. PostgreSQL se valida separadamente con roles reales.
- Reset Supabase local con todas las migraciones aplicado. Phase40–44 pasan. Phase40–43 concurrency y ocho creaciones concurrentes phase44 pasan. Se comprueban ausencia de fichas parciales, numeración única, replay después de preparar, rechazo de actor/tenant/payload incompatible y denegación de acceso directo al registro privado.
- Editor nuevo y primer borrador en 390/768/1280, light/dark: 161 comprobaciones de navegador. Edición/PDF: 278; transiciones: 392; conversión: 458. Componentes y CSS reales con dobles HTTP. Capturas inspeccionadas de las seis combinaciones; sin overflow horizontal.
- Lint y TypeScript pasan. Build de producción con Webpack pasa. `npm run build` con Turbopack se ejecutó pero falla por `binding to a port / Operation not permitted` del entorno local; no equivale a una build estándar verde y debe verificarse en CI antes de avanzar.

## Secuencia de publicación obligatoria (NO ejecutada)

1. Auditar la rama y abrir PR. CI debe quedar verde, incluida la build estándar del proyecto. No promover un deployment desde esta validación local.
2. Aplicar únicamente esta migración revisada en Supabase Production, cuando se autorice el paso operativo; mantener el deployment actual mientras tanto. Es compatible con el código anterior, cuya ruta legacy se conserva.
3. Verificar firma de RPC, SECURITY DEFINER/search_path, grants, RLS del registro privado, persistencia de la denegación INSERT(id), versión de migración y caché de schema PostgREST. Comprobar descubrimiento HTTP con autenticación normal sin crear presupuestos de prueba en Production.
4. Solo después promocionar el deployment Vercel que incluya este código. Un core, un Vercel y un Supabase para todos los tenants; ninguna excepción SUR4.

Si hay que revertir la aplicación, el código anterior puede seguir operando con la migración presente. No borrar recibos, historial o presupuestos como parte de una reversión improvisada. Production, merge y despliegue quedan fuera de esta ejecución.
