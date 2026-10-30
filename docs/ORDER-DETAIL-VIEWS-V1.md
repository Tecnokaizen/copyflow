# Order Detail Views V1 — cuatro vistas de la ficha de pedido

Estado: **Fase 1 en curso** (rama `feat/order-detail-views-v1`, desde `main` f4e0ab5). Sin migraciones, sin cambios en Staging ni en Production.

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

1. **F1** — extracción (`useOrderWorkspace`, módulos, contrato, layout clásico). Sin cambio visible. PR propia.
2. **F2** — A y D, pruebas de contrato y de paridad, capturas 390/768/1280.
3. **F3** — B y C.
4. **F4** — selector en Configuración, API, capturas reales, vista previa, confirmación y «volver a la anterior».
5. **F5** — E2E con tenants sintéticos, roles, funciones on/off; integración en DEMO/Staging coordinada con la sesión operativa.

Ninguna vista aparece como seleccionable hasta F4, con las cuatro terminadas.

## 6. Relación con #153

#153 sigue en Draft y no se fusiona aquí. Al integrarla: sus mejoras de carga (estado de error de actividad y estados) van en `useOrderWorkspace`, y `<OrderTracking>` va en el módulo `tracking`, que ya colocan las cinco maquetaciones.

## 7. Rollback

- Código: cada fase es una PR independiente; revertirla devuelve la ficha anterior.
- Datos: borrar la clave `order_detail_view_v1` de `tenant_settings.preferences` (o guardar `classic`) devuelve la ficha actual a ese tenant al instante. No hay migraciones que deshacer.
