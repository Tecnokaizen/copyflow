# Gestcopy Lifecycle V1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar integridad de transiciones de pedido, unificar el criterio operativo de colas, y añadir archivo + confirmaciones terminales, sin tocar Kiosk, Settings, Storage ni Editing completo.

**Architecture:** Helper único `isOperationalOrder` (flags + `archived_at`, no `delivered_at`). Trigger `BEFORE UPDATE` + GUC `app.order_lifecycle` para que solo `change_order_status` / `archive_order` muten columnas de ciclo. UI reutiliza `ConfirmDialog`.

**Tech Stack:** PostgreSQL RLS/RPC (INVOKER), Next.js App Router, `npx tsx --test`, pgTAP en `supabase/tests/`.

**Spec:** `docs/superpowers/specs/2026-09-16-gestcopy-lifecycle-v1-design.md`

## Global Constraints

- No escribir código hasta que PR #10 esté mergeado en `main`.
- No modificar `kiosk_private`, wrappers públicos `/api/kiosk*`, ni `tg_activity_log_order_created`.
- No editor de `order_statuses`. No `create_organization` seed. No Storage. No `row_version`. No tabla `capabilities`.
- Lógica de colas por flags (`is_*`), nunca por `status.name` en español.
- Roles: `owner|admin|manager|staff` escriben; `viewer` lee ficha y `list_order_activity`.
- Tests: `npx tsx --test`. Commits frecuentes. Una sola rama/PR de implementación.
- Base tras el gate: `main` post-#10. Rama: `cursor/order-lifecycle-v1-5d7f`.

---

## File map

| Path | Responsabilidad |
|------|-----------------|
| `lib/orders/operational.ts` | Predicado operativo, terminal, kind de confirmación |
| `lib/orders/operational.test.ts` | Tests del predicado |
| `lib/orders/types.ts` | Añadir `archived_at` |
| `lib/orders/counter.ts` / `mine.ts` / `attention.ts` | Dejar de usar `delivered_at` como filtro activo |
| `lib/orders/counter.test.ts` / `mine.test.ts` / `attention.test.ts` | Invertir el caso “delivered_at huérfano” |
| `app/api/orders/counter/route.ts` | Quitar `.is("delivered_at", null)` |
| `supabase/migrations/20260916120000_order_lifecycle_v1.sql` | Trigger + GUC en RPC + `archive_order` + activity |
| `supabase/tests/phase12_order_lifecycle.sql` | pgTAP transiciones, roles, tenant, archive |
| `app/api/orders/[id]/archive/route.ts` | PATCH archivo |
| `components/orders/detail/order-quick-actions.tsx` | Confirmación terminal |
| `components/orders/detail/order-header.tsx` | CTA Archivar |
| `components/orders/detail/order-workspace.tsx` | Confirmación al guardar draft terminal + archive |

---

### Task 0: Gate — no implementar todavía

**Files:** ninguno de producto.

- [ ] **Step 1: Esperar merge de PR #10**

No crear rama de implementación ni migración mientras #10 esté abierto. Kiosk permanece CODE FREEZE.

- [ ] **Step 2: Tras merge, actualizar `main` y crear rama**

```bash
git fetch origin main
git checkout -b cursor/order-lifecycle-v1-5d7f origin/main
```

- [ ] **Step 3: Revalidar solo hotspots (no rehacer auditorías B–F)**

Comprobar en el `main` post-kiosk:

1. `change_order_status` sigue `SECURITY INVOKER` y `SET search_path TO ''`.
2. Existe `orders_update_operator` sin restricción de columnas.
3. `app/api/orders/counter/route.ts` aún filtra `delivered_at`.
4. `GET /api/orders/[id]` no filtra `archived_at`.
5. Kiosk: `tg_activity_log_order_created` y `kiosk_private.submit_kiosk_order` **no se editan** en este PR. El trigger nuevo es `BEFORE UPDATE`, no `INSERT`.

Si algún hotspot cambió, ajustar el SQL de las tasks siguientes; no ampliar alcance.

---

### Task 1: Predicado operativo compartido

**Files:**
- Create: `lib/orders/operational.ts`
- Create: `lib/orders/operational.test.ts`
- Modify: `lib/orders/types.ts` — añadir `archived_at: string | null` a `Order` (y a `CounterOrder` / `MineOrder` si no lo tienen)

