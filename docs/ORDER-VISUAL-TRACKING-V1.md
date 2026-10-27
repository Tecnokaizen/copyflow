# Seguimiento visual de pedidos V1

Decisión de producto aprobada el **27/10/2026**, continuación de «Mapa visual
seguimiento». Referencia: timeline vertical con pasos realizados, estado actual
resaltado y pasos pendientes. La imagen es una referencia de presentación; sus
hitos de diseño/producción no se convierten en requisitos universales del negocio.

## Roadmap aprobado y entrega incremental

| Incremento | Alcance | Estado en esta rama |
| --- | --- | --- |
| V1.1 · Ficha interna | Timeline de solo lectura, catálogo del tenant y evidencia del audit trail | Implementado localmente; validación abajo |
| V1.2 · Consulta pública | Token opaco revocable, proyección pública mínima y rutas separadas | Diseño propuesto en este documento; sin implementar ni activar |
| Validación e integración | Revisar móvil/escritorio, roles y combinación con PR activas; autorizar Staging y después Production | Pendiente de autorización de los despliegues |

Orden: ficha interna → validación → consulta pública. No bloquea ni integra las
otras PR del roadmap. No añade hitos como «Diseño aprobado» salvo que estén en
`order_statuses` del tenant. No envía avisos ni genera enlaces públicos en V1.1.

## Estado real revisado

Base de esta rama: `main` **`a63cbdb`**, recuperado de GitHub el 27/10. El checkout
local principal estaba en `7d4f3a9` y contenía cambios de otras tareas: se conserva
intacto. Trabajo aislado en `feat/order-visual-tracking-v1`.

- #147 (R5, escrituras de pedidos por RPC controladas) ya está integrada.
- #138 (concesiones por tenant), #135/#136 (billing) y la portadora SQL #150 ya
  están en `main`. La app de voz #90 sigue en draft.
- #146 (estilos de instrucciones/notas) y #148 (elegibilidad del responsable)
  siguen abiertas; conservar sus cambios al integrar. Esta funcionalidad no
  cambia esas reglas ni el contenido de los pedidos.
- Otras PR abiertas consultadas: #149 (E2E de presupuestos), #139 (listas),
  #140 (nota histórica), #134/#133 (ADR comerciales/presupuestos), #32/#11/#2
  (trabajo aparcado). No se fusiona ninguna.
- Los handoffs del 16/10 describen su fecha de cierre. No son un inventario actual
  de funcionalidades ausentes: por ejemplo, líneas e importación ya tienen
  código/documentación en la base revisada.

Es una revisión de repositorio/PR, **no una auditoría de los entornos desplegados**.
No se han consultado ni escrito datos de Staging o Production.

## Fuente de verdad y arquitectura

Prevalece [Arquitectura inmutable de Copyflow](Arquitectura%20inmutable%20de%20Copyflow.md):
**un codebase, un proyecto Vercel y su deployment de producción, un proyecto
Supabase y PostgreSQL compartido para N tenants**. Staging es un entorno de
validación; no representa infraestructura por tenant.

Se contrastaron las fuentes sincronizadas del proyecto (arquitectura, instrucciones,
PRD SUR4 y fuentes oficiales). SUR4/Sites/Airtable aporta referencia operativa;
el núcleo GESTCOPY utiliza Supabase y no añade una integración con Airtable.
La separación **Terminado = preparado** / **Entregado = recibido por el cliente**
es obligatoria.

