# Seguimiento visual de pedidos V1

Decisión de producto aprobada el **27/10/2026**, continuación de «Mapa visual
seguimiento». Referencia: timeline vertical con pasos realizados, estado actual
resaltado y pasos pendientes. La imagen es una referencia de presentación; sus
hitos de diseño/producción no se convierten en requisitos universales del negocio.

## Roadmap aprobado y entrega incremental

| Incremento | Alcance | Estado en esta rama |
| --- | --- | --- |
| V1.1 · Ficha interna | Timeline de solo lectura, catálogo del tenant y evidencia del audit trail | Implementado localmente, con los ajustes UX de #151 (27/10); validación abajo |
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

**Procedencia (27/10, ajustes de #151).** El commit `3be5eea` se creó en un clon
local independiente (Codex) sin rama remota. Se importó al repositorio principal
con `git fetch` desde ese clon (sin modificarlo) y los ajustes se hicieron en un
worktree propio, `~/copyflow-order-tracking-v1`, fuera del árbol de cualquier otro
checkout. `3be5eea` se conserva tal cual y los ajustes van en commits posteriores.
`origin/main` seguía en `a63cbdb` (merge-base), así que no hizo falta rebase.
Heads revisados: #146 `644bd5b`, #148 `3706955` (la revisión anterior usó
`1318891`, ya superado) y #149 `29d4eea`.

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
Estados de cada paso (`TrackingState` y `TRACKING_STATE_LABELS` en
`lib/orders/visual-tracking.ts`; el texto visible es el de la tabla):

| Estado interno | Texto en pantalla | Cuándo |
| --- | --- | --- |
| `current` | «Estado actual» | `orders.status_id` y su relación guardada. Visible aunque esté inactivo o no figure en el catálogo cargado. |
| `visited` | «Pasó por este estado» | Hay evidencia de presencia en `order.created` o `order.status_changed` de ese pedido y entidad (también el estado anterior explícito de una transición, sin fecha). **Presencia, no finalización.** |
| `pending` | «Pendiente» | Estado posterior sin evidencia en un pedido no terminal. Referencia al catálogo, no promesa ni transición obligatoria. |
| `unconfirmed` | «Sin registro» | Sin evidencia y anterior a la posición actual; en pedidos cancelados/entregados, todo paso no acreditado. |

- Reapertura y retrocesos: cada paso lleva `beyondCurrent` (situado después del
  actual en el orden del catálogo; dato de presentación, no prueba de transición).
  Un paso `visited` con `beyondCurrent` —p. ej. Terminado tras volver a En
  producción, o Entregado/Cancelado tras reabrir— se dibuja con icono de historial
  y borde discontinuo, **nunca con ✓**. Los visitados anteriores al actual llevan ✓
  atenuado. El historial detallado conserva todas las repeticiones; la tarjeta
  resume cada estado una sola vez.
- Cancelación: desenlace alternativo cuando está registrada o es actual. No aparece
  como siguiente paso normal ni completa la vía de entrega. Sin aviso adicional: el
  paso actual ya dice «Cancelado».
- Inactivos: se muestran si son actuales o tienen evidencia, con la nota «Estado
  desactivado»; se omiten los no visitados. Si falta una opción histórica, se usa el
  nombre del evento; si falta el nombre, «Estado histórico».
- Archivo: no añade un hito ni inventa entrega; el timeline sigue visible. Sin aviso
  en la tarjeta: la cabecera ya muestra «Archivado».

Fechas: solo se muestran las entradas explícitas de `new_values.status_id` con
`activity_log.created_at` válido; para repeticiones se usa la última entrada
registrada. No se usa la fecha de salida como fecha de entrada del estado anterior.
Texto: «Desde el …» en el estado actual y «Registrado el …» en los visitados. Sin
evidencia temporal: «Sin fecha registrada» solo en el estado actual (en visitados no
se añade línea). No se estiman duraciones, porcentajes, ETA ni fechas a partir de
`due_at`, `received_at`, `ready_at` o `delivered_at` (las dos últimas son sticky y no
identifican estados configurables). Cuando el historial aún no refleja el estado
guardado, no se reutiliza la fecha de una visita anterior como entrada actual.

