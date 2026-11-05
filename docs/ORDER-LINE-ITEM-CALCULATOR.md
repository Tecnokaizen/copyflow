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
| `GET /api/orders/[id]/items` | Instantánea coherente del pedido: total, modo, tratamiento del IVA, `row_version` y partidas en **una sola petición** (partidas embebidas por la clave `(tenant_id, order_id)`, que PostgREST ejecuta como una única sentencia SQL). Filtra por `tenant_id` y respeta RLS en ambas tablas. Los numéricos se leen como texto exacto (`::text`). |
| `PUT /api/orders/[id]/items` | Guarda las partidas en modo `items` con el tratamiento de IVA elegido (`replace_order_items_v1`). Nunca acepta ids ni importes del cliente. |
| `PATCH /api/orders/[id]/total` | Sin cambios para pedidos en modo manual. Con `leave_items: true` usa `set_order_manual_total_v1`. |
| `lib/orders/line-amounts.ts` | Espejo exacto (BigInt, sin coma flotante) de `quote_line_amounts_v1`, **solo para la vista previa**. Los importes guardados siempre los calcula la base de datos y la pantalla se repinta con su respuesta. |
| `lib/orders/tax-rates.ts` | 21 / 10 / 4 / 0 % como opciones iniciales (alcance limitado, no es una configuración fiscal completa). Un % guardado fuera de la lista se muestra y se conserva. El 0 % no implica exención. |
| `components/orders/detail/order-total-dialog.tsx` | El diálogo. |

## Comportamiento

- **Por conceptos**: concepto, cantidad, precio unitario, IVA por línea y un selector «IVA para todas» con «Aplicar». Añadir, duplicar y eliminar filas. Importe por línea, base imponible, IVA, total y desglose por tipo cuando hay varios.
- **Precios con IVA incluido**: activado por defecto en un cálculo nuevo; al reabrir, el valor guardado. Activado: los precios son finales y se desglosan base e IVA sin sumarlo. Desactivado: el IVA se suma.
- **Descuentos**: la columna no se muestra en V1, pero un descuento ya guardado se reenvía intacto y se avisa.
- **Importe directo**: el flujo de siempre y la pestaña con la que se abre el diálogo, salvo que el total ya salga de partidas. El importe que aparece al abrir sale de la misma instantánea que la versión con la que se guardará. Si el total salía de partidas, se avisa de que pasan a ser referencia y el cambio es atómico. Si falla (por ejemplo `total_below_paid` o conflicto), no se guarda nada: el pedido sigue en modo partidas con su total.
- **Partidas de referencia**: en modo manual se indican como «guardadas como referencia; no determinan el total». Guardar desde «Por conceptos» las vuelve a usar para el total.
- **Cobros**: se muestra lo ya entregado; un total por debajo se bloquea en la pantalla y la base de datos lo rechaza igualmente (`total_below_paid`).
- **Conflictos** (`row_version`): si otra persona ha guardado mientras tanto, no se reintenta solo y el borrador **nunca** se asocia en silencio a la versión nueva. El diálogo carga la versión actual y la muestra junto al borrador, que sigue en pantalla: total ahora y al abrir, modo, y las partidas actuales con su descuento si lo tienen (aunque la columna de descuento esté oculta). Guardar queda bloqueado hasta elegir:
  - **Descartar mis cambios y cargar esta versión**: la versión actual pasa a ser el borrador. No escribe nada.
  - **Reemplazarla con mis cambios…**: pide confirmación diciendo qué se sustituye («Se reemplazarán las N partidas guardadas ahora por tus M (total X)», «El total pasará de X a Y», o que las partidas quedarán como referencia) y nombra cada descuento que se perdería. Solo «Sí, reemplazar con mis cambios» envía **una** escritura, con la versión que el usuario acaba de ver; si vuelve a cambiar, se repite el aviso.
  - Si la versión actual no se puede cargar, se conserva el borrador, se explica que no se ha guardado y no se permite guardar hasta reabrir el diálogo.
- **Cobros simultáneos**: `record_order_payment` y `void_order_payment` no suben `row_version`, pero bloquean el pedido `FOR UPDATE`. Si un cobro deja el nuevo total por debajo de lo entregado, la base de datos lo rechaza (`total_below_paid`) y no cambia nada: ni modo, ni total, ni partidas, ni versión.

## Redondeo

Por línea, a 2 decimales, alejándose de cero (igual que `round(numeric, 2)`); los totales son la suma de las líneas redondeadas. Con IVA incluido, base + IVA de una línea puede diferir 0,01 € de su importe (ejemplo en los vectores: 0,13 € al 4 % → base 0,13 + IVA 0,01). Es el mismo comportamiento que en Presupuestos.

## Pruebas

| Prueba | Qué cubre |
| --- | --- |
| `lib/orders/line-amounts.fixtures.json` | 25 vectores generados con `quote_line_amounts_v1` (empates en ,xx5, 6 decimales, 0 %, 100 % de descuento, tipo no estándar, diferencia de 0,01) |
| `lib/orders/line-amounts.test.ts` | El espejo TS da exactamente esos céntimos; sumas y desglose |
| `supabase/tests/phase68_order_line_item_calculator.sql` | Los mismos vectores contra `quote_line_amounts_v1`; `set_order_manual_total_v1`: cambio atómico, líneas conservadas, cobros intactos, `total_below_paid` sin escritura, conflictos, formatos, roles, otro tenant, archivado, privilegios, flags que no se filtran |
| `lib/orders/items*.test.ts`, `total-calculator.test.ts`, `format-activity.test.ts` | Payload, mapeo exacto, rutas HTTP, estado del diálogo, textos del historial |
| `supabase/tests/phase68_order_line_item_calculator_concurrency.sh` | Sesiones reales en paralelo: una carga durante una escritura devuelve una instantánea coherente (y el control demuestra que dos lecturas separadas mezclarían versión antigua y partidas nuevas); importe directo cambiado mientras otra persona tiene el diálogo abierto → conflicto; dos personas editan partidas → el segundo guardado da conflicto y el descuento del 5 % de la otra persona sigue intacto; un cobro simultáneo por encima del nuevo total (cambio a importe directo y guardado de partidas) → `total_below_paid` sin escritura parcial |
| `scripts/order-total-calculator-ui-smoke.mjs` | Diálogo real con dobles HTTP en 1280 y 390 px (124 comprobaciones), sin red externa: importe de la instantánea al abrir, conflicto con descuento oculto, descartar, sobrescribir con confirmación, conflicto en importe directo desde partidas |

Además, una comprobación puntual local de 20 000 entradas aleatorias dio 0 diferencias entre el espejo TS y la función SQL, y la consulta embebida se probó contra PostgREST local con un miembro (total, modo, versión y partidas en orden) y con un usuario de otro tenant (lista vacía).

## Despliegue

La corrección de concurrencia no añade migraciones: solo hay una, `20261105100000`.

1. Aplicar `20261105100000` en Staging (con autorización) y probar en una Preview.
2. En Production: primero la migración, después el código (la ruta `leave_items` la necesita). Comprobar antes, en solo lectura, que `20261016130000` está aplicada.
3. Rollback: desplegar un código sin `leave_items` y ejecutar el script de rollback (no toca datos).

## Fuera de alcance

- Convertir un presupuesto copiando sus líneas (PR B de Order Lines).
- Mostrar partidas en recibos, PDF o factura (requiere propuesta aprobada).
- Tipos de IVA configurables por tenant o asignación a planes (la lista está en un único punto, `lib/orders/tax-rates.ts`, compatible con la futura capa central de derechos).