**Interfaces:**
- Consumes: flags `is_closed` / `is_cancelled` en `status`; `archived_at`
- Produces:
  - `isTerminalStatus(status): boolean`
  - `isOperationalOrder(order): boolean`
  - `lifecycleConfirmKind(status): "deliver" | "cancel" | null`

- [ ] **Step 1: Escribir tests que fallan**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOperationalOrder,
  isTerminalStatus,
  lifecycleConfirmKind,
} from "./operational";

const active = {
  archived_at: null as string | null,
  status: { is_ready: true, is_closed: false, is_cancelled: false },
};

describe("isOperationalOrder", () => {
  it("keeps a ready order with orphan delivered_at in the operational set", () => {
    assert.equal(
      isOperationalOrder({
        ...active,
        delivered_at: "2026-09-14T10:00:00.000Z",
      }),
      true
    );
  });

  it("excludes closed, cancelled and archived orders", () => {
    assert.equal(
      isOperationalOrder({
        archived_at: null,
        status: { is_closed: true, is_cancelled: false },
      }),
      false
    );
    assert.equal(
      isOperationalOrder({
        archived_at: null,
        status: { is_closed: false, is_cancelled: true },
      }),
      false
    );
    assert.equal(
      isOperationalOrder({ ...active, archived_at: "2026-09-16T10:00:00.000Z" }),
      false
    );
  });
});

describe("lifecycleConfirmKind", () => {
  it("asks confirmation only for terminal statuses", () => {
    assert.equal(
      lifecycleConfirmKind({ is_closed: true, is_cancelled: false }),
      "deliver"
    );
    assert.equal(
      lifecycleConfirmKind({ is_closed: false, is_cancelled: true }),
      "cancel"
    );
    assert.equal(
      lifecycleConfirmKind({ is_ready: true, is_closed: false, is_cancelled: false }),
      null
    );
  });
});
```

- [ ] **Step 2: Correr tests — deben fallar**

```bash
npx tsx --test lib/orders/operational.test.ts
```

Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

```ts
export type LifecycleStatusFlags = {
  is_closed?: boolean;
  is_cancelled?: boolean;
  is_ready?: boolean;
};

export function isTerminalStatus(
  status: LifecycleStatusFlags | null | undefined
): boolean {
  return status?.is_closed === true || status?.is_cancelled === true;
}

export function isOperationalOrder(order: {
  archived_at?: string | null;
  status?: LifecycleStatusFlags | null;
}): boolean {
  return !isTerminalStatus(order.status) && !order.archived_at;
}

