# Gestcopy Quick Order Layout V1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir a owner/admin elegir, por tenant, qué campos de Pedido rápido van en Principal y cuáles en Más opciones, sin cambiar el POST ni el layout por defecto de los tenants existentes.

**Architecture:** Resolver un layout desde `tenant_settings.preferences.quick_order_layout` (JSONB existente). Ausencia → constante `DEFAULT_QUICK_ORDER_PRINCIPAL` idéntica al UI actual. `CreateOrderForm` en `mode="quick"` itera el catálogo canónico. Settings es un recorte owner/admin; RLS ya restringe UPDATE.

**Tech Stack:** Next.js App Router, `tenant_settings.preferences`, `npx tsx --test`. Sin migración de schema.

**Spec:** `docs/superpowers/specs/2026-09-16-gestcopy-quick-order-layout-v1-design.md`

## Global Constraints

- No implementar hasta **autorización arquitectónica**.
- Tras autorización: rama propia `cursor/quick-order-layout-v1-5d7f` desde `main` post-#10; **no** mezclar con el PR de Lifecycle.
- No lógica por slug/tenant (nada de SUR4/DEMO en código).
- Mismo `CreateOrderForm`, mismo `POST /api/orders`, mismas validaciones, mismos catálogos.
- Sin drag & drop. Sin tabla nueva. Sin tocar Kiosk, Lifecycle RPC/triggers, ni `mode="full"`.
- Owner+admin configuran; Responsable/Personal usan Pedido rápido y no el Settings.
- Ausencia de config = layout actual exacto.

---

## Conflictos vs Lifecycle y Kiosk (decisión de paralelismo)

### Puede ejecutarse en paralelo: **SÍ**

Tras merge de Kiosk (#10), este subbloque y Lifecycle V1 pueden ser **dos PRs simultáneos**. No comparten la zona caliente de Lifecycle.

| Lifecycle V1 (plan) | Quick Order Layout V1 | ¿Choque? |
|---------------------|------------------------|----------|
| `lib/orders/operational.ts` (nuevo) | `lib/orders/quick-order-layout.ts` (nuevo) | no |
| `lib/orders/counter.ts` `mine.ts` `attention.ts` | — | no |
| `lib/orders/types.ts` (`archived_at`) | no requiere `Order` | no, si Layout no edita `types.ts` |
| `app/api/orders/counter/route.ts` | — | no |
| `app/api/orders/[id]/archive/route.ts` + PATCH status | — | no |
| `components/orders/detail/*` | `components/orders/create-order-form.tsx` | **no** |
| `supabase/migrations/20260916120000_order_lifecycle_v1.sql` | **sin migración** | no |
| Kiosk `kiosk_private` / `tg_activity_log_order_created` | — | no |

### Solape débil (coordinar, no bloquear)

| Archivo | Layout | Lifecycle | Cómo |
|---------|--------|-----------|------|
| `lib/auth/membership-roles.ts` | posible alias `canManageTenantSettings` = `ACCESS_ADMIN_ROLES` | el plan Lifecycle **no** lo modifica | Layout puede reutilizar `canManageTenantAccess` y **no editar** el archivo |
| `lib/nav/items.ts` | ítem Ajustes owner/admin | Lifecycle no lo toca | solo Layout |
| `app/api/orders/route.ts` POST | no tocar | no tocar | — |
| `lib/orders/create-form.ts` | no tocar | no tocar | — |

**Prohibido en ambos PRs:** mezclar Settings estructural / seed `create_organization` / Storage.

**Kiosk:** cero archivos compartidos. No hace falta esperar funcionalmente a #10 salvo la política de freeze (no abrir PRs de producto hasta que el arquitecto lo autorice; el usuario pidió paralelismo *después* del merge).

---

## File map

| Path | Rol |
|------|-----|
| `lib/orders/quick-order-layout.ts` | catálogo, default, `resolveQuickOrderLayout` |
| `lib/orders/quick-order-layout.test.ts` | ausencia = default; merge; desconocidos |
| `lib/orders/create-form-layout.ts` | visibilidad canal/tienda/contexto (ya existe); no duplicar |
| `components/orders/create-order-form.tsx` | render por secciones en `mode="quick"` |
| `app/api/settings/quick-order-layout/route.ts` | GET miembro / PATCH owner+admin + merge JSONB |
| `app/settings/quick-order/page.tsx` | switches Principal / Más opciones |
| `lib/nav/items.ts` | nav Ajustes solo `ACCESS_ADMIN_ROLES` |

No crear: migración SQL, cambios en `buildCreateOrderPayload`, kiosk, ficha de pedido.

---

### Task 0: Gate

- [ ] **Step 1:** Esperar autorización arquitectónica **y** merge de #10 (política de freeze).
- [ ] **Step 2:** Rama `cursor/quick-order-layout-v1-5d7f` desde `origin/main`. No reutilizar la rama de Lifecycle.

---

### Task 1: Resolver layout (TDD, puro)

**Files:**
- Create: `lib/orders/quick-order-layout.ts`
- Create: `lib/orders/quick-order-layout.test.ts`

**Interfaces:**
- Produces:
  - `QUICK_ORDER_FIELDS` (tupla de ids)
  - `DEFAULT_QUICK_ORDER_PRINCIPAL`
  - `resolveQuickOrderLayout(preferences: unknown): { principal: QuickOrderFieldId[]; moreOptions: QuickOrderFieldId[] }`

- [ ] **Step 1: Tests que fallan**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_QUICK_ORDER_PRINCIPAL,
  resolveQuickOrderLayout,
} from "./quick-order-layout";