Textos de la tarjeta (ajuste de #151): título «Seguimiento del pedido», apoyo
«Consulta el estado y los pasos registrados.» y enlace «Ayuda» a
`/ayuda/pedidos/estados-y-prioridades#consultar-el-seguimiento`, donde está la
explicación (fechas, reaperturas, cancelación, inactivos). En estado normal no hay
texto permanente adicional; solo aparecen «Cargando seguimiento…» o «No se pudo
cargar el seguimiento completo. Se muestra el estado actual.».

Disposición: móvil y tableta, nombre arriba y situación/fecha debajo; desde `lg`
(1024 px), rejilla de columnas fijas `14rem · 9.5rem · resto` (nombre · situación ·
fecha) dentro de `max-w-3xl`, alineada entre filas. Antes la situación quedaba en el
extremo derecho de la tarjeta (`justify-between`).

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

Lista ordenada semántica, un `aria-current="step"`, etiquetas de texto que no
requieren distinguir colores ni iconos (los iconos son `aria-hidden`), `<time
dateTime>`, región `aria-live="polite"` siempre montada (visualmente oculta cuando
está vacía, para que se anuncien carga y error), nombres largos con salto de línea y
distribución vertical adaptable. Se heredan los colores y temas de GESTCOPY. El único
elemento con foco es el enlace «Ayuda» (nombre accesible «Ayuda sobre el seguimiento
del pedido», anillo de foco visible). Las acciones de teclado existentes conservan sus
permisos y confirmación. Atributos de test estables: `data-tracking-status` en la
lista y `data-step-state` / `data-beyond-current` en cada paso.

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

### Ajustes de #151 · validación local del 27/10/2026 (código en `73513e1`)

Node **22.23.2**, `npm ci` sin cambios en `package.json` ni en el lockfile, worktree
`~/copyflow-order-tracking-v1`. Sustituye a la validación anterior de `3be5eea`
(14 tests de lógica, 43 escenarios de navegador y build solo con Webpack).

| Comprobación | Resultado |
| --- | --- |
| Lógica de seguimiento | **19/19**: los 14 anteriores + avance normal, vuelta atrás, reapertura tras Entregado, reapertura tras Cancelado y textos exactos |
| Suite general (`TZ=UTC npx tsx --test`) | 1.373: **1.367 pasan, 0 fallan**, 6 omitidas (arnés PostgREST opcional, preexistente) |
| Ayuda (`lib/help/*.test.ts`) | 27/27; el artículo se interpreta con el ancla `consultar-el-seguimiento` |
| TypeScript | `tsc --noEmit` correcto; comprobación de tipos del build correcta |
| Lint | 0 errores; 4 avisos previos en `lib/orders/quote-situation.test.ts` |
| Compilación | **`TZ=UTC npm run build` con Turbopack correcto** (Next 16.3.4, compilado en 10,8 s, 155 páginas). El aviso `CRON_SECRET` durante la generación es previo: no hay secretos locales |
| Guarda de migraciones | PASS, base `a63cbdb`, 0 cambios |
| Navegador de seguimiento | **49/49**: 390/768/1280 px × claro/oscuro × viewer, legacy, cancelado, archivado, nombres largos, **reapertura**, fallo de actividad y de catálogo (con recuperación); guardar estado por teclado y recargar. Nuevas comprobaciones: ningún texto técnico en pantalla; sin ✓ en pasos posteriores al actual; distancia nombre→situación < 320 px a 1280 px; enlace de ayuda alcanzable con Tab y con anillo de foco visible |
| Regresión de ficha/cobros | 234 aserciones correctas a 390 y 1280 px (`scripts/order-collection-ui-smoke.mjs`) |
| Revisión visual | Capturas de viewer y reapertura a 390 y 1280 px, en claro y oscuro |

### Compatibilidad con las PR abiertas (heads del 27/10)

`git merge-tree --write-tree`, sin modificar ramas ni hacer merge:

| Combinación | Resultado |
| --- | --- |
| V1.1 + #146 `644bd5b` | Sin conflictos. `.github/workflows/pedido-v2.yml` se fusiona solo (ambas añaden scripts en líneas cercanas). `app/api/orders/route.ts` también se autofusiona, pero entre #146 y `main` (#146 parte de `9168c89`), no por V1.1 |
| V1.1 + #148 `3706955` | Sin conflictos; no comparten archivos |
| V1.1 + #149 `29d4eea` | Sin conflictos; no comparten archivos |
| #146 + #148 + V1.1 | Árbol combinado en un worktree temporal (commit sin rama, eliminado después): `tsc` correcto; 1.412 tests, **1.406 pasan, 0 fallan**, 6 omitidas; lint 0 errores; smokes de seguimiento 49/49, cobros 234 aserciones y rich text de #146 a 390/1280 px correctos |

### Pendiente (requiere autorización)

- CI remota (`Release gate` y `Pedido V2`): necesita publicar la rama, lo que genera un Preview de Vercel.
- Preview de Vercel y smoke autenticado en Staging con `demo` y `sur4`, incluido el aislamiento entre tenants con datos desplegados.
- Datos reales: no se ha leído ni escrito nada de Staging ni de Production.
- Lectores de pantalla reales (VoiceOver/NVDA): solo se han comprobado de forma automatizada la estructura ARIA y el teclado.

Reproducir con Node 22 y las dependencias fijadas del repositorio:

```sh
TZ=UTC npx tsx --test
npx tsc --noEmit
npm run lint
TZ=UTC npm run build
RELEASE_GATE_BASE=a63cbdb npx tsx ci/release-gate/check-migrations.ts
PLAYWRIGHT_MODULE=/ruta/absoluta/playwright/index.mjs node scripts/order-tracking-ui-smoke.mjs
PLAYWRIGHT_MODULE=/ruta/absoluta/playwright/index.mjs node scripts/order-collection-ui-smoke.mjs
```

El navegador usa la ficha y el CSS reales con respuestas HTTP locales sintéticas;
no valida conectividad ni datos desplegados.

## Integración

La rama no se publica en esta entrega: el repositorio tiene integración con Vercel
y subirla o abrir la PR puede generar un Preview. Queda local, revisable, sin merge,
despliegue ni cambios de entornos.

### Descripción propuesta de la PR

Título: `feat(orders): seguimiento visual del pedido en la ficha interna (V1.1)`

~~~markdown
## Qué cambia

Nueva tarjeta **Seguimiento del pedido** en la ficha interna, de solo lectura,
entre la cabecera y las secciones operativas. Cierra la parte V1.1 de #151.

- Usa el catálogo `order_statuses` del tenant y el historial de actividad real
  (`order.created` / `order.status_changed`). No hay estados paralelos.
- Cada paso: «Estado actual», «Pasó por este estado», «Pendiente» o «Sin registro».
  Un estado visitado no se presenta como completado: tras volver atrás o reabrir,
  los pasos posteriores al actual llevan icono de historial, nunca ✓.
- Fechas solo con registro («Desde el…», «Registrado el…»); nunca estimadas.
- `Terminado` y `Entregado` siguen separados; la cancelación es un desenlace
  alternativo; los pedidos archivados conservan el seguimiento.
- Escritorio compacto (columnas fijas desde `lg`), móvil apilado, claro/oscuro.
- La explicación está en la ayuda (`/ayuda/pedidos/estados-y-prioridades`), enlazada
  desde la tarjeta.
- `OrderWorkspace` unifica la carga de actividad (aborto y errores coherentes).

## Qué no cambia

Sin migraciones, rutas nuevas, escrituras, permisos ni dependencias. Reutiliza
`GET /api/order-statuses` y `GET /api/orders/[id]/activity`. La consulta pública
(V1.2) no está implementada.

## Pruebas

- Lógica: 19/19 · suite general 1.367/1.373 (6 omitidas, preexistentes) · `tsc` · lint 0 errores.
- Build con Turbopack correcto · guarda de migraciones: 0 cambios.
- Navegador local: 49 escenarios (390/768/1280 px, claro/oscuro, roles, legacy,
  cancelado, archivado, reapertura, fallos y teclado) + regresión de cobros (234).
- Compatibilidad: sin conflictos con #146, #148 y #149; árbol #146+#148+V1.1 en verde.
- Pendiente: CI remota, Preview y validación en Staging con `demo` y `sur4`.

## Reversión

Solo frontend y documentación: revertir el merge o rollback de Vercel. No hay estado
de base de datos que deshacer.

Refs #151

🤖 Generated with [Claude Code](https://claude.com/claude-code)
~~~

### Checklist de integración

- [ ] Autorización para publicar la rama (genera Preview de Vercel).
- [ ] Push de `feat/order-visual-tracking-v1`, sin force.
- [ ] Abrir la PR contra `main` con la descripción propuesta (draft hasta tener CI).
- [ ] CI `Release gate` en verde (guarda de migraciones, tests, `tsc`, lint, build Turbopack, base de datos).
- [ ] CI `Pedido V2` en verde (incluye `scripts/order-tracking-ui-smoke.mjs`).
- [ ] Revisar el Preview: ficha de pedido en móvil y escritorio, claro y oscuro.
- [ ] Justo antes del merge, volver a comprobar `main` y los heads de #146/#148 con `git merge-tree`; si #146 entra antes, relanzar `Pedido V2`.
- [ ] Añadir Novedades (`lib/help/changelog.ts`) con la fecha real del merge. No va en esta rama para no chocar con #148, que también lo modifica.
- [ ] Autorización explícita de merge y, por separado, de Production.
- [ ] Validación posterior con `demo` y `sur4` (abajo) y actualización de #151.

### Validación posterior con `demo` y `sur4`

Con usuarios autorizados de cada tenant y después del despliegue autorizado.

`demo` (datos de prueba; se pueden crear pedidos):

1. Pedido nuevo: Recibido → En producción → Terminado → Entregado. Pasos anteriores
   con ✓ y «Registrado el…»; estado actual con «Desde el…».
2. Vuelta atrás: Terminado → En producción. Terminado con icono de historial y sin ✓;
   Entregado «Pendiente».
3. Cancelar un pedido y después reabrirlo: Cancelado aparece como «Pasó por este estado».
4. Archivar un pedido: el seguimiento sigue visible y sin acciones nuevas.
5. Usuario de solo lectura: ve el seguimiento y no puede cambiar el estado.
6. Móvil, tableta y escritorio; tema claro y oscuro; navegación con teclado.

`sur4` (datos reales: **solo lectura**, sin cambiar estados para probar):

1. Abrir 3–5 pedidos existentes (uno anterior al registro de actividad, uno entregado
   y uno cancelado si existe). Comprobar que nombres y orden son los del catálogo de
   SUR4, que no se inventan fechas («Sin registro», «Sin fecha registrada») y que
   Terminado y Entregado se distinguen.
2. Cualquier prueba de reapertura se hace en `demo`.

Aislamiento entre tenants:

- Con sesión de `demo`, abrir la URL de un pedido de `sur4` y su
  `/api/orders/<id>/activity` → sin datos (404); y al revés.
- El catálogo de estados mostrado corresponde siempre al tenant de la sesión.

### Riesgos

1. **Orden del catálogo.** `beyondCurrent` usa `sort_order`, que es preferencia de
   presentación, no prueba de transición. Con un catálogo poco lineal, un paso
   visitado puede mostrarse con icono de historial; el texto («Pasó por este estado»)
   es el mismo y la ayuda lo explica.
2. **Pedidos antiguos sin actividad.** Verán bastantes «Sin registro» y «Sin fecha
   registrada». Es intencionado: no se inventan pasos ni fechas.
3. **Workflow compartido con #146** (`pedido-v2.yml`): fusión automática comprobada;
   si #146 cambia, volver a comprobarla.
4. **Navegación entre fichas sin desmontar la página.** Un desajuste momentáneo entre
   pedido e historial se mostraría como «No se pudo cargar…» hasta completar la carga.
   Hoy no hay enlaces de una ficha de pedido a otra; riesgo bajo.
5. **Rendimiento.** Sin peticiones nuevas: reutiliza el catálogo y la actividad que la
   ficha ya cargaba. El cálculo es lineal sobre el historial completo
   (`list_order_activity` no tiene límite).
6. **Smoke nuevo en CI.** Playwright puede ser sensible a tiempos; usa atributos
   `data-*` estables y zona horaria fija.

### Reversión

- No hay migraciones, datos ni permisos que deshacer en Supabase.
- Antes del merge: cerrar la PR; la rama queda disponible.
- Tras el merge: PR de reversión con `git revert -m 1 <merge>`.
- En Production: rollback instantáneo de Vercel al deployment de producción anterior
  (el vigente antes del merge; el 27/10 era el de `a63cbdb`) y después la reversión en
  `main`.
- Parcial: quitar `<OrderTracking … />` de `order-workspace.tsx` oculta la tarjeta sin
  afectar al resto de la ficha.