export function lifecycleConfirmKind(
  status: LifecycleStatusFlags | null | undefined
): "deliver" | "cancel" | null {
  if (status?.is_cancelled === true) return "cancel";
  if (status?.is_closed === true) return "deliver";
  return null;
}
```

Añadir `archived_at: string | null` a `Order` en `lib/orders/types.ts`.

- [ ] **Step 4: Tests en verde**

```bash
npx tsx --test lib/orders/operational.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/orders/operational.ts lib/orders/operational.test.ts lib/orders/types.ts
git commit -m "feat(orders): predicado operativo por flags y archivo"
```

---

### Task 2: Unificar Mostrador, Mis pedidos y atención

**Files:**
- Modify: `lib/orders/counter.ts` — `isActive` debe delegar en `isOperationalOrder` (ignorar `delivered_at`)
- Modify: `lib/orders/mine.ts` — `isReady` / exclusión no usen `delivered_at`
- Modify: `lib/orders/attention.ts` — chips de listo/asignado/retraso usan `isOperationalOrder` + `is_ready`, no `delivered_at === null`
- Modify: `lib/orders/counter.test.ts` — el caso “delivered without is_closed” **entra** en buckets
- Modify: `lib/orders/attention.test.ts` — `delivered_at` huérfano **sí** avisa “sin responsable” / “listo” si flags activos
- Modify: `lib/orders/mine.test.ts` — mismo criterio
- Modify: `app/api/orders/counter/route.ts` — quitar `.is("delivered_at", null)`
- Leave: `app/api/orders/mine/route.ts` ya filtra flags + `archived_at` (no `delivered_at`)

**Interfaces:**
- Consumes: `isOperationalOrder` de Task 1
- Produces: mismas funciones exportadas (`groupCounterBuckets`, `isOverdueCounterOrder`, `getOrderAttentionSignals`, …)

- [ ] **Step 1: Actualizar el test que hoy exige exclusión por `delivered_at`**

En `lib/orders/counter.test.ts`, sustituir el caso `excludes closed, cancelled and delivered orders from every bucket`:

- closed / cancelled → count 0
- pedido `is_ready` + `delivered_at` set + `is_closed: false` → **count > 0** en `ready`

En `isOverdueCounterOrder(delivered, …)`: si el fixture no está cerrado, expected `true` (antes `false`).

- [ ] **Step 2: Correr tests — deben fallar**

```bash
npx tsx --test lib/orders/counter.test.ts lib/orders/mine.test.ts lib/orders/attention.test.ts
```

- [ ] **Step 3: Implementar el predicado en las tres librerías**

`counter.ts`:

```ts
function isActive(order: CounterOrder) {
  return isOperationalOrder(order);
}
```

Añadir `archived_at` al tipo `CounterOrder` / `MineOrder` y al mapper (null si falta).

`attention.ts` `isReadyForDelivery`:

```ts
function isReadyForDelivery(order: Order) {
  if (!isOperationalOrder(order)) return false;
  if (typeof order.status?.is_ready === "boolean") return order.status.is_ready === true;
  return order.ready_at !== null;
}
```

Chips overdue/unassigned: no emitir si `!isOperationalOrder(order)`.

`mine.ts` `isReady`: quitar `if (order.delivered_at) return false`.

`app/api/orders/counter/route.ts`: eliminar la línea `.is("delivered_at", null)`. Conservar `.is("archived_at", null)` y flags.

- [ ] **Step 4: Tests en verde**

```bash
npx tsx --test lib/orders/counter.test.ts lib/orders/mine.test.ts lib/orders/attention.test.ts lib/orders/operational.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/orders/counter.ts lib/orders/counter.test.ts lib/orders/mine.ts lib/orders/mine.test.ts lib/orders/attention.ts lib/orders/attention.test.ts app/api/orders/counter/route.ts
git commit -m "fix(orders): colas operativas por flags, no por delivered_at"
```

---

### Task 3: Migración — guard de columnas + archive RPC

**Files:**
- Create: `supabase/migrations/20260916120000_order_lifecycle_v1.sql`
- Create: `supabase/tests/phase12_order_lifecycle.sql`

Si el timestamp choca con otra migración post-#10, renombrar; no editar la migración kiosk.

**Interfaces:**
- Consumes: `public.change_order_status` actual (INVOKER)
- Produces: `public.archive_order(uuid, uuid) → jsonb`; trigger `trg_orders_guard_lifecycle`

- [ ] **Step 1: Escribir el pgTAP que falla (aún no hay RPC/trigger)**

`supabase/tests/phase12_order_lifecycle.sql` — mismo estilo que `phase7_team_roles_operative.sql`:

Cubrir:

1. Staff `authenticated` hace `UPDATE orders SET status_id = …` → SQLSTATE `42501` (o el errcode del trigger, usar `GTC01`).
2. Staff llama `change_order_status` al estado `is_closed` del tenant → OK; `delivered_at` se rellena una vez.
3. Viewer llama `change_order_status` → `42501`.
4. Owner tenant B con `p_tenant_id` de A / `p_order_id` de A → denegado; cero filas cambiadas en A.
5. `archive_order` sobre pedido `is_ready` (no terminal) → `22023`.
6. `archive_order` sobre pedido `is_closed` → `archived_at` not null; segundo call idempotente.
7. Staff `UPDATE orders SET archived_at = now()` directo → bloqueado.
8. `change_order_status` sobre pedido ya archivado → `22023`.
9. `change_order_details` (u otro UPDATE de columnas no lifecycle) sigue OK.
10. INSERT de pedido (create) no dispara el guard.

Usar tenants y users UUID fijos distintos de phase7 (`c7000000-…`).

- [ ] **Step 2: Correr pgTAP en local — debe fallar**

```bash
# contra Supabase local tras supabase db reset o equivalente del repo
psql "$DATABASE_URL" -f supabase/tests/phase12_order_lifecycle.sql
```

Expected: FAIL (`archive_order` does not exist / UPDATE still succeeds).

- [ ] **Step 3: Migración mínima**

Cuerpo esencial (ajustar GRANT/REVOKE al patrón de `change_order_status`):

```sql
CREATE OR REPLACE FUNCTION public.tg_orders_guard_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_src text := pg_catalog.current_setting('app.order_lifecycle', true);
BEGIN
  IF pg_catalog.current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.status_id IS DISTINCT FROM OLD.status_id
     OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
     OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    IF v_src IS DISTINCT FROM 'change_order_status' THEN
      RAISE EXCEPTION 'order status transitions must use change_order_status'
        USING ERRCODE = 'GTC01';
    END IF;
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    IF v_src IS DISTINCT FROM 'archive_order' THEN
      RAISE EXCEPTION 'archiving must use archive_order'
        USING ERRCODE = 'GTC01';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_guard_lifecycle ON public.orders;
