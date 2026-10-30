# Order Detail Views V1 — cuatro vistas de la ficha de pedido

Estado (30/10): **F1–F5 terminadas en la rama** `feat/order-detail-views-v1` (desde `main` f4e0ab5), validadas en local con tenants sintéticos. Sin migraciones, sin cambios en Staging ni en Production. Pendiente: revisión, integración en DEMO/Staging coordinada con la sesión operativa y autorización de merge.

## 1. Auditoría de la ficha actual (30/10)

`components/orders/detail/order-workspace.tsx` (1.569 líneas) hace tres cosas a la vez:

| Responsabilidad | Qué contiene hoy |
| --- | --- |
| Carga de datos | Pedido (`/api/orders/:id`, con `features`, presupuesto de origen), actividad, estados, opciones de gestión, opciones del pedido, contexto (rol). Refresco en vivo con `useLiveRefresh`. |
| Escritura | Borrador (`saveEditing` por pasos con `expected_version`), cambios rápidos (estado, responsable, nota), archivado, cliente (asignar, crear, editar, quitar), recuperación ante pedido archivado o versión obsoleta, confirmación de estado terminal. |
| Presentación | Avisos, `OrderHeader`, tira de post-its fijados, secuencia, presupuesto de origen, rejilla de dos columnas (Trabajo, Archivos, Post-it/Notas, Actividad · Resumen, Cobro y entrega), diálogos de cliente y de confirmación. |

Módulos ya separados, que se reutilizan tal cual: `OrderHeader` (+ `OrderQuickActions`, impresión y Resguardo), `OrderProduction`, `OrderSummary`, `OrderFulfillment` (+ `OrderCollection`), `OrderNotes`, `OrderActivity`, `OrderSourceQuote`, `OrderFilesSection`, `OrderWorkSequence`, `OrderNotesProvider` / `OrderPinnedNotesStrip` / `OrderStickyNotesPanel`.

Hallazgos que condicionan el diseño:

1. **`OrderFulfillment` carga los importes** y los entrega con `onCollectionLoaded`; la cabecera los muestra. Si una vista desmonta ese módulo (una pestaña cerrada), la cabecera se queda sin importes. Lo mismo vale para Archivos, Secuencia y Post-it, que cargan sus propios datos.
2. **Pruebas de código fuente**: `concurrency`, `archived-immutability`, `lifecycle-ux-wiring` y `files/client` leen `order-workspace.tsx` y comprueban `expected_version`, la revalidación de archivado, etc. Si la lógica se mueve, esas pruebas deben apuntar al archivo nuevo con las mismas aserciones.
3. **PR #153 (Draft)** toca la carga de actividad y estados y añade `<OrderTracking>` tras la secuencia. Choca con esta extracción.
4. **Preferencias de tenant**: `tenant_settings.preferences` (jsonb) ya guarda `quick_order_layout_v1`. La RLS `tenant_settings_update_owner_admin` limita la escritura a owner y admin, y `tenant_settings_select_member` deja leer a cualquier miembro.

## 2. Arquitectura modular

Un solo controlador, un solo juego de módulos y cinco maquetaciones que solo deciden **dónde** va cada módulo.

```text
app/orders/[id]/page.tsx
  └─ OrderWorkspace                      (orquestador, ~60 líneas)
       ├─ useOrderWorkspace()            estado, cargas y acciones (todo lo que hoy hay antes del return)
       ├─ useOrderDetailModules(ctl)     construye cada módulo UNA vez (ReactNode)
       ├─ resolveOrderDetailView()       preferencia del tenant + vista previa (owner/admin)
       └─ <Layout modules facts />       classic | operational | tabs | production | hybrid
            + diálogos comunes (cliente, confirmación terminal), siempre fuera del layout
```

### Contrato del layout (`components/orders/detail/views/contract.ts`)