Las referencias oficiales consultadas el 27/10 siguen respaldando el modelo:
[Vercel Multi-Tenant Platforms](https://vercel.com/docs/platforms/multi-tenant-platforms)
y [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
El contrato de aislamiento del proyecto es `tenant_id` + memberships + autorización
+ RLS; no se crean proyectos, conexiones ni forks por organización.

## V1.1 · Comportamiento implementado

La ficha muestra «Seguimiento del pedido», después de la cabecera y antes de las
secciones operativas. Es informativa, también para viewer y pedidos archivados.
El borrador de edición no adelanta el seguimiento: se usa el pedido guardado.

- Opciones: el `GET /api/order-statuses` existente entrega el catálogo del tenant,
  con `sort_order`, nombre, activo y flags. Se reutilizan esas opciones, sin
  cambiar su configuración ni añadir una máquina de estados paralela.
- Actual: `orders.status_id` y su relación guardada. Se mantiene visible aunque
  esté inactivo o no figure en el catálogo cargado.
- Completado: existe evidencia de presencia en ese estado en `order.created` o
  `order.status_changed`, para ese pedido y entidad. También sirve el estado
  anterior explícito de una transición, sin atribuirle fecha de entrada.
- Sin paso registrado: un paso sin evidencia anterior a la posición actual; en
  pedidos cancelados/entregados, todo paso no acreditado recibe esta etiqueta.
- Pendiente: estados posteriores sin evidencia en pedidos no terminales. Es una
  referencia al catálogo configurable, no una promesa ni una transición obligatoria.
- Reapertura: se conserva la evidencia de los pasos visitados y se destaca el
  estado guardado actual. «Completado · paso registrado» significa que el pedido
  estuvo ahí, no que siga terminado o entregado. El historial detallado existente
  conserva todas las repeticiones; la tarjeta resume cada estado una sola vez.
- Cancelación: se presenta como desenlace alternativo cuando está registrada o es
  actual. No aparece como un siguiente paso normal ni completa la vía de entrega.
- Inactivos: se muestran si son actuales o tienen evidencia; se omiten los no
  visitados. Si falta una opción histórica, se usa el nombre del evento y se
  identifica como inactiva; si falta el nombre, «Estado histórico».
- Archivo: no añade un hito operativo ni inventa entrega; mantiene consulta.

Fechas: solo se muestran las entradas explícitas de `new_values.status_id` con
`activity_log.created_at` válido; para repeticiones se usa la última entrada
registrada. No se usa la fecha de salida como fecha de entrada del estado anterior.
Sin evidencia temporal: «Fecha de entrada no registrada». No se estiman duraciones,
porcentajes, ETA ni fechas a partir de `due_at`, `received_at`, `ready_at` o
`delivered_at` (las dos últimas son sticky y no identifican estados configurables).
Cuando el historial aún no refleja el estado guardado, no se reutiliza la fecha de
una visita anterior como entrada actual.

## Carga, seguridad y accesibilidad

Se reutilizan las rutas de lectura autenticadas de ficha, catálogo y actividad.
No se añaden rutas, escrituras, migraciones, credenciales ni permisos. La ficha
verifica contexto/membership y filtra pedido y catálogo por `tenant_id`. La ruta
de actividad primero comprueba pedido + tenant y usa `list_order_activity`, que
deriva el tenant del pedido y exige membership; conserva su grant a authenticated,
su cierre a anon y el alcance de `entity_id`/`entity_type`/tenant del audit trail.
El cambio de estado sigue usando `change_order_status_v2`, versión opaca,
protecciones R5 y auditoría existentes. El nombre interno `toPublicOrderDto` de la
ficha **no** convierte su DTO en apto para acceso público.

Se unifica la carga duplicada de actividad en `OrderWorkspace`: carga inicial,
mutaciones y refresh utilizan el mismo control de aborto y error. Un historial
fallido o catálogo fallido presenta solo el estado actual y un mensaje explícito;
la recuperación por refresh restaura el recorrido. El historial de otro pedido se
rechaza por su identificador; una respuesta abortada no sustituye la vigente.

Lista ordenada semántica, un `aria-current="step"`, etiquetas e iconos que no
requieren distinguir colores, `<time dateTime>`, mensajes de carga/error con
`aria-live="polite"`, nombres largos con salto de línea y distribución vertical
adaptable. Se heredan los colores y temas de GESTCOPY. No hay controles decorativos
con foco. Las acciones de teclado existentes conservan sus permisos y confirmación.

## V1.2 · Diseño de consulta pública (no implementado)

El visitante no obtiene membership ni acceso a tablas o a la ficha interna. El
token será una capacidad de **lectura de la proyección pública de un único pedido**.
No servirá para editar, ver archivos, cobrar ni consultar otros pedidos.

1. **Emisión autenticada:** acción explícita con permiso de escritura de pedidos,
   tenant de la sesión y pedido verificado, nunca tenant del cuerpo. Token con
   `crypto.randomBytes(32)` (256 bits), codificado base64url; no UUID de pedido,
   referencia, email, slug, JWT con datos legibles ni contador secuencial. Su emisión
   no envía correos ni WhatsApp automáticamente.
2. **Persistencia propuesta:** concesión en esquema privado de la misma BD,
   `id`, `tenant_id`, `order_id`, `token_hash` único (SHA-256 del token aleatorio),
   `created_by`, `created_at`, `expires_at`, `revoked_at`; FK compuesta
   `(tenant_id, order_id)` a pedidos. Solo se devuelve el token bruto una vez.
   Nunca se guarda en texto plano, audit trail, analítica ni logs.
3. **Permisos:** concesiones con RLS y sin grants directos para anon/authenticated.
   Emisión/revocación por RPC autenticadas y auditadas que comprueban membership,
   tenant y rol. Resolución mediante una función `SECURITY DEFINER` estrecha,
   `search_path = ''`, SQL estático, solo proyección explícita; no acceso directo a
   `orders` ni `activity_log` para visitantes. Propuesta de ejecución: un rol de
   backend dedicado con permiso solo EXECUTE de esa función, sin SELECT de tablas
   ni rol de servicio general. Revisar este rol y su conexión en el ADR de V1.2;
   no crear infraestructura ni una conexión diferente por tenant.
4. **Alcance:** la función recibe digest + tenant resuelto desde hostname validado;
   exige coincidencia de token, pedido y tenant, expiración y no revocación. El
   token no permite cambiar de tenant añadiendo parámetros. Solo acepta un token,
   sin filtros, rangos, búsqueda ni listado. Rotación revoca la capacidad anterior
   en la misma transacción. Desactivar el tenant o revocar la concesión corta acceso.
5. **Transporte propuesto:** enlace `https://<tenant>/seguimiento#<token>`; el
   fragmento no llega al servidor en el GET. Página mínima, sin scripts de terceros;
   lee el token y lo retira del historial con `history.replaceState`. Consulta por
   POST de mismo origen, sin token en ruta/query. Limitar cuerpo, validar origen,
   formato y longitud, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
   `noindex`, CSP restrictiva y redacción del token/cuerpo en logs. Revisar el registro
   de cuerpos en proxy/APM antes de activar; no persistir token en localStorage.
6. **Abuso:** rate limit persistente compartido por IP/origen y digest, límites de
   concurrencia y respuesta uniforme para ausente/incorrecto/caducado/revocado/
   tenant ajeno. No registrar intentos ilimitados en la BD. La revocación debe ser
   efectiva sin esperar una caché. Pruebas de enumeración, filtración y cuota.
7. **Proyección pública por lista blanca:** marca comercial pública, referencia si
   se aprueba como identificador visible y pasos públicos con estado/fechas
   acreditados. Publicar nombres exige configuración explícita por tenant: un
   estado interno puede contener información sensible y no es automáticamente
   público. V1.2 debe añadir mapping/etiqueta pública y visibilidad al catálogo;
   fallback seguro = «Estado no publicado», sin copiar nombres internos ni afirmar progreso.
8. **Nunca exponer:** descripción/instrucciones, notas internas, datos del cliente,
   responsable/actor, UUID internos/tenant_id, auditoría cruda, importes, márgenes,
   cobros, documentos, rutas o URLs de R2/Drive, relación con presupuesto ni permisos.
   Crear un DTO público nuevo; no reutilizar el de la ficha autenticada ni devolver
   objetos por spread. La selección y el cálculo de evidencia se hacen en backend.
9. **Audit trail:** emisión, rotación y revocación con usuario/pedido/tenant y el ID
   de concesión (sin secreto). Las lecturas no se insertan en el timeline del pedido.

Antes de implementar V1.2: ADR del rol/RPC, mapping público, duración y revocación
propuestas, fixtures de dos tenants y tests de RLS, acceso anónimo, caducidad,
rotación, respuesta uniforme y ausencia de campos internos. Valores iniciales
propuestos: 30 días de vigencia, configurable dentro de un máximo validado por el
servidor; revocación manual disponible desde emisión. No son permisos activos.

## Validación

Validación local del 27/10/2026, con Node **22.23.2** y `npm ci` sin cambios en
`package.json` ni en el lockfile:

| Comprobación | Resultado |
| --- | --- |
| Lógica nueva de seguimiento | 14/14: saltos, legacy, Terminado/Entregado, creación, orden de eventos, reapertura, datos ajenos, inactivos, fechas inválidas y ausencia de inferencia por campos sticky |
| Suite general (`TZ=UTC node --import tsx --test`) | 1.362 pasan, 0 fallan, 6 omitidas (arnés PostgREST opcional preexistente); 1.368 en total |
| TypeScript | `tsc --noEmit` correcto y comprobación de tipos del build correcta |
| Lint | 0 errores; 4 avisos previos en `lib/orders/quote-situation.test.ts` |
| Navegador de seguimiento | **43/43**: 390/768/1280 px, claro/oscuro; viewer, legacy, cancelado, archivado, nombres largos, fallos de actividad/catálogo, recuperación y guardar por teclado + recargar |
| Regresión de ficha/cobros existente | 234 aserciones correctas a 390 y 1280 px (`scripts/order-collection-ui-smoke.mjs`) |
| Guarda de migraciones | PASS, 0 cambios de migraciones |
| Compilación | `npm run build -- --webpack` correcto, con generación de páginas y tipos |

Compatibilidad estructural local (`git merge-tree`, sin modificar ramas ni hacer
merge): combinación con #146 (`644bd5b`) y con #148 (`1318891`), ambas sin conflictos.
No equivale a ejecutar las suites sobre esos árboles combinados.

Revisadas visualmente las capturas móvil/claro y escritorio/oscuro. El script nuevo
está añadido al workflow `Pedido V2`; **CI remota no ejecutada** en esta entrega.
Turbopack (`npm run build` por defecto) no pudo validarse aquí: el proceso de CSS
falla con `EPERM` al abrir su puerto interno. Primero apareció también la restricción
de descarga de Geist; el build alternativo con Webpack y acceso a la fuente sí
finalizó. No se cambia la configuración de build ni se presenta el resultado de
Webpack como una ejecución de Turbopack. El gate normal queda para CI autorizada.

Reproducir con Node 22 y las dependencias fijadas del repositorio:

```sh
TZ=UTC node --import tsx --test
npx tsc --noEmit
npm run lint
TZ=UTC npm run build
PLAYWRIGHT_MODULE=/ruta/absoluta/playwright/index.mjs node scripts/order-tracking-ui-smoke.mjs
```

El navegador usa la ficha y CSS reales con respuestas HTTP locales sintéticas;
no valida conectividad ni datos desplegados. Deben aprobarse y ejecutarse por
separado el smoke autenticado de dos tenants en Staging y cualquier despliegue.

No se sube la rama durante esta entrega: el repositorio tiene integración con
Vercel y subirla/abrir PR puede generar un Preview. Se conserva el cambio en una
rama y commit locales revisables, sin merge, deploy ni cambios de entornos.
