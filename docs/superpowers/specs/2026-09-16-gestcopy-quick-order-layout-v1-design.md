# Gestcopy Quick Order Layout V1 — Design

**ID:** `QUICK_ORDER_LAYOUT_V1`  
**Estado:** preparado. **No implementar** hasta autorización arquitectónica.  
**Plan:** `docs/superpowers/plans/2026-09-16-gestcopy-quick-order-layout-v1.md`

---

## 1. Propósito

Hacer configurable **por tenant** qué campos de Pedido rápido aparecen en la superficie principal y cuáles en **Más opciones**.

No hay lógica por tenant concreto (tampoco SUR4). Un tenant configura su layout; el código es el mismo para todos.

## 2. Fuera de alcance V1

- Drag & drop / orden libre (el orden visual es el canónico actual).
- Aplicar el layout al formulario **completo** (`mode="full"` en `/orders`).
- Settings general (timezone, branding, catálogos, `order_statuses`).
- Cambiar `POST /api/orders`, validaciones, RLS de pedidos o catálogos.
- Nueva tabla. Preferencia: reutilizar `tenant_settings.preferences`.
- Kiosk.

## 3. Layout actual (contrato de ausencia)

Hoy, en `mode="quick"` (`components/orders/create-order-form.tsx`):

**Principal**

1. `client`
2. `service`
3. `description`
4. `store` (oculto si el catálogo de tiendas está vacío)
5. `due_at`
6. `priority`
7. `assigned_team_member`

**Más opciones**

1. `entry_channel` — solo si hay **más de un** canal (si hay 0 o 1, se oculta y el de uno se autoselecciona)
2. `title`
3. `order_context` — solo si el catálogo de contextos no está vacío
4. `notes`

La **ausencia** de `preferences.quick_order_layout` (null, `{}`, clave ausente, JSON inválido) debe resolver **exactamente** esta lista y este orden. Los tenants existentes no cambian de UI.

`mode="full"` no se toca.

## 4. Modelo de datos — reutilizar `tenant_settings.preferences`

Tabla existente:

```text
public.tenant_settings.preferences  jsonb NOT NULL DEFAULT '{}'
```

RLS ya alineada con el contrato de producto:

| Acción | Quién |
|--------|--------|
| `SELECT` | cualquier miembro (`tenant_settings_select_member`) |
| `UPDATE` | **owner + admin** (`tenant_settings_update_owner_admin`) |

No hace falta migración ni tabla nueva.

### Forma almacenada

```json
{
  "quick_order_layout": {
    "version": 1,
    "principal": [
      "client",
      "service",
      "description",
      "store",
      "due_at",
      "priority",
      "assigned_team_member"
    ]
  }
}
```

- Solo se persiste **Principal**.
- **Más opciones** = todos los campos del catálogo V1 que no están en `principal`, en orden canónico.
- Un campo no puede desaparecer: si no es Principal, va a Más opciones.
- Claves desconocidas se ignoran (forward-compatible).
- `principal: []` es configuración **explícita** (todo en Más opciones), distinta de ausencia.
- Escritura: `jsonb_set` / read-modify-write de `preferences` para **no** borrar `week_starts_on` / `default_view` del seed DEMO.

### Catálogo V1 de campos

```text
client
service
description
store
due_at
assigned_team_member
priority
entry_channel
order_context
title
notes
```

Orden canónico de render (el actual):

```text
client, service, description, store, due_at, priority,
assigned_team_member, entry_channel, title, order_context, notes
```

## 5. Visibilidad de catálogo (independiente del switch)

Estas reglas **siguen aplicándose** encima del layout, como hoy:

| Campo | Ocultar picker si |
|-------|-------------------|
| `store` | 0 tiendas |
| `entry_channel` | 0 canales, **o 1 canal** (autoselect; no mostrar selector) |
| `order_context` | 0 contextos |

Mover `entry_channel` a Principal no enseña el selector cuando solo hay un canal. Eso conserva el comportamiento tenant-aware actual.

Defaults de valores (un solo canal/tienda, assignee staff) no cambian: `defaultSingleCatalogId`, `suggestedAssigneeId`.

## 6. Permisos

| Rol | Usar Pedido rápido | Configurar layout |
|-----|--------------------|-------------------|
| owner, admin | sí | **sí** |
| manager (Responsable), staff (Personal) | sí | **no** |
| viewer | no | no |

Fuente de verdad de escritura: RLS `tenant_settings_update_owner_admin`.  
La API Next debe repetir `ACCESS_ADMIN_ROLES` (defense-in-depth).  
Uso de Pedido rápido: `canUseQuickOrder` / `canWriteOrders` (sin cambios).

## 7. Superficie UI

**Pedido rápido** (`CreateOrderForm` `mode="quick"`):

- Mismo componente, mismo `POST /api/orders`, mismo payload (`buildCreateOrderPayload`).
- Render: partir los campos con `resolveQuickOrderLayout(preferences)`.
- Si Más opciones queda vacío (todos Principal **y** los condicionales de catálogo no dejan nada), no renderizar el `<details>`.

**Settings → Pedido rápido** (primer recorte de Settings, no el módulo completo):

- Ruta: `/settings/quick-order` (o `/settings` con una sola sección).
- Nav «Ajustes» visible solo owner/admin.
- V1: un switch por campo **Principal / Más opciones**. Sin drag & drop.
- Manager/staff que abran la URL: 403 o redirect, sin formulario.

No construir editor de timezone, catálogos ni branding en este subbloque.

## 8. APIs

| Ruta | Quién | Qué |
|------|-------|-----|
| `GET /api/settings/quick-order-layout` | miembro (idealmente quien puede crear pedidos) | layout resuelto + lista de campos |
| `PATCH /api/settings/quick-order-layout` | owner/admin | `{ principal: string[] }` validado contra el catálogo; merge en `preferences` |
| `GET /api/orders/options` | sin cambio | catálogos |
| `POST /api/orders` | sin cambio | alta |

Opcional: incluir el layout resuelto en `GET /api/context` o en options para un solo round-trip en Pedido rápido. No es obligatorio.

## 9. Paralelismo con Lifecycle V1

Ver plan § Conflictos. Resumen: **sí puede ir en paralelo** tras merge de #10, en **otra rama/PR**, porque no comparte archivos calientes con Lifecycle ni con Kiosk.

Autorización de implementación: arquitecto. Escritura no arranca con este documento.

## 10. Criterios de aceptación

1. Tenant sin clave `quick_order_layout` → pixel/DOM equivalente al Pedido rápido actual (mismos campos en Principal / Más opciones, mismo orden).
2. Marcar `notes` como Principal → aparece arriba; el resto de no marcados siguen en Más opciones.
3. Desmarcar `client` → Cliente pasa a Más opciones; no desaparece.
4. SUR4 y DEMO usan el mismo código; ninguna rama `if (slug === 'sur4')`.
5. Manager/staff usan Pedido rápido; PATCH layout → 403; RLS impide UPDATE.
6. Owner/admin configuran; el cambio se ve en Pedido rápido sin recargar catálogos distintos.
7. `POST /api/orders` y tests de payload (`create-form.test.ts`) intactos.
8. Seed DEMO que reescribe `preferences` no debe ser la única fuente: ausencia = default.