```ts
type OrderDetailModules = {
  notices: ReactNode;        // solo lectura / archivado, error, guardado
  header: ReactNode;         // OrderHeader en densidad cómoda
  headerCompact: ReactNode;  // OrderHeader en densidad compacta (mismas acciones)
  pinnedNotes: ReactNode;    // null sin order_sticky_notes
  sequence: ReactNode;       // null sin order_work_sequence
  tracking: ReactNode;       // null hasta integrar #153
  sourceQuote: ReactNode;
  production: ReactNode;     // «Trabajo»
  files: ReactNode;
  summary: ReactNode;        // «Resumen» + acciones de cliente
  fulfillment: ReactNode;    // «Cobro y entrega» (carga los importes)
  stickyNotes: ReactNode;    // panel de post-its, null sin la función
  legacyNotes: ReactNode;    // «Notas internas» / «Notas anteriores»
  activity: ReactNode;
};
type OrderDetailFacts = { order; labels; features; collection; statuses; canMutate; archived; editing };
```

Reglas del contrato (cubiertas por pruebas):

- Cada layout coloca **cada módulo exactamente una vez** (`header` o `headerCompact`, no los dos). Ningún layout hace `fetch` ni crea estado de datos.
- Ocultar no es desmontar: las pestañas usan `hidden` y los bloques plegables usan `<details>`; el módulo sigue montado, conserva su estado (subidas en curso, formularios) y no vuelve a cargar.
- Los módulos condicionados por función (`sequence`, `pinnedNotes`, `stickyNotes`) llegan como `null` sin la concesión; el layout no consulta funciones por su cuenta, solo `facts.features` para textos.
- Los diálogos (cliente, confirmación terminal) los pinta `OrderWorkspace`, fuera del layout.

### Archivos

| Acción | Archivo |
| --- | --- |
| Extraer | `components/orders/detail/use-order-workspace.ts` — todo el estado, cargas y acciones de `OrderWorkspace`, sin cambios de comportamiento. |
| Extraer | `components/orders/detail/order-detail-modules.tsx` — construye `OrderDetailModules` y los diálogos. |
| Crear | `components/orders/detail/views/contract.ts`, `classic-layout.tsx` (la ficha actual, idéntica), `operational-layout.tsx` (A), `tabs-layout.tsx` (B), `production-layout.tsx` (C), `hybrid-layout.tsx` (D), `index.ts` (registro). |
| Crear | `lib/orders/detail-views.ts` — códigos, vistas seleccionables, `resolveOrderDetailView`, vista previa. |
| Crear (F4) | `lib/settings/order-detail-view.ts`, `app/api/settings/order-detail-view/route.ts`, `app/settings/order-detail-view/page.tsx`, tarjeta «Personalización» en `app/settings/page.tsx`, capturas en `public/order-detail-views/`. |
| Modificar | `order-workspace.tsx` (queda como orquestador), `order-header.tsx` (prop `density`), `app/api/orders/[id]/route.ts` (devuelve `detail_view`), las cuatro pruebas de código fuente (ruta nueva, mismas aserciones). |
| Reutilizar sin cambios | Resto de módulos, APIs, RPC, permisos, impresión, Hoja de trabajo y Resguardo. |

## 3. Las cuatro vistas

| Vista | Idea | Escritorio | Móvil |
| --- | --- | --- | --- |
| Actual (`classic`) | Fallback y predeterminada | Igual que hoy | Igual que hoy |
| A · Operativa (`operational`) | Todo a mano, poco desplazamiento | Cabecera compacta; columna principal Trabajo + Archivos; carril derecho fijo con Cobro y entrega y Resumen; abajo, plegables Post-it/Notas, Secuencia, Actividad, Presupuesto | Cabecera compacta, Trabajo, Cobro, Resumen, Archivos y plegables |
| B · Pestañas (`tabs`) | Una sección cada vez, lo crítico siempre arriba | Cabecera completa persistente + post-its fijados; pestañas Resumen · Trabajo · Archivos · Cobros · Actividad | Pestañas desplazables, mismo orden |
| C · Producción (`production`) | Qué hay que hacer ahora | Tablero de producción: estado, responsable, entrega y siguiente paso; Secuencia y Post-it lado a lado; luego Trabajo y Archivos; «Administración» plegable con Resumen, Cobro, Actividad y Presupuesto | Tablero, Secuencia, Post-it, Trabajo, Archivos, Administración |
| D · Híbrida (`hybrid`) | A + C | Cabecera compacta; arriba Secuencia y Post-it destacados; columna principal Trabajo + Archivos; carril derecho Cobro y Resumen; Actividad plegable | Cabecera, Secuencia, Post-it, Trabajo, Cobro, Resumen, Archivos, Actividad |