describe("resolveQuickOrderLayout", () => {
  it("matches the current Pedido rápido layout when preferences are missing", () => {
    const resolved = resolveQuickOrderLayout(undefined);
    assert.deepEqual(resolved.principal, [
      "client",
      "service",
      "description",
      "store",
      "due_at",
      "priority",
      "assigned_team_member",
    ]);
    assert.deepEqual(resolved.moreOptions, [
      "entry_channel",
      "title",
      "order_context",
      "notes",
    ]);
    assert.deepEqual(
      resolveQuickOrderLayout({}).principal,
      DEFAULT_QUICK_ORDER_PRINCIPAL
    );
  });

  it("sends unmarked fields to Más opciones without dropping them", () => {
    const resolved = resolveQuickOrderLayout({
      quick_order_layout: { version: 1, principal: ["client", "notes"] },
    });
    assert.deepEqual(resolved.principal, ["client", "notes"]);
    assert.ok(resolved.moreOptions.includes("service"));
    assert.equal(resolved.moreOptions.includes("notes"), false);
    assert.equal(
      resolved.principal.length + resolved.moreOptions.length,
      11
    );
  });

  it("ignores unknown field ids and falls back on invalid payloads", () => {
    const resolved = resolveQuickOrderLayout({
      quick_order_layout: { principal: ["client", "sur4_only", 3] },
    });
    assert.deepEqual(resolved.principal, ["client"]);
    assert.deepEqual(
      resolveQuickOrderLayout({ quick_order_layout: "nope" }).principal,
      DEFAULT_QUICK_ORDER_PRINCIPAL
    );
  });
});
```

- [ ] **Step 2:** `npx tsx --test lib/orders/quick-order-layout.test.ts` → FAIL
- [ ] **Step 3:** Implementar resolución: orden de `principal` persistido filtrado al catálogo; `moreOptions` = catálogo canónico menos esos ids. Payload inválido → default. `principal: []` → principal vacío, no default.
- [ ] **Step 4:** tests en verde
- [ ] **Step 5:** commit `feat(orders): resolver layout de Pedido rápido desde preferences`

---

### Task 2: CreateOrderForm quick usa el layout

**Files:**
- Modify: `components/orders/create-order-form.tsx`
- Modify: `lib/orders/create-form-layout.test.ts` only if se extraen helpers de visibilidad
- Do not modify: `lib/orders/create-form.ts`

**Interfaces:**
- Consumes: `resolveQuickOrderLayout`, helpers actuales de canal/tienda
- Produce: mismos campos y POST

- [ ] **Step 1:** Cargar `tenant_settings.preferences` (GET layout o select en options). Solo aplicar en `mode === "quick"`.
- [ ] **Step 2:** Extraer cada campo a `renderField(id)` (client, service, …) y mapear `principal` / `moreOptions`. Condicionales de catálogo **encima** (store 0, channel ≠ 1-or-0 hide, context 0).
- [ ] **Step 3:** Si `moreOptions` visibles length === 0, no montar `<details>Más opciones</details>`.
- [ ] **Step 4:** `mode="full"` bit-idéntico en estructura (no usar el resolver).
- [ ] **Step 5:** `npx tsx --test lib/orders/create-form.test.ts lib/orders/create-form-layout.test.ts lib/orders/quick-order-layout.test.ts`
- [ ] **Step 6:** commit `feat(orders): Pedido rápido respeta layout de tenant`

---

### Task 3: API Settings (sin migración)

**Files:**
- Create: `app/api/settings/quick-order-layout/route.ts`

- [ ] **Step 1:** `GET` — `getCurrentContext()`; select `preferences` de `tenant_settings`; devolver `{ principal, moreOptions, fields }` resueltos. 403 si no hay membership.
- [ ] **Step 2:** `PATCH` — si `!canManageTenantAccess(role)` → 403. Body `{ principal: string[] }`. Validar ids. Leer `preferences`, `json` merge `{ ...prefs, quick_order_layout: { version: 1, principal } }`, `update` por `tenant_id`. Confiar también en RLS owner/admin.
- [ ] **Step 3:** No reemplazar `preferences` entero con solo el layout.
- [ ] **Step 4:** commit `feat(settings): GET/PATCH layout de Pedido rápido`

---

### Task 4: UI Settings + nav

**Files:**
- Create: `app/settings/quick-order/page.tsx` (+ quizá `components/settings/quick-order-layout-form.tsx`)
- Modify: `lib/nav/items.ts` — ítem `settings` href `/settings/quick-order` label `Ajustes`, visible si `canManageTenantAccess(role)`
- Modify: `lib/nav/items.test.ts` si existe cobertura de nav

- [ ] **Step 1:** Página: lista de 11 campos, control Principal / Más opciones (switch o select). Guardar PATCH. Copy: los no principales no se ocultan.
- [ ] **Step 2:** Manager/staff: redirect (p. ej. `/orders/mine` o `/counter`), sin paleta.
- [ ] **Step 3:** Nav tests: staff/manager no ven Ajustes; owner/admin sí.
- [ ] **Step 4:** `npx tsx --test` + lint + `tsc --noEmit`
- [ ] **Step 5:** commit `feat(settings): configurar Pedido rápido (owner/admin)`

---

### Task 5: Verificación

- [ ] Tenant sin config: Pedido rápido = layout actual (client/service/description/store/due/priority/assignee arriba; canal/título/contexto/notas en Más opciones).
- [ ] Owner mueve `notes` a Principal y `client` a Más opciones; staff ve el cambio y puede crear pedido.
- [ ] Manager PATCH API → 403; UI Settings inaccesible.
- [ ] Un solo canal: selector de canal sigue oculto aunque esté en Principal.
- [ ] DEMO y un tenant vacío de preferencias se comportan igual (no hardcode de slug).
- [ ] No hay archivos de Lifecycle ni Kiosk en el diff.

---

## Self-review vs spec

| Spec | Task |
|------|------|
| Reusar `preferences` | Task 3 |
| Ausencia = layout actual | Task 1 |
| Campos no marcados → Más opciones | Task 1–2 |
| Owner/admin only Settings | Tasks 3–4 |
| Mismo POST / mismo form | Task 2 (no tocar payload) |
| Sin SUR4 | Global Constraints |
| Paralelo a Lifecycle | sección Conflictos; Task 0 rama distinta |
| Sin drag & drop | Task 4 switches only |
