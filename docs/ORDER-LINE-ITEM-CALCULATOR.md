# Calculador económico de pedidos por conceptos e IVA

Fecha: 05/11/2026. Rama `feat/order-line-item-calculator`, base `main` 6939a5b. Encargo 03.

Sustituye el diálogo «Definir / Modificar total» de la ficha (sección de cobro) por un diálogo con dos modos: **Por conceptos** e **Importe directo**. Es un calculador del total del pedido: no emite facturas, no toca los PDF y no cambia entregas a cuenta, historial de pagos, saldo pendiente ni entrega.

## Qué reutiliza

- **Persistencia**: Order Lines V1 (#128, `20261016130000`), ya en `main`. Tabla `order_items` con `tenant_id`, RLS de lectura para miembros y escritura solo por `replace_order_items_v1`. `orders.total_mode` (`manual` | `items`), `orders.prices_include_tax` y `items_*`. Ver `docs/ORDER-LINES-V1-DB.md`.
- **Cálculo**: `quote_line_amounts_v1`, la misma función que Presupuestos. Cada línea guarda su % de IVA y sus importes calculados por la base de datos, así que un cambio futuro de los tipos ofrecidos no altera importes históricos.
- **Validación de líneas**: la de borradores de presupuesto (`parseCommercialItem` en `lib/quotes/payload.ts`).

## Qué añade

| Pieza | Detalle |
| --- | --- |
| Migración `20261105100000_order_manual_total_switch_v1` | `set_order_manual_total_v1(order, total, expected_row_version)`. Pasa de partidas a importe directo **en una sola transacción y un solo UPDATE**: `total_mode = 'manual'` y el total tecleado. Las líneas y `items_*` se conservan como referencia. Mismas comprobaciones que `set_order_total_amount` (miembro, rol operativo, no archivado, `row_version`, formato, `total_below_paid`). Una subida de `row_version`, un registro `order.total_changed` con el modo anterior y el nuevo. Aditiva. Rollback en `supabase/rollbacks/`. |
| `GET /api/orders/[id]/items` | Partidas del pedido y su modo. Los numéricos se leen como texto exacto (`::text`). |
| `PUT /api/orders/[id]/items` | Guarda las partidas en modo `items` con el tratamiento de IVA elegido (`replace_order_items_v1`). Nunca acepta ids ni importes del cliente. |
| `PATCH /api/orders/[id]/total` | Sin cambios para pedidos en modo manual. Con `leave_items: true` usa `set_order_manual_total_v1`. |
| `lib/orders/line-amounts.ts` | Espejo exacto (BigInt, sin coma flotante) de `quote_line_amounts_v1`, **solo para la vista previa**. Los importes guardados siempre los calcula la base de datos y la pantalla se repinta con su respuesta. |
| `lib/orders/tax-rates.ts` | 21 / 10 / 4 / 0 % como opciones iniciales (alcance limitado, no es una configuración fiscal completa). Un % guardado fuera de la lista se muestra y se conserva. El 0 % no implica exención. |
| `components/orders/detail/order-total-dialog.tsx` | El diálogo. |

## Comportamiento

- **Por conceptos**: concepto, cantidad, precio unitario, IVA por línea y un selector «IVA para todas» con «Aplicar». Añadir, duplicar y eliminar filas. Importe por línea, base imponible, IVA, total y desglose por tipo cuando hay varios.
- **Precios con IVA incluido**: activado por defecto en un cálculo nuevo; al reabrir, el valor guardado. Activado: los precios son finales y se desglosan base e IVA sin sumarlo. Desactivado: el IVA se suma.
- **Descuentos**: la columna no se muestra en V1, pero un descuento ya guardado se reenvía intacto y se avisa.
- **Importe directo**: el flujo de siempre. Si el total salía de partidas, se avisa de que pasan a ser referencia y el cambio es atómico. Si falla (por ejemplo `total_below_paid` o conflicto), no se guarda nada: el pedido sigue en modo partidas con su total.
- **Partidas de referencia**: en modo manual se indican como «guardadas como referencia; no determinan el total». Guardar desde «Por conceptos» las vuelve a usar para el total.
- **Cobros**: se muestra lo ya entregado; un total por debajo se bloquea en la pantalla y la base de datos lo rechaza igualmente (`total_below_paid`).
- **Conflictos** (`row_version`): no se reintenta solo. Se refrescan versión e importes, se conserva lo tecleado y se pide volver a guardar. `record_order_payment` y `void_order_payment` no suben `row_version`, pero bloquean el pedido `FOR UPDATE`; las reglas de dinero las garantizan las guardas de la base de datos (cubiertas por `phase51_order_lines_concurrency.sh`).

## Redondeo

Por línea, a 2 decimales, alejándose de cero (igual que `round(numeric, 2)`); los totales son la suma de las líneas redondeadas. Con IVA incluido, base + IVA de una línea puede diferir 0,01 € de su importe (ejemplo en los vectores: 0,13 € al 4 % → base 0,13 + IVA 0,01). Es el mismo comportamiento que en Presupuestos.

## Pruebas

| Prueba | Qué cubre |
| --- | --- |
| `lib/orders/line-amounts.fixtures.json` | 25 vectores generados con `quote_line_amounts_v1` (empates en ,xx5, 6 decimales, 0 %, 100 % de descuento, tipo no estándar, diferencia de 0,01) |
| `lib/orders/line-amounts.test.ts` | El espejo TS da exactamente esos céntimos; sumas y desglose |
| `supabase/tests/phase68_order_line_item_calculator.sql` | Los mismos vectores contra `quote_line_amounts_v1`; `set_order_manual_total_v1`: cambio atómico, líneas conservadas, cobros intactos, `total_below_paid` sin escritura, conflictos, formatos, roles, otro tenant, archivado, privilegios, flags que no se filtran |
| `lib/orders/items*.test.ts`, `total-calculator.test.ts`, `format-activity.test.ts` | Payload, mapeo exacto, rutas HTTP, estado del diálogo, textos del historial |
| `scripts/order-total-calculator-ui-smoke.mjs` | Diálogo real con dobles HTTP en 1280 y 390 px (76 comprobaciones), sin red externa |

Además, una comprobación puntual local de 20 000 entradas aleatorias dio 0 diferencias entre el espejo TS y la función SQL.

## Despliegue

1. Aplicar `20261105100000` en Staging (con autorización) y probar en una Preview.
2. En Production: primero la migración, después el código (la ruta `leave_items` la necesita). Comprobar antes, en solo lectura, que `20261016130000` está aplicada.
3. Rollback: desplegar un código sin `leave_items` y ejecutar el script de rollback (no toca datos).

## Fuera de alcance

- Convertir un presupuesto copiando sus líneas (PR B de Order Lines).
- Mostrar partidas en recibos, PDF o factura (requiere propuesta aprobada).
- Tipos de IVA configurables por tenant o asignación a planes (la lista está en un único punto, `lib/orders/tax-rates.ts`, compatible con la futura capa central de derechos).