Sin `order_work_sequence` ni `order_sticky_notes`, C y D muestran el tablero de producción con estado, responsable, entrega y prioridad (datos que ya tiene el pedido) y no inventan módulos.

## 4. Preferencia por tenant

- Clave `tenant_settings.preferences.order_detail_view_v1 = { version: 1, view, previous_view, updated_at, updated_by }`.
- Lectura: `/api/orders/:id` añade `detail_view` (lectura de miembro por RLS). Cualquier valor ausente, inválido o no seleccionable → `classic`.
- Escritura: `PATCH /api/settings/order-detail-view`, solo owner/admin (servidor y RLS), fusiona con las demás preferencias y usa concurrencia optimista: el `UPDATE` lleva `updated_at = <revisión leída>`; si no afecta a ninguna fila, responde 409 y no pisa nada.
- **Sin migración** en V1: la RLS existente ya limita la escritura a owner/admin. Si más adelante se quiere validar el valor en base de datos, irá en una migración aparte.
- Vista previa: `?vista=<código>` en la ficha, solo owner/admin y solo vistas implementadas; no guarda nada y muestra un aviso «Vista previa».

## 5. Fases y PR

PR apiladas en Draft (30/10), cada una con base en la anterior:

| Fase | PR | Rama → base | Contenido |
|---|---|---|---|
| F1 | #171 | `…-f1` → `main` | Extracción (`useOrderWorkspace`, módulos, contrato, layout clásico). Sin cambio visible. |
| F2 | #172 | `…-f2` → `…-f1` | Vistas A y D, pruebas de contrato. |
| F3 | #173 | `…-f3` → `…-f2` | Vistas B y C. |
| F4 | #174 | `…-f4` → `…-f3` | Configuración › Vista de pedidos, API, preferencia por tenant. |
| F5 | #175 | `…-f5` → `…-f4` | E2E local, capturas, ajustes y esta documentación. |

Ninguna vista aparece como seleccionable hasta F4, con las cuatro terminadas.

## 6. Relación con #153 (Seguimiento del pedido)

#153 sigue en Draft; ni se fusiona ni se modifica su rama desde aquí.

Integración preparada en una rama **local** propia, `feat/order-detail-views-v1-tracking` (sobre F5 + merge de `feat/order-visual-tracking-v1` @ `a9b5be9`), sin publicar:

- Conflicto único en `order-workspace.tsx`, resuelto con la extracción: los estados `statusesLoading`, `statusesError`, `activityError` y `activityOrderId` y la carga de actividad única vía `loadActivity` pasan tal cual a `useOrderWorkspace`; `<OrderTracking>` ocupa el módulo `tracking` con las mismas props.
- Posición: la ficha clásica lo pone donde #153 (tras la secuencia). En A y D va en la columna principal tras Archivos; en B, dentro de «Resumen»; en C, tras Trabajo y Archivos y antes de «Administración». Arriba del todo (≈320 px) ocultaba lo propio de cada vista.
- Verificado en local: 1.654 pruebas OK, `tsc` y `lint` limpios, E2E 40/40 con un único recorrido visible y cargado en cada vista y tenant, y el smoke de #153 (`order-tracking-ui-smoke.mjs`) sin fallos.

Cuando #153 esté lista se puede (a) fusionar #153 primero y rebasar esta integración, o (b) fusionar F1–F5 primero y aplicar en #153 la resolución de esta rama. La opción se decide con la sesión de #153.

## 7. Validación (F5, 30/10)

Entorno: app de la rama en `next dev` contra un Supabase **local** aislado (89 migraciones), sin tocar Staging ni Production.

- `demo`: seed `demo-commercial.sql`, `order_sticky_notes` y `order_work_sequence` concedidas, secuencia y post-its creados con las RPC de la app; usuarios owner, admin y staff.
- `plain`: sin funciones, pocos pedidos.

Resultados:

