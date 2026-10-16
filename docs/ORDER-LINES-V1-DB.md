# Order Lines V1 · PR A — capa de base de datos

Fecha: 16/10/2026. ADR: [#104](adr/2026-10-15-order-lines-v1.md) (decisiones A–F aprobadas).

- Base: `main` `a6d1846`.
- Migración: `20261016130000_order_lines_v1_db.sql`, aditiva. Reversión: `supabase/rollbacks/20261016130000_order_lines_v1_db.sql`.
- Alcance: solo base de datos. Sin UI, sin API, sin cambios en presupuestos ni en `convert_quote_to_order` (PR B).

**No se aplica en Production sin gate y autorización.** Hasta que la API (PR C) la use, ninguna ruta de la aplicación escribe líneas: el comportamiento visible no cambia.

## Modelo

| Objeto | Detalle |
| --- | --- |
| `order_items` | Concepto, descripción, cantidad `numeric(18,6)`, unidad, precio, descuento, IVA e importes calculados por la base de datos. FK compuesta `(tenant_id, order_id)`, `unique (tenant_id, order_id, position)`, RLS de lectura para miembros, **sin** `INSERT/UPDATE/DELETE` para ningún rol de la API |
| `orders.total_mode` | `manual` (por defecto, comportamiento actual) o `items` |
| `orders.prices_include_tax` | IVA incluido o excluido en los precios de **todas** las líneas del pedido (igual que `quote_versions`) |
| `orders.items_subtotal / items_tax_total / items_total` | Suma de las líneas. Informativos en modo `manual` |
| `orders.total_amount` | Sigue siendo el importe operativo de cobros y facturación. En modo `items` es `= items_total` (CHECK `orders_items_mode_total`) |

Todas las columnas nuevas nacen con `default` (`manual`, `false`, `0`): ningún pedido histórico cambia, `total_amount` incluido.

## Cálculo fiscal

Las líneas usan literalmente `quote_line_amounts_v1` (sin tocarla): mismo redondeo por línea y misma lógica de IVA incluido/excluido que los presupuestos. Un test compara cada línea con esa función. Preparado para PR B: `prices_include_tax` y los importes por línea se pueden copiar tal cual desde `quote_items`.

## Diseño de triggers

| Trigger | Nivel | Función |
| --- | --- | --- |
| `trg_order_items_guard` (BEFORE I/U/D en `order_items`) | fila, O(1) | Exige el flag de escritura; identidad inmutable; pedido existente del mismo tenant y no archivado; calcula `subtotal/tax_amount/total` |
| `trg_order_items_rollup_ins/upd/del` (AFTER, tablas de transición) | **sentencia** | Recalcula el agregado **una vez por pedido y sentencia**, nunca por fila. Se silencia con `gestcopy.order_items_bulk` (lo usa la RPC) o durante una purga |
| `trg_orders_items_guard` (BEFORE en `orders`) | fila | `total_mode`, `prices_include_tax` e `items_*` solo con el flag; el IVA no cambia con líneas presentes; en modo `items` solo la ruta de líneas mueve `total_amount` |
| `trg_orders_total_amount_guard` (existente) | fila | Sigue aplicando `total_amount_rpc_only` y `total_below_paid` también a la actualización derivada |
| `trg_orders_purge_items` (BEFORE DELETE en `orders`) | fila | Borrar un pedido purga sus líneas, como ya hace con sus cobros |

Flags de transacción (`set_config(..., true)`, nunca fuera de funciones `SECURITY DEFINER`): `gestcopy.order_items_write`, `gestcopy.order_items_bulk`, `gestcopy.order_items_purge` y el existente `gestcopy.order_total_write`.

## Contrato

`replace_order_items_v1(p_order_id uuid, p_expected_row_version text, p_items jsonb, p_total_mode text default null, p_prices_include_tax boolean default null) returns jsonb`

- `SECURITY DEFINER`, `search_path = ''`, solo `authenticated`. Miembro con rol `owner/admin/manager/staff`; `viewer` recibe `forbidden`; quien no es miembro recibe `not_found`.
- Reemplazo completo (máx. 500 líneas) bajo `row_version`. `p_expected_row_version` es `text`, igual que `set_order_total_amount` (evita la pérdida de precisión de `bigint` en JavaScript).
- `NULL` en `p_total_mode` / `p_prices_include_tax` conserva el valor actual.
- Cada línea admite solo `concept, description, quantity, unit, unit_price, discount_percent, tax_rate`. Cualquier otro campo (`id`, `subtotal`, `total`…) es `invalid_items`/`unknown_field`.
- Errores (`{ok:false,error}`): `not_found`, `forbidden`, `order_archived`, `conflict` (+`row_version`), `invalid_total_mode`, `invalid_items` (+`index`, `field`), `too_many_items`, `items_required`, `total_below_paid`, `amount_overflow`.
- Modo `items` exige al menos una línea. Pasar de `items` a `manual` conserva `total_amount`. Pasar de `manual` a `items` lo sustituye por el total derivado.
- Respuesta: `ok`, `total_mode`, `prices_include_tax`, `items_count`, importes `items_*` como texto, `items[]` con importes por línea y la instantánea de cobros de `order_collection_snapshot` (incluye `row_version`).
- Un guardado correcto sube `row_version` una vez (dos si cambia el modo de IVA). Registra `order.items_replaced` en `activity_log` (solo recuentos e importes, sin las líneas).

### Otras rutas que escriben importes económicos (revisadas)

| Ruta | Resultado |
| --- | --- |
| `set_order_total_amount` | **Cambia**: devuelve `total_mode_items` en modo `items` |
| `record_order_payment`, `void_order_payment` | Sin cambios: no escriben el total |
| `convert_quote_to_order` | Sin cambios (siempre `manual`). **PR B** debe fijar `gestcopy.order_items_write` y `gestcopy.order_total_write` al insertar un pedido en modo `items` |
| `UPDATE orders` directo (`authenticated` tiene `UPDATE` de tabla) | `total_amount`, `total_mode`, `prices_include_tax` e `items_*` quedan protegidos por triggers |
| Kiosco y alta de pedidos | Insertan con los valores por defecto |

## Hallazgo corregido: la guarda de `total_amount` fallaba con la sesión nueva

`tg_orders_total_amount_guard` (migración `20261007190056`) calculaba `v_allowed := current_setting('gestcopy.order_total_write', true) = '1'`. En una conexión que nunca ha fijado ese parámetro el valor es `NULL`, `NOT NULL` es `NULL` y el `IF` no se cumple: **`total_amount_rpc_only` y `total_below_paid` no se aplicaban**, y un usuario operativo podía hacer `UPDATE orders SET total_amount = …` directamente. Verificado en una base local con las migraciones de `main`, tanto en SQL como con sesiones nuevas. Solo se enmascaraba en conexiones que ya habían ejecutado una RPC de totales.

Corrección: `coalesce(… = '1', false)` (mismo cuerpo, una línea). La reversión **no** restaura el comportamiento anterior. Tests: `phase51_order_lines.sql` (sesión nueva, antes de cualquier RPC) y `phase51_order_lines_concurrency.sh` (cada llamada es una sesión nueva).

**Mientras esta migración no se aplique en Production, el hueco sigue abierto allí** (requiere un usuario autenticado con rol operativo y una conexión recién abierta).

## Rendimiento

Medido en Postgres 17.6 local (mediana de 7 ejecuciones de la RPC completa, DELETE + INSERT + agregado + log):

| Líneas | `manual` | `items` |
| --- | --- | --- |
| 1 | 1,4 ms | 1,2 ms |
| 50 | 8,5 ms | 8,5 ms |
| 500 | 74,7 ms | 92,7 ms |

Crecimiento lineal (~0,15 ms por línea). Inserción de 500 líneas sin refresco por fila (el agregado se calcula una sola vez, ~1 ms): 56 ms; con un refresco del pedido por cada fila insertada: 213 ms (4 veces más y creciendo con el cuadrado), además de 500 subidas de `row_version` y totales intermedios que en modo `items` con cobros darían `total_below_paid` falsos.

## Tests

| Fichero | Cubre |
| --- | --- |
| `supabase/tests/phase51_order_lines.sql` | Pedidos históricos intactos, privilegios y RLS, escrituras directas, modo manual, IVA excluido e incluido exactos, modo `items`, cobros (`total_below_paid`, `payment_exceeds_total`), atomicidad, validación de cada campo, límite de 500, archivados, roles (`viewer`, `staff`, `manager`, otro tenant, `anon`, sin sesión), triggers de sentencia, purga y rendimiento con 1, 50 y 500 |
| `supabase/tests/phase51_order_lines_concurrency.sh` | Cinco sesiones con la misma versión (un ganador), carreras cobro/rebaja del total, escrituras paralelas en pedidos distintos, escrituras directas en sesiones nuevas |

Verificados con mutaciones: sin el `coalesce` y con el refresco por sentencia sin silenciar, ambas suites fallan.

## Reversión

Se niega si existe alguna línea o algún pedido que use líneas (modo `items`, IVA incluido o `items_*` distintos de cero). Verificado en local: con datos rechaza; sin datos deja el catálogo idéntico a `main` salvo la guarda de `total_amount` ya corregida, y la migración vuelve a aplicarse limpiamente. Después: `supabase migration repair --status reverted 20261016130000`.

## Coordinación

Las migraciones de Claude (`20261016120000`–`123000`, PR #122–#126) no están en `main`. Esta migración usa `20261016130000`: ordena después de todas ellas y de `main`. Si aparece otra migración posterior antes de integrar, hay que reordenar antes del merge.
