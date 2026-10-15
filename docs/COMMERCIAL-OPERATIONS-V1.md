# Operación comercial v1

Punto de partida: `main` en `d3efdc2a6d6536dbe8ef46c83ac04d1308074aea` (merge del PR #59).

## Auditoría

- `orders` no tenía ningún campo monetario. `payment_status_id` es un catálogo por tenant (en la demo: `pending` y `paid`) y sigue siendo solo una etiqueta.
- `quotes.client_id` ya es la relación canónica con el cliente.
- `quotes.notes` son las condiciones comerciales que ve el cliente y se copian a `quote_versions.terms`. No sirven como notas internas.
- `quote_versions.total` es `numeric(20,2)`. `convert_quote_to_order` no copiaba ese total al pedido.
- `client.created` y `client.updated` ya se escriben en `activity_log` desde el trigger del cliente. La ficha de cliente no los mostraba. `activity_log` solo es legible en RLS por owner, admin y manager; el historial contextual de pedido usa el RPC `list_order_activity`.
- No existía un endpoint de actividad de cliente ni un listado de presupuestos en la ficha.

## Diseño

Fuente económica del pedido:

`orders.total_amount` (nullable, `numeric(20,2)`) más la suma de `order_payments` no anulados.

- `NULL` significa importe todavía no definido. En ese estado no se puede registrar una entrega (`total_undefined`).
- Un pago exige `amount > 0`, el mismo tenant que el pedido y que la suma no supere el total.
- La fila del pedido se bloquea dentro de la transacción. La clave de idempotencia `(tenant_id, order_id, idempotency_key)` evita duplicar un reintento.
- El permiso de escritura del total, de las notas internas y del borrado en cascada de pagos es un ajuste de sesión que el RPC enciende solo alrededor de la sentencia protegida y apaga antes de volver. No queda activo para el resto de la transacción.
- No hay `DELETE` libre. Una corrección anula el movimiento (`voided_at`) y deja el historial.
- `payment_status_id` no se recalcula ni se elimina. La ficha muestra además Sin cobrar, Parcial o Cobrado derivados de los importes.

La conversión de un presupuesto aceptado copia `quote_versions.total` de `accepted_version_id` como `numeric`. Un reintento devuelve el mismo pedido y no reescribe el total.

`quotes.internal_notes` pertenece al presupuesto, no a la revisión. Editarlas no crea `quote_versions`, no entra en el PDF y el `activity_log` solo dice que se actualizaron, sin copiar el texto.

Los presupuestos de la ficha de cliente salen de `quotes.client_id`, con la RLS y el acceso al módulo de presupuestos ya existentes. Páginas de 20, con el total real.

## Despliegue

Esta rama no se aplica a Production. Cuando se promueva, el orden es:

1. Migración en Supabase Production.
2. Verificar el esquema.
3. Después, promover el código de Vercel que depende de ese esquema.

## Fuera de este cambio

- Color o urgencia visual de los pedidos cuya entrega es hoy.
- Footer configurable del PDF de presupuesto.
- Email real, pago online, facturación, caja, arqueo y devoluciones contables.