- Pruebas unitarias: 1.635 OK, 0 fallos (con `TZ=UTC`; `lib/kiosk/form-state.test.ts` falla en hora local de Madrid también en `main`, no tiene que ver con esta rama). `tsc`, `lint` (4 avisos previos) y `next build` limpios.
- E2E local `scripts/order-detail-views-local-e2e.mjs`: **40/40**. Cubre las cinco vistas con todos los módulos y las mismas acciones; 390, 768 y 1280 px sin desplazamiento horizontal; pestañas (solo una visible, cabecera siempre); «Añadir nota» abre la pestaña o el plegable; «Editar pedido» abre «Administración» en C; pedido archivado en solo lectura; tema oscuro; valor de vista previa inválido; Configuración (aplicar con confirmación, volver a la anterior); 409 con revisión obsoleta y 400 con vista inválida; admin puede cambiarla; staff recibe la del tenant, no puede previsualizar ni cambiarla (403/404); `plain` sin secuencia ni post-its; un pedido de `demo` no se ve desde `plain`.
- Capturas reales (seed local) en `public/order-detail-views/<vista>-desktop.png` y `-mobile.png`.

Correcciones que salieron de la validación: el panel de Actividad ya se pliega solo («Actividad · N»), así que se quitó el plegable extra en A y D; en A la secuencia va sin plegable (trae su propio título); en B, `hidden` perdía contra la clase `flex` de Tailwind y las pestañas ocultas se veían; ahora la clase cambia con la pestaña y la prueba comprueba la visibilidad real.

Repetir el E2E (con la app y el Supabase local en marcha):

```bash
ODV_BASE_PORT=3100 ODV_PASSWORD=… ODV_DEMO_ORDER=<uuid> ODV_DEMO_ARCHIVED=<uuid> ODV_PLAIN_ORDER=<uuid> \
ODV_CAPTURES=public/order-detail-views PLAYWRIGHT_MODULE=<ruta>/playwright/index.mjs \
node scripts/order-detail-views-local-e2e.mjs
```

## 8. Orden de integración y CI tras cada merge

Nada de esto se ejecuta sin autorización del propietario. Siempre squash o merge desde GitHub, sin force push, y la ficha clásica como predeterminada (ningún tenant tiene la clave al fusionar).

1. **#171 (F1) → `main`.** Al fusionar, borrar la rama `…-f1` para que GitHub cambie la base de #172 a `main`.
2. **#172 (F2)**, ya con base `main` → fusionar y borrar `…-f2`.
3. **#173 (F3)** → igual.
4. **#174 (F4)** → igual. Desde aquí owner/admin ven «Personalización › Vista de pedidos».
5. **#175 (F5)** → igual.
6. **Integración con #153**, según lo acordado en §6.

Si una PR intermedia se fusiona con squash, la siguiente arrastra los commits ya incluidos: antes de fusionarla, `git rebase --onto origin/main <rama-anterior> <rama>` y push normal (rama nueva si hace falta, nunca force push sin OK).

Controles requeridos en cada PR antes de fusionar y en `main` después:

- **Release gate** (`release-gate.yml`, solo PR contra `main` y push a `main`): guarda de migraciones, `npx tsx --test`, `tsc`, `lint`, `build`; invariantes de seguridad y aislamiento entre tenants en Supabase local; recuperación de backups B1.3. Las PR F2–F5 solo lo ejecutan cuando su base pasa a ser `main`: no fusionar hasta verlo en verde.
- **pedido-v2** (`pedido-v2.yml`, por rutas: `components/orders/**`, `lib/orders/**`, `app/api/orders/**`…): pruebas, `tsc`, `lint`, `build`, SQL de pedidos y smokes de navegador (pedido v2, cobro, cliente en línea, presupuestos, recibos, texto enriquecido; con #153, también seguimiento).
- **tamara-operativa** (`tamara-operativa.yml`, rutas `app/orders/**`, `app/api/orders/**`…): F1 toca `app/api/orders/[id]`, así que también debe pasar.
- **Después de cada merge en `main`:** release gate en verde sobre el commit de `main`; la ficha clásica se ve igual en un pedido real del entorno de previsualización; el E2E local de §7 (con F4+) sigue 40/40.
- **Antes de cualquier despliegue a DEMO, Staging o Production:** autorización expresa. No hay migraciones; activar una vista es guardar la preferencia por tenant.

## 9. Rollback

- Código: cada fase es una PR independiente; revertirla devuelve la ficha anterior.
- Datos: borrar la clave `order_detail_view_v1` de `tenant_settings.preferences` (o guardar `classic`) devuelve la ficha actual a ese tenant al instante. No hay migraciones que deshacer.
