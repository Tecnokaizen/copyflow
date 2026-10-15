# ADR — Líneas de pedido V1 (#104)

Fecha: 15 de octubre de 2026. Estado: **propuesto; requiere decisiones de
producto antes de implementar**.

## Contexto (auditoría)

- Los **pedidos no tienen líneas.** `public.orders` guarda `title`, `description`
  (texto enriquecido), `notes` y `total_amount`. No existe `order_items`.
- Los **presupuestos sí** las tienen: `quote_items` por versión, con `position`,
  `concept`, `description`, `quantity`, `unit`, `unit_price`, `discount_percent`,
  `tax_rate`, `subtotal`, `tax_amount` y `total`, más restricciones de dominio.
- `convert_quote_to_order` copia `description` y `total` de la versión aceptada.
  Las líneas del presupuesto **no** pasan al pedido.
- El cobro (`order_payments`, `set_order_total_amount`, `record_order_payment`)
  depende solo de `total_amount`. El guard `total_below_paid` impide fijar un total
  inferior a lo ya cobrado. Existe control de concurrencia con `row_version`.

Por tanto, «modificar líneas de un pedido» no es editar algo que ya existe:
supone introducir un modelo de líneas en pedidos.

## Decisiones de producto necesarias

1. **¿Fuente de verdad del total?** (a) El total sigue siendo manual y las
   líneas son informativas, o (b) cuando hay líneas, el total se deriva de ellas.
2. **¿Impuestos y descuentos** en el pedido, igual que en el presupuesto, o solo
   cantidad × precio?
3. **¿Conversión?** Copiar las líneas de la versión aceptada al pedido. Recomendado sí,
   porque mantiene la trazabilidad.
4. **¿Estados que bloquean la edición?** Por ejemplo, entregado o archivado.

## Propuesta técnica (si se elige 1b)

- **Tabla `order_items`**, aditiva: `tenant_id`, `order_id`, `position`, `concept`,
  `description`, `quantity`, `unit`, `unit_price`, `discount_percent`, `tax_rate`
  y totales calculados en el servidor, con las mismas restricciones que
  `quote_items`. FK compuesta `(tenant_id, order_id)` y RLS de lectura por membership.
  Escritura **solo** por RPC.
- **RPC `replace_order_items_v1(order_id, items jsonb, expected_row_version)`**:
  - transaccional e idempotente;
  - comprueba rol operativo, tenant, pedido no archivado y `row_version`;
  - recalcula los totales en SQL y actualiza `total_amount`;
  - **rechaza** cualquier resultado con un total menor que lo cobrado
    (`total_below_paid`) y cualquier valor no finito;
  - registra en `activity_log` el antes y el después.
- **Conversión**: `convert_quote_to_order` copia `quote_items` de la versión
  aceptada en la misma transacción.
- **UI**:
  - editor de líneas en la ficha del pedido, que reutiliza el de presupuestos;
  - conflicto de versión con refresco, sin reintento monetario automático;
  - hoja A4 con las líneas.
- **Compatibilidad**: los pedidos sin líneas siguen con el total manual. Las
  líneas son opcionales.

## Invariantes monetarias

- `total_amount` ≥ suma de cobros no anulados, siempre.
- Con líneas: `total_amount` = suma de los totales de línea, calculada en el servidor.
- Ninguna edición concurrente pisa a otra (`row_version`).
- Ningún reintento automático de escrituras monetarias.

## Pruebas exigidas

- SQL: roles, otro tenant, archivado, concurrencia (dos ediciones
  simultáneas), total por debajo de lo cobrado, NaN e infinito, conversión con
  líneas e idempotencia.
- UI: edición, recarga y conflicto, en móvil y escritorio.
- E2E de Staging: pedido con líneas → cobro parcial → edición que baja el total
  por debajo de lo cobrado (rechazo) → edición válida.

## Plan por fases

1. Decisiones de producto y este ADR aceptado.
2. Migración y RPC con suites SQL.
3. Conversión con líneas.
4. UI e impresión.
5. Staging y piloto.

Estimación: de 2 a 3 días de trabajo con validación completa.