CREATE TRIGGER trg_orders_guard_lifecycle
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_orders_guard_lifecycle();

-- Dentro de change_order_status, ANTES del UPDATE:
--   if v_order.archived_at is not null then
--     raise exception 'order is archived' using errcode = '22023';
--   end if;
--   perform pg_catalog.set_config('app.order_lifecycle', 'change_order_status', true);

CREATE OR REPLACE FUNCTION public.archive_order(
  p_order_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_order public.orders%rowtype;
  v_status public.order_statuses%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_tenant_role(
    p_tenant_id,
    ARRAY['owner', 'admin', 'manager', 'staff']::text[]
  ) THEN
    RAISE EXCEPTION 'tenant access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.archived_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'order', pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'archived_at', v_order.archived_at
      )
    );
  END IF;

  SELECT * INTO v_status
  FROM public.order_statuses
  WHERE id = v_order.status_id AND tenant_id = p_tenant_id;

  IF NOT (v_status.is_closed IS TRUE OR v_status.is_cancelled IS TRUE) THEN
    RAISE EXCEPTION 'only terminal orders can be archived'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.order_lifecycle', 'archive_order', true);

  UPDATE public.orders
  SET archived_at = v_now, updated_at = v_now
  WHERE id = v_order.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_order;

  RETURN pg_catalog.jsonb_build_object(
    'order', pg_catalog.jsonb_build_object(
      'id', v_order.id,
      'archived_at', v_order.archived_at
    )
  );
