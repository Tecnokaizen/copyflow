# GESTCOPY_V1_AUDIT_SUMMARY

Cruce de las cinco auditorías READ-ONLY B–F.

**Revisión arquitectónica (2026-09-16):** aceptada en [PR #11](https://github.com/Tecnokaizen/copyflow/pull/11#pullrequestreview-5223885331). Este documento permanece como mapa técnico. El plan de Lifecycle está preparado y **no se implementa** hasta el merge de #10.

| Campo | Valor |
|--------|--------|
| Fecha | 2026-09-16 |
| Rama inspeccionada por los agentes | principalmente `cursor/order-work-card-ux-5d7f` / workspace local; Kiosk documentado desde PR #10 |
| Informes fuente | Lifecycle, Editing, Files, Settings, Permissions |
| Kiosk | PR [#10](https://github.com/Tecnokaizen/copyflow/pull/10) · CODE FREEZE · HEAD `0c9d20a72ffe7bb0ccaf322ca62e17444ba5f08f` |
| Spec Lifecycle | `docs/superpowers/specs/2026-09-16-gestcopy-lifecycle-v1-design.md` |
| Plan Lifecycle | `docs/superpowers/plans/2026-09-16-gestcopy-lifecycle-v1.md` |
| Spec Quick Order Layout | `docs/superpowers/specs/2026-09-16-gestcopy-quick-order-layout-v1-design.md` |
| Plan Quick Order Layout | `docs/superpowers/plans/2026-09-16-gestcopy-quick-order-layout-v1.md` |
| Estado operativo | ver `docs/GESTCOPY_PROJECT_NOTES.md` |

---

## 0. Project notes (snapshot)

```text
CURRENT_BLOCK:   Kiosk V1 — Release Candidate / smoke pendiente
OPEN_PR:         #10
ARCHITECT:       decisiones 1–12 aceptadas (PR #11)
PREPARED:        spec + plan Lifecycle V1 (gated a merge #10)
                 QUICK_ORDER_LAYOUT_V1 (paralelo posible; espera arquitecto)
NEXT_GATE:       Smoke DEMO correcto → merge #10 → hotspots → implementar Lifecycle
```

---

## 1. Veredicto cruzado (para el arquitecto)

El núcleo actual es coherente con el checkpoint MVP: **estados por flags** (`is_initial` / `is_ready` / `is_closed` / `is_cancelled`), mutaciones de pedido vía RPC operativo, Personal ≠ rol de acceso, staff operativo y viewer de solo lectura en escritura.

Los cinco informes coinciden en que **V1 no necesita un rediseño de schema**. Lo que sí hay es un conjunto pequeño de **decisiones de producto** y un orden de serialización estricto alrededor de Kiosk y de RLS en `orders`.

Tres hallazgos que cruzan más de un informe y no deben tratarse como “deuda local”:

1. **`orders_update_operator` permite UPDATE directo de `status_id`** (y timestamps) sin pasar por `change_order_status`. Lifecycle lo marca como riesgo de integridad SUR4; Editing confirma el dual-path INSERT vs RPC; Permissions confirma que los PATCH Next no re-chequean rol.
2. **`list_order_activity` (SECURITY DEFINER + `is_tenant_member`) abre el historial del pedido a viewer**, mientras `/activity` y `activity_log_select_supervisors` son solo gestión. Permissions lo prioriza; Editing y Lifecycle lo registran como asimetría.
3. **`create_organization` no siembra catálogos de gestión** (`file_statuses`, `quote_statuses`, `payment_statuses`, `delivery_methods`, `order_contexts`). Files y Settings lo marcan como hueco de onboarding; Editing lo ve como “defaults que parecen no persistir”; Lifecycle lo ve como riesgo de configuración (cero `is_initial` rompe create y kiosk).

**Cierre de decisiones (arquitecto):** el bypass de `status_id`/timestamps **sí** se cierra en Lifecycle V1. Viewer **conserva** el historial del pedido; no se iguala a `/activity`. El seed de `create_organization` **no** va en Lifecycle. Storage, Settings y `row_version` quedan fuera. Ver spec.

---

## 2. Dependencias entre dominios

```text
                    ┌──────────────┐
                    │  Permissions │  matriz rol × capacidad
                    │  (contrato)  │
                    └──────┬───────┘
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
     ┌──────────┐   ┌────────────┐   ┌──────────┐
     │ Lifecycle│◄──┤  Editing   │──►│  Files   │
     │ status   │   │ draft/PATCH│   │ catálogo │
     └────┬─────┘   └─────┬──────┘   └────┬─────┘
          │               │               │
          └───────┬───────┴───────┬───────┘
                  ▼               ▼
            ┌──────────┐    ┌──────────┐
            │ Settings │    │ Kiosk #10│
            │ catálogos│    │ FREEZE   │
            └──────────┘    └──────────┘
```

| Desde → Hacia | Acoplamiento real hoy | Qué pasa si se toca en paralelo |
|---------------|------------------------|----------------------------------|
| **Permissions → Lifecycle** | `change_order_status` usa `owner\|admin\|manager\|staff`. UI `canWriteOrders`. Viewer 403 en RPC. | Cambiar staff≠manager en la ficha **antes** de documentar la matriz rompe Mostrador/Mis pedidos. |
| **Permissions → Editing** | Misma matriz en todos los `change_order_*` y `assign_order_client`. Staff = manager en la ficha. | Cualquier recorte de staff hay que aplicarlo en RPC **y** en `order-workspace` / quick actions. |
| **Permissions → Settings** | RLS de catálogos = management (`owner/admin/manager`). UI Settings no existe. `/team/access` es owner/admin. | Una pantalla Settings “admins only” **diverge** de RLS actual (manager ya puede escribir catálogos vía cliente Supabase). |
| **Permissions → Files** | `file_statuses_*_management` + `change_order_management` operativo. | Storage futuro reutiliza `is_tenant_member` / `orders_update_operator`; no mezclar con kiosk `anon`. |
| **Lifecycle → Editing** | Status es un paso del draft (`applySaveStep`) **y** una quick action. `ready_at`/`delivered_at` de solo lectura en cumplimiento. | Cambiar reglas de transición o timestamps pegajosos toca `order-workspace`, `order-fulfillment`, `order-quick-actions`, tests de counter/mine. |
| **Lifecycle → Settings** | Create y kiosk exigen **exactamente un** `is_initial` activo. No hay UI de catálogo. | Un editor de flags sin RPC transaccional puede dejar 0 o 2 iniciales. |
| **Lifecycle → Files** | **Independientes.** `is_ready` / Mostrador / atención **no** leen `file_status_id`. | No acoplar “Listo” a “Archivos recibidos” sin regla de negocio escrita. |
| **Editing → Files** | `file_status_id` / `quote_status_id` van en el paso `management` del draft (PATCH serial). | Storage + PATCH de estado en el mismo save exige orden (upload → metadata) o transacción. |
| **Editing → Settings** | Dropdowns de la ficha consumen catálogos que Settings administraría. IDs inactivos pueden quedar en un draft abierto. | Cambiar catálogo activo/sort mientras hay drafts abiertos = last-write-wins sobre FK muertas. |
| **Files → Settings** | Misma ausencia de seed de gestión en `create_organization`. Sin pantalla de catálogo. | Seed mínimo vs pantalla Settings: decidir **uno** como fuente para tenants nuevos. |
| **Todos → Kiosk #10** | Insert DEFINER en `kiosk_private`; trigger `tg_activity_log_order_created` relajado con `app.kiosk_submission=validated`; canal `code='kiosk'`. | Cualquier cambio de INSERT `orders`, activity-created o `entry_channels` **después** del freeze debe esperar merge + smoke. |

### Dependencia externa (no negociable en este bloque)

Kiosk V1 está congelado. Las auditorías **no** proponen cambios de kiosk. El merge de #10 es el **primer** nodo serial del grafo de implementación futura.

---

## 3. Cambios de schema (cruzados)

Ningún informe exige schema para un V1 documental. Lo hipotético, si el arquitecto lo pidiera más adelante:

| Dominio | ¿Schema V1? | Hipótesis posterior | Conflicto si se hace ahora |
|---------|-------------|---------------------|----------------------------|
| **Lifecycle** | No | `cancelled_at`; CHECKs `(is_cancelled → NOT is_closed)`, `is_ready` vs closed; índice parcial activos; lockdown columnar de `status_id`/`ready_at`/`delivered_at` | Choca con kiosk INSERT y con `orders_update_operator` |
| **Editing** | No | `updated_at` expuesto o `row_version` para concurrencia; opcional mostrar `customer_notified_at` | Toca todos los PATCH y el live refresh |
| **Files** | **No. Diferir.** | Tabla `order_files` + bucket privado `order-attachments` path `{tenant_id}/{order_id}/{uuid}` | Fuera de alcance explícito; kiosk ya promete “próximamente” sin Storage |
| **Settings** | Reutilizar tablas existentes | No nueva tabla. Hipotético `tenant_feature_overrides` solo si se activan `features` | `tenant_settings` ya tiene `timezone/locale/currency/branding/preferences` casi sin leer |
| **Permissions** | **No tabla `capabilities`.** | Duplicaría RLS salvo generación automática (coste alto) | — |

**Conclusión schema:** el hueco real no es “faltan columnas”, es **onboarding incompleto** (`create_organization` vs seed DEMO) y **contrato de flags** sin UI.

---

## 4. Cambios de RLS (cruzados)

| Hallazgo | Informes | Gravedad | ¿V1 investigación? | Serializar con |
|----------|----------|----------|--------------------|----------------|
| UPDATE RLS de `orders` incluye `status_id` / timestamps → bypass de `change_order_status` | Lifecycle (primario), Editing, Permissions | **Alta** integridad | Cerrar columnas vía DEFINER / split de policy **después** de kiosk | Merge #10, INSERT kiosk, RPCs `change_order_*` |
| `list_order_activity` DEFINER solo exige `is_tenant_member` → viewer ve auditoría del pedido | Permissions (primario), Editing, Lifecycle | Media / producto | **Decisión de producto** antes de tocar SQL | Matriz Permissions, ficha `order-activity.tsx` |
| Catálogos: write management; `tenant_settings` write owner/admin; **sin DELETE** authenticated (soft-delete `active=false`) | Settings, Files, Permissions | Baja hoy (no hay UI) | Alinear RLS vs pantalla Settings **cuando exista** | `/settings` + who-sees-it |
| Policies huérfanas de DML en `memberships` tras REVOKE | Permissions | Baja (docs/confusión) | Limpieza cosmética, no urgente | No mezclar con kiosk/anon |
| `preview_tenant_invitation` granted to **anon** | Permissions | Superficie de enumeración si token filtrado | No ampliar `anon` | Freeze kiosk: no grants operativos a anon |
| Storage: **cero** policies en `storage.objects` | Files | N/A hasta V2 | No crear buckets públicos | — |
| Trigger de actividad de status exige `is_tenant_member`, no rol operativo | Lifecycle | Informativo | Si hay bypass, igual se loguea | — |

**No relajar:** `team_members_insert_management` (bootstrap de invitación ya es DEFINER acotado).  
**No expandir anon** más allá de preview/signup de invitaciones y los wrappers kiosk de #10.

---

## 5. APIs afectadas (mapa único)

### Ya existentes y compartidas (cualquier bloque 1 las toca)

| API | Lifecycle | Editing | Files | Settings | Permissions |
|-----|-----------|---------|-------|----------|-------------|
| `GET/POST /api/orders` | create = `is_initial`; filtros active/attention | create ≠ edit | POST no asigna `file_status_id` | timezone en listado | POST `OPERATIVE_ROLES` |
| `GET/PATCH /api/orders/[id]` | PATCH status → RPC | GET ficha; PATCH solo `status_id` | join `file_status` | — | PATCH sin chequeo Next; RPC decide |
| `PATCH .../content` | — | título/desc/notas | — | — | operativo |
| `PATCH .../details` | — | prioridad, servicio, canal, tienda, `due_at`, responsable | — | catálogos de options | operativo |
| `PATCH .../management` | — | archivo/presupuesto/pago/entrega | **superficie Files V1** | catálogos no sembrados | operativo |
| `PATCH .../notification` | aviso independiente del status | paso draft + UI cumplimiento | — | — | operativo |
| `PATCH/POST .../client` | — | **inmediato**, fuera del draft | — | — | operativo |
| `GET .../activity` | log por pedido | ficha | labels «Archivos» | — | **agujero viewer** |
| `GET /api/orders/counter` · `/mine` · `/dashboard` | buckets / `delivered_at` | live refresh | no usan `file_status` | timezone | viewer GET counter OK |
| `GET /api/order-statuses` | contrato flags | selector draft | — | sin write API | SELECT member |
| `GET /api/orders/options` · `/management-options` | — | carga catálogos | 4 catálogos en paralelo | hueco seed | viewer también carga |
| `GET /api/context` | — | `canWrite` | — | `tenants.name` no `business_name` | rol activo |
| `GET/POST /api/stores` · `PATCH /api/stores/[id]` | — | `store_id` en details | — | API lista, **sin UI** | `canWriteStores` = management |
| `GET/POST/PATCH /api/services` | `requires_file` no bloquea ciclo | — | flag sin Storage | único CRUD de catálogo con UI | `canWriteServices` |
| `GET /api/activity` | supervisors | ≠ activity de ficha | — | — | management only |
| `GET /api/team` · `/api/team/access` | — | — | — | no mezclar con Settings | tres capas |

### Hipotéticas (no crear ahora)

| API | Quién la pidió | Bloqueo |
|-----|----------------|---------|
| `GET/PATCH /api/settings` (+ `/settings`) | Settings | Decidir owner/admin vs manager; no re-ejecutar `create_organization` |
| CRUD catálogos `/api/settings/*` | Settings | Serializar `order_statuses` en una RPC transaccional |
| `/api/files` · upload | Files | **Diferir Storage** |
| RPC `apply_order_draft` | Editing | Solo si se exige atomicidad **y** versionado |
| RPC lockdown `status_id` | Lifecycle | Después de merge #10 |
| Ajuste `list_order_activity` | Permissions | Después de decisión de producto sobre viewer |

Kiosk (`POST /api/kiosk/orders`, wrappers públicos): **congelado en #10**. No aparece en la rama auditada.

---

## 6. Archivos que entrarían en conflicto

Cualquier implementación futura del bloque 1 debe tratar estos paths como **zona caliente**. Un solo PR por archivo; no cinco ramas tocando el mismo workspace.

### Conflicto máximo (3+ auditorías)

| Archivo | L | E | F | S | P |
|---------|---|---|---|---|---|
| `components/orders/detail/order-workspace.tsx` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lib/orders/draft.ts` | ✓ | ✓ | ✓ | ✓ | |
| `components/orders/detail/order-production.tsx` | ✓ | ✓ | ✓ | ✓ | |
| `components/orders/detail/order-fulfillment.tsx` | ✓ | ✓ | | | |
| `lib/auth/membership-roles.ts` | ✓ | ✓ | | ✓ | ✓ |
| `lib/nav/items.ts` | ✓ | | | ✓ | ✓ |
| `app/api/orders/[id]/route.ts` | ✓ | ✓ | | | ✓ |
| `app/api/orders/[id]/management/route.ts` | | ✓ | ✓ | | ✓ |
| `app/api/orders/route.ts` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `supabase/migrations/20260907171432_remote_schema.sql` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `supabase/migrations/20260907224500_create_organization.sql` | ✓ | | ✓ | ✓ | |
| `lib/orders/counter.ts` · `mine.ts` · `attention.ts` | ✓ | | ✓ | ✓ | |

### Conflicto alto (2 auditorías o trigger kiosk)

- `components/orders/detail/order-quick-actions.tsx`, `order-notes.tsx`, `order-header.tsx`, `order-activity.tsx`
- `lib/orders/types.ts`, `lib/orders/format.ts`, `lib/activity/format.ts`
- `lib/refresh/use-live-refresh.ts`, `controller.ts`, `order-snapshot.ts`
- `app/api/orders/[id]/content|details|notification|client|activity/route.ts`
- `app/api/orders/management-options/route.ts`, `app/api/order-statuses/route.ts`
- `app/api/onboarding/route.ts`, `components/onboarding/onboarding-form.tsx`
- `supabase/migrations/20260914163515_stores-and-order-store-id.sql`
- `supabase/migrations/20260908180000_list_order_activity.sql`
- `supabase/migrations/20260908183000_activity_log_select_supervisors.sql`
- **Tras merge:** `supabase/migrations/20260915191521_kiosk_public_orders.sql` (PR #10) — `tg_activity_log_order_created`

### Relativamente aislados (paralelizables si no se toca la zona caliente)

- Copy de «Archivos» / kiosk “próximamente” (`components/kiosk/kiosk-order-form.tsx` **solo después** de merge #10 y sin ampliar Storage)
- UI CRUD de **tiendas** reutilizando `app/api/stores/**` (Settings)
- Documentación de matriz de roles (Permissions)
- Tests unitarios nuevos de draft/save (hoy casi no existen)
- `lib/time/zoned-day.ts` + lectura de timezone (si no se añade editor de flags)

---

## 7. Hardcodes (inventario cruzado)

| Tipo | Valor | Dónde | ¿Problema? |
|------|--------|--------|------------|
| Timezone | `Europe/Madrid` | SQL default, onboarding, fallbacks counter/mine, emails de invitación | Invitaciones **ignoran** TZ del tenant |
| Prioridad | `normal` \| `high` \| `urgent` | APIs details, create, UI | Enum de producto; aceptable |
| Aviso cliente | `not_notified` \| `notified` \| `notified_no_pickup` | CHECK BD, notification API, fulfillment | Enum de producto; aceptable |
| Roles | `owner/admin/manager/staff/viewer` | Decenas de RPCs + `membership-roles.ts` + `lib/nav/items.ts` (listas literales) + `lib/team/activity-insert-guard.ts` | **Duplicación**; nav no reutiliza `OPERATIVE_ROLES` |
| Canales onboarding | `counter`, `phone`, `email`, `web` | `create_organization` | Kiosk `kiosk` **no** se siembra; opt-in manual |
| Status seed producción | `received`, `in_progress`, `ready`, `closed`, `cancelled` | `create_organization` | Lógica TS usa **flags**, no estos códigos (correcto) |
| Status/canales DEMO | `production`, `collected`, canal `store`, file `pending`/`received` | `demo-commercial.sql` | **Mismo app, códigos distintos** al onboarding mínimo |
| UI «Archivos» | label fija | production, activity, services `requires_file`, kiosk | Sugiere Storage; es catálogo manual |
| `add_to_personal` | UI default `true` vs DB default `false` | `lib/access/invitation-personal.ts` vs migración | Invitaciones legacy quedan solo-acceso si el form no envía el flag |
| Locale/currency | `es-ES`, `EUR` | SQL + insert onboarding | No hay i18n dinámica |

Los cinco informes coinciden: **no hay lógica de colas que compare `status.name` en español**. El riesgo de hardcode está en **configuración y copy**, no en el motor de flags.

---

## 8. Deuda técnica compartida

Priorizada por cuántos informes la mencionan y por daño operativo.

| Deuda | Informes | Efecto |
|-------|----------|--------|
| Dual path: **INSERT RLS** en create vs **RPC** en updates | L, E, P | Superficies de validación distintas; kiosk añade un tercer path DEFINER |
| Save de ficha **serial, sin transacción ni rollback** | E, F, L | Estado intermedio + activity_log parcial si falla un PATCH |
| Last-write-wins; live refresh **no aplica** snapshot mientras `editing/saving` | E | Segundo operario pisa al primero; notas append (quick) vs replace (draft) |
| No `/settings` ni `GET/PATCH /api/settings` | S, F | Timezone inmutable tras onboarding; catálogos huérfanos |
| `create_organization` no siembra gestión ni `order_contexts` | S, F, E | Tenants nuevos: dropdowns vacíos; DEMO sí los tiene |
| Nav ≠ autorización; **no hay `middleware.ts`** | P, L | Staff GET `/orders` `/services` `/team`; viewer GET counter |
| Activity global vs ficha | P, E, L | Viewer/staff: ficha sí, `/activity` no |
| `tenant_settings` casi muerto (`business_name` vs `tenants.name`, branding, preferences) | S | Header no refleja nombre comercial |
| `received_at` / `archived_at` sin flujo de producto | L | Schema por delante de la UI |
| Storage como pilar en arquitectura, **cero implementación** | F | Copy «Archivos» + `requires_file` + kiosk “próximamente” |
| Tests: counter/mine fuertes; **draft/save/live refresh débiles**; viewer×activity sin pgTAP | E, P, L | Regresiones de edición y de permisos no se pillan |
| Manager RLS escribe catálogos; copy de rol no menciona Settings | S, P | Superficie oculta vía cliente Supabase |
| `ready_at`/`delivered_at` no se revierten; counter filtra `delivered_at IS NULL` y mine/list no | L | Pedido “desaparece” del Mostrador y sigue en Mis pedidos |

---

## 9. Trabajo paralelizable (solo después de la revisión arquitectónica)

Pueden avanzar en **ramas distintas** si no tocan la zona caliente de la §6 ni Kiosk:

1. **Documentar** la matriz rol × capacidad a partir de `membership-roles.ts` + RLS (Permissions). Cero schema.
2. **Copy de dominio Files:** «Estado de archivos (manual)» vs gestor documental. No Storage. Alinear con el mensaje de kiosk **después** del merge.
3. **UI de tiendas** sobre APIs ya existentes (`/api/stores`), management-only, sin cambiar RLS.
4. **Pantalla mínima de timezone / `business_name`** (owner/admin) **sin** editor de `order_statuses`.
5. Tests de `buildDraftSaveSteps` / save parcial / live refresh (Editing) — no cambian contrato.
6. Alinear fallbacks de TZ de invitaciones con `tenant_settings.timezone` (Settings, acotado).
7. Docs SUR4: Terminado = `is_ready` activo; Entregado = `is_closed`; no acoplar a `file_status`.

Estos ítems **no** son Lifecycle V1. Settings/Files/Editing siguen en sus bloques.

---

## 10. Trabajo que debe serializarse

Orden **actualizado tras la revisión arquitectónica**. Lifecycle no arranca hasta merge #10.

```text
0. Humano: Vault + Vercel secret + canal DEMO kiosk + smoke 1–6
1. Merge PR #10 (Kiosk) — único writer de tg_activity_log_order_created / kiosk_private
2. Revalidar hotspots Lifecycle/Permissions contra ese main (no rehacer B–F)
3. Lifecycle V1 (una rama/PR):
     - lockdown status_id / ready_at / delivered_at / archived_at vía trigger+GUC+RPC
     - predicado operativo unificado (flags + archived_at; no delivered_at)
     - archivo solo terminales + confirmaciones
     - viewer conserva list_order_activity en ficha
4. Seed create_organization (otro bloque) XOR Settings V1 — no en el PR Lifecycle
5. Settings IA / RLS owner+admin en catálogos
6. Editing: banner de conflicto (no row_version salvo evidencia)
7. Files V1: decisión Storage/Drive; file_status sigue manual hasta entonces
```

**No paralelizar nunca:**

- Nav/Settings redesign **con** cambios RLS (UI 200 vs RPC 403).
- Editor de `order_statuses` **con** cambios de `change_order_status` / timestamps.
- Storage upload **con** PATCH `file_status_id` en el mismo save sin orden definido.
- Cualquier migración de `orders` / activity-created **antes** del merge #10.
- staff≠manager en ficha **antes** de publicar la matriz Permissions.

---

## 11. Decisiones del arquitecto (cerradas)

Registradas en la revisión de PR #11. Spec: `docs/superpowers/specs/2026-09-16-gestcopy-lifecycle-v1-design.md`.

1. Viewer conserva historial del pedido; `/activity` sigue gestión.
2. Bypass `status_id`/timestamps se cierra en Lifecycle V1 (mecanismo mínimo / RPC).
3. Seed `create_organization`: otro bloque, no Lifecycle.
4. Settings estructural: owner+admin; manager opera; RLS se alinea en Settings.
5. `file_status` manual; Storage en Files V1.
6. Concurrencia: banner en Editing; no `row_version` aún.
7. Colas unificadas por flags + no archivado; `delivered_at` no filtra.
8. Kiosk #10 fuera de Lifecycle salvo defecto de smoke.

---

## 12. Lo que sigue sin autorizar

- Escribir código de Lifecycle **antes** del merge de #10.
- Mezclar Settings, Storage o Editing completo en el PR Lifecycle.
- Modificar o mergear PR #10 sin smoke humano.
- Tabla `capabilities` o rediseño de schema.

---

## 13. Referencias de los informes fuente

Auditorías READ-ONLY (agentes, 2026-09-16), no versionadas como docs individuales en el repo:

| ID | Agente | Enfoque |
|----|--------|---------|
| B | AUDIT_ORDER_LIFECYCLE_V1 | Flags, RPC status/aviso, timestamps, buckets, kiosk documentado |
| C | AUDIT_ORDER_EDITING_V1 | Draft vs inmediato, PATCH serial, notas, live refresh |
| D | AUDIT_FILES_V1 | Catálogo ≠ Storage; `requires_file`; seed incompleto |
| E | AUDIT_SETTINGS_V1 | `tenant_settings`, ausencia de `/settings`, timezone, catálogos |
| F | AUDIT_PERMISSIONS_V1 | Tres capas, matriz, `list_order_activity`, nav ≠ auth |

Contrato de producto ya cerrado en repo:

- `docs/Arquitectura inmutable de Copyflow.md`
- `docs/COPYFLOW-MVP-CHECKPOINT.md` (§7 Pedidos, §13 activity)
- `docs/GESTCOPY_PROJECT_NOTES.md` (estado operativo actual)
- `docs/superpowers/specs/2026-09-16-gestcopy-lifecycle-v1-design.md`
- `docs/superpowers/plans/2026-09-16-gestcopy-lifecycle-v1.md`
