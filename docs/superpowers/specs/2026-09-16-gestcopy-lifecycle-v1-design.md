# Gestcopy Lifecycle V1 — Design

**Estado:** aprobado por revisión arquitectónica en [PR #11](https://github.com/Tecnokaizen/copyflow/pull/11#pullrequestreview-5223885331).  
**Escritura de código:** solo después del merge de [PR #10](https://github.com/Tecnokaizen/copyflow/pull/10) (Kiosk RC / smoke humano).  
**Plan:** `docs/superpowers/plans/2026-09-16-gestcopy-lifecycle-v1.md`

---

## 1. Propósito

Cerrar el ciclo de vida operativo de un pedido de copistería: transiciones de estado íntegras, mismas reglas en Mostrador / Mis pedidos / atención, archivo organizativo (no es un estado), y confirmaciones conscientes para acciones terminales.

No es un rediseño de schema. No es Settings. No es Storage. No es Editing completo. No toca Kiosk.

---

## 2. Contrato de flags (sin nombres en español en lógica)

| Flag | Significado V1 |
|------|----------------|
| `is_initial` | Estado de alta (create interno y kiosk). Exactamente uno activo por tenant. |
| `is_ready` | Preparado / listo. **Sigue activo.** |
| `is_closed` | Entregado. **Terminal.** |
| `is_cancelled` | Cancelado. **Terminal.** |
| `orders.archived_at` | Dimensión organizativa. **No es un estado de producción.** |

Timestamps `ready_at` / `delivered_at` son auditoría. No son la fuente de verdad del filtro operativo.

Pedido operativo (Mostrador, Mis pedidos, atención, dashboard “activos”):

```text
!status.is_closed && !status.is_cancelled && archived_at IS NULL
```

Un `delivered_at` huérfano (pedido no cerrado) **no** saca el pedido de las colas.

---

## 3. Integridad de transiciones

Hoy `orders_update_operator` permite `UPDATE` directo de `status_id` / `ready_at` / `delivered_at` sin `change_order_status`. Eso es deuda V1 y se cierra.

**Mecanismo mínimo (recomendado):** trigger `BEFORE UPDATE` en `public.orders` que rechaza cambios de:

- `status_id`, `ready_at`, `delivered_at` salvo GUC `app.order_lifecycle = 'change_order_status'`
- `archived_at` salvo GUC `app.order_lifecycle = 'archive_order'`

`change_order_status` (sigue **INVOKER**, mismos roles `owner|admin|manager|staff`) hace `set_config(..., true)` en la transacción antes del `UPDATE`.

No convertir la RPC a DEFINER. No tocar políticas de INSERT. No tocar `kiosk_private`, wrappers públicos ni `tg_activity_log_order_created`.

Kiosk inserta filas nuevas; el trigger es `UPDATE` y no interfiere.

El resto de PATCH (`content`, `details`, `management`, `notification`, `client`) no tocan esas columnas y siguen igual.

Pedidos archivados: `change_order_status` rechaza (no se reabre ni se retoca el ciclo desde la cola operativa). Siguen siendo `GET` por id.

---

## 4. Archivo V1

- RPC nueva `archive_order(p_order_id, p_tenant_id)` — mismos roles operativos.
- Solo si el estado actual es terminal (`is_closed` **o** `is_cancelled`) y `archived_at IS NULL`.
- Idempotente si ya está archivado.
- No hard delete en UI ni en RPC.
- `GET /api/orders/[id]` **no** filtra `archived_at` (ya es así): el histórico sigue consultable.
- Mostrador / Mis pedidos / listado operativo / dashboard siguen excluyendo archivados.
- Evento `order.archived` en `activity_log` (trigger acotado a `archived_at`). No modificar el trigger de `order.created`.

Sin `unarchive` en V1.

---

## 5. Confirmaciones

Reutilizar `components/gestcopy/confirm-dialog.tsx`.

| Acción | Confirmación |
|--------|----------------|
| Cancelar (`is_cancelled`) | Explícita, `destructive` |
| Entregar / estado `is_closed` | Explícita, acción consciente (no side effect del draft) |
| Archivar | Explícita |
| Otros cambios de estado (p. ej. a `is_ready`) | El diálogo actual de “Cambiar estado” basta |

Aplica a acciones rápidas **y** al guardado de draft si el paso de estado es terminal.

---

## 6. Permisos (sin cambiar la matriz)

- Transiciones y archivo: roles operativos. Viewer 403.
- Viewer **sigue** leyendo `list_order_activity` en la ficha. `/activity` global sigue siendo gestión. **No igualar.**
- Staff = manager en mutaciones de pedido. Sin `capabilities` table.

---

## 7. Fuera de este bloque

| Decisión | Dónde |
|----------|--------|
| Seed mínimo de catálogos en `create_organization` | Onboarding / bloque correspondiente. No duplicar aquí. |
| Settings owner+admin vs manager en catálogos | Settings V1 (alinear RLS entonces). |
| Storage / `requires_file` / `file_status` automático | Files V1. `file_status` permanece estado manual. |
| Banner de conflicto / `row_version` | Editing V1. |
| Código kiosk | PR #10. Solo si smoke detecta defecto real. |

---

## 8. Criterios de aceptación

1. Staff no puede `UPDATE` `status_id` / timestamps / `archived_at` por cliente Supabase directo; sí vía RPC.
2. Viewer no transiciona ni archiva; sí lee ficha + actividad del pedido, incluido archivado.
3. Cross-tenant: RPC con `p_tenant_id` ajeno → denegado, cero filas en el otro tenant.
4. Mostrador y Mis pedidos coinciden en el predicado operativo; `delivered_at` solo no oculta.
5. Solo terminales se archivan; ficha archivada sigue abriendo.
6. Cancelar, entregar y archivar piden confirmación.
7. Kiosk (tras merge #10) sigue creando pedidos `is_initial` sin cambios en este PR.
8. lint, typecheck, build, tests (tsx + pgTAP lifecycle), smoke DEMO.

---

## 9. Riesgos

- El GUC debe ser `true` (transacción local), igual que el patrón kiosk, para no filtrar a otras sesiones.
- Seeds/SQL como `postgres` deben poder actualizar columnas (excepción de rol en el trigger) para no romper `demo-commercial.sql`.
- Tras merge #10, revalidar solo hotspots (`tg_activity_log_order_created`, INSERT kiosk, `change_order_status` INVOKER) — no rehacer las cinco auditorías.