END;
$function$;
```

Añadir trigger de actividad **nuevo** `tg_activity_log_order_archived` en `UPDATE OF archived_at` → evento `order.archived`. **No** reemplazar `tg_activity_log_order_created`.

`REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated, postgres;`

Al reescribir `change_order_status`, copiar el cuerpo actual de `main` post-#10 y solo insertar el check de archivado + `set_config`. No cambiar la semántica sticky de timestamps.

- [ ] **Step 4: pgTAP en verde**

```bash
psql "$DATABASE_URL" -f supabase/tests/phase12_order_lifecycle.sql
```

Expected: el bloque termina sin `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260916120000_order_lifecycle_v1.sql supabase/tests/phase12_order_lifecycle.sql
git commit -m "feat(orders): transiciones y archivo solo por RPC"
```

---

### Task 4: API de archivo + GET ficha

**Files:**
- Create: `app/api/orders/[id]/archive/route.ts`
- Modify: `app/api/orders/[id]/route.ts` — mapear `GTC01` → 403; `22023` ya es 400
- Verify: `GET` sigue sin `.is("archived_at", null)`

**Interfaces:**
- Consumes: `archive_order`
- Produces: `PATCH /api/orders/:id/archive` → `{ order: { id, archived_at } }`

- [ ] **Step 1: Ruta**

Espejo de `app/api/orders/[id]/route.ts` PATCH:

```ts
const { data, error } = await supabase.rpc("archive_order", {
  p_order_id: id,
  p_tenant_id: context.tenant.id,
});
```

Códigos: `28000`→401, `42501`/`GTC01`→403, `22023`→400, `P0002`→404.

No chequeo extra de rol en Next: la RPC es la fuente de verdad (igual que status). `getCurrentContext()` sí.

- [ ] **Step 2: Commit**

```bash
git add app/api/orders/[id]/archive/route.ts app/api/orders/[id]/route.ts
git commit -m "feat(orders): API para archivar pedidos terminales"
```

---

### Task 5: Confirmaciones y CTA Archivar

**Files:**
- Modify: `components/orders/detail/order-quick-actions.tsx`
- Modify: `components/orders/detail/order-header.tsx`
- Modify: `components/orders/detail/order-workspace.tsx`
- Modify: `components/orders/detail/order-fulfillment.tsx` — mostrar `archived_at` como hecho de solo lectura si existe

**Interfaces:**
- Consumes: `lifecycleConfirmKind`, `isTerminalStatus`, `isOperationalOrder`
- Produces: `onArchive(): Promise<void>` desde workspace

Copy (ES):

| Kind | title | description | confirmLabel | destructive |
|------|-------|-------------|--------------|-------------|
| deliver | Entregar pedido | Esta acción cierra el pedido como entregado. | Entregar | false |
| cancel | Cancelar pedido | El pedido quedará cancelado. | Cancelar pedido | true |
| archive | Archivar pedido | Seguirá consultable. Saldrá de Mostrador y Mis pedidos. | Archivar | false |

- [ ] **Step 1: Quick actions**

Tras elegir un estado, si `lifecycleConfirmKind(selected)` no es null **y** el estado actual no era ya ese kind, no llamar a `onSaveStatus` en el primer diálogo: abrir un segundo `ConfirmDialog` con la copy de arriba. El primer diálogo (“Cambiar estado”) se mantiene para estados no terminales.

- [ ] **Step 2: Draft save**

En `saveEditing`, si el paso `status` apunta a un status terminal distinto del actual, exigir el mismo segundo diálogo antes de `applySaveStep`. No entregar/cancelar como efecto silencioso del resto de campos.

- [ ] **Step 3: Archivar**

Si `canWrite && isTerminalStatus(order.status) && !order.archived_at`, botón «Archivar» en header (junto a quick actions, no en modo edición). ConfirmDialog → `PATCH /api/orders/${id}/archive` → refrescar pedido (sale de colas en el siguiente live refresh). Pedido archivado: banner discreto «Archivado»; sin cambiar estado; sin Storage.

Viewer: no CTA.

- [ ] **Step 4: `npx tsx --test` completo + lint/typecheck**

```bash
npx tsx --test
npx eslint .
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add components/orders/detail app/api/orders
git commit -m "feat(orders): confirmaciones terminales y archivo en ficha"
```

---

### Task 6: Verificación de cierre (post-código)

- [ ] **Step 1: Tests de visibilidad**

Añadir aserciones en `counter.test.ts` / `mine.test.ts`:

- cerrado no aparece
- cancelado no aparece
- archivado no aparece (si el mapper trae `archived_at`)
- `is_ready` + `delivered_at` huérfano **sí** aparece

- [ ] **Step 2: Build**

```bash
npx next build
```

- [ ] **Step 3: Smoke DEMO (humano + agente UI)**

1. Pedido DEMO activo → Mostrador y Mis pedidos.
2. Cambiar a Listo / `is_ready` sin diálogo extra de entregar.
3. Entregar → confirmación → desaparece de colas; ficha sigue; `delivered_at` set.
4. Cancelar otro → confirmación → fuera de colas.
5. Archivar el entregado → confirmación → fuera de colas; `GET` ficha OK; viewer no archiva.
6. No crear segundo pedido kiosk ni tocar `/kiosk`.
7. Intento de servicio/tenant ajeno en RPC (pgTAP ya cubre).

- [ ] **Step 4: PR único de implementación**

Título: `Lifecycle V1: transiciones íntegras, colas unificadas y archivo`.  
No mezclar Settings/Storage/Editing. No mergear sin lint/typecheck/build/tests y smoke DEMO.

---

## Self-review vs spec

| Spec | Task |
|------|------|
| Bypass `status_id`/timestamps | Task 3 |
| Predicado operativo compartido | Tasks 1–2 |
| `delivered_at` no filtra | Task 2 |
| Archivo solo terminal, consultable, no hard delete | Tasks 3–5 |
| Confirmaciones cancel/entregar/archivar | Task 5 |
| Viewer activity sin igualar `/activity` | sin cambios (explícito) |
| No kiosk / no Settings seed / no Storage / no capabilities | Global Constraints + Task 0 |
| Revalidar hotspots post-#10 | Task 0 |

No hay placeholders de implementación. La **ejecución** de Tasks 1–6 está prohibida hasta Task 0 Step 1 (merge #10).
