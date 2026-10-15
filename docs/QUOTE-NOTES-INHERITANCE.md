# Presupuestos → pedidos: herencia de notas (#102)

Al convertir un presupuesto aceptado en pedido, el campo **Notas internas** del
pedido (`orders.notes`) recibe las notas del presupuesto. Antes quedaba siempre
vacío.

## Mapeo (decisión de producto)

| Origen | Destino | Motivo |
| --- | --- | --- |
| Condiciones/notas de la versión aceptada (`quote_versions.terms`; si no hay, `quotes.notes`), texto enriquecido | `orders.notes`, bloque «Notas del presupuesto REF» | Es lo que el cliente aceptó. Ya figura en el PDF del presupuesto, así que no se revela nada nuevo. En el pedido sirve al equipo de producción. |
| Notas internas del presupuesto (`quotes.internal_notes`), texto plano solo para el equipo | `orders.notes`, bloque «Notas internas del presupuesto REF» (escapado, con saltos de línea) | Interno → interno. |
| — | `description`, `title` y demás campos visibles para el cliente | **Sin cambios.** No se copia ninguna nota. |

Las notas internas del pedido también aparecen en la hoja A4 del pedido con el
título «Notas internas», que es un documento de trabajo del taller.

## Garantías

- El presupuesto no se modifica y la relación presupuesto ↔ pedido se mantiene.
- Conversión idempotente: repetirla devuelve el mismo pedido sin tocar sus notas,
  así que no hay duplicados.
- Los pedidos convertidos antes de la migración no se reescriben.
- Misma firma de `convert_quote_to_order`: es compatible con la app desplegada.
  Solo cambia el valor de `notes`.

## Despliegue y vuelta atrás

Migración `20261016110000_quote_conversion_notes_v1.sql` (`CREATE OR REPLACE`).
No hay cambios de aplicación. Vuelta atrás: volver a aplicar la definición de
`20261007190056` con un `CREATE OR REPLACE`. Las notas ya copiadas pertenecen
al pedido y no se borran.

## Pruebas

`supabase/tests/phase49_quote_conversion_notes.sql` (Release Gate):
- ambos bloques con el contenido exacto;
- escape de `<`, `>` y `&` y conservación de los saltos de línea;
- ninguna fuga a campos visibles para el cliente;
- repetición idempotente sin duplicar;
- presupuesto intacto;
- notas vacías → `NULL`;
- solo notas internas.

`phase34` se ha adaptado a la nueva semántica. `phase43` y su concurrencia,
`phase33`, `phase44` y `phase45` siguen en verde.
