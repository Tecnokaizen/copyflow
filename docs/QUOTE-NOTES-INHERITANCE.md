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
No hay cambios de aplicación. Vuelta atrás:
`supabase/rollbacks/20261016110000_quote_conversion_notes_v1.sql` (vuelve a
aplicar la definición de `20261007190056`, con sus permisos y sin comentario).
Las notas ya copiadas pertenecen al pedido y no se borran.

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

## Gate final de integración — 16 de octubre de 2026

Rama actualizada con `main` `81aa3de` (#106, #99, #105, #94, #95 y #107) en
`6a929d3`, sin conflictos.

| Comprobación | Resultado |
| --- | --- |
| tsc · lint · build | OK (lint: 0 errores; 4 avisos ya existentes en `main`) |
| Unitarias | 1157/1157 (la PR no cambia código de aplicación) |
| Guarda de migraciones | PASS: 1 migración, posterior a la última de `main` |
| Smokes de presupuestos | Conversión, alta, transiciones y borrador: PASS |
| SQL de la rama desde cero (`main` + #108) | 56/56: suites del Release Gate y de los workflows, concurrencias y `phase49` incluidas |
| **App actual sobre la migración** | Suites de `main` sobre `main` + #108: 53 en verde; fallan solo las dos aserciones de `phase34` y `phase38` que exigían `orders.notes` vacío, que son exactamente el cambio de comportamiento de esta PR. `phase43` (conversión y concurrencia), `phase44` y `phase45` en verde: misma firma y misma respuesta |
| Visualización en la app actual | `orders.notes` se muestra con `RichTextContent`, se edita con `RichTextEditor` y se imprime con `PrintRichText`; el saneador admite `p`, `br` y `strong`, que es lo que genera la migración |
| Production, solo lectura | 70 migraciones (= `main`); `convert_quote_to_order` (ambas firmas) con el mismo md5 que `main`; 29 presupuestos, 13 convertidos (7 de esos pedidos con notas escritas por el equipo, que no se tocan) |
| Dry-run en Production | Solo `20261016110000_quote_conversion_notes_v1.sql` |
| Reversión | Probada: deja la función igual que `main` (cuerpo, permisos y comentario) y las suites de `main` vuelven a pasar |

### Orden seguro y procedimiento (requiere autorización)

Es solo de base de datos: el merge no cambia la app. Orden recomendado:
**migración y después merge**, para que `main` y Production describan lo mismo.

1. Revalidar la PR: head, todos los checks en verde, `CLEAN` y `main` sin cambios.
2. Foto de Production en solo lectura: md5 y permisos de `convert_quote_to_order`
   y huellas de `orders` y `quotes`.
3. `db push --dry-run --linked` desde un directorio con exactamente las
   migraciones del head: debe listar solo `20261016110000`. Después, `db push`.
4. Comprobación inmediata: 71 migraciones; misma huella de `orders` y `quotes`
   (la migración no cambia datos); la función con el md5 esperado, los mismos
   permisos y la firma antigua de 1 argumento intacta; comprobación HTTP sin
   sesión en verde.
5. Squash merge con `--match-head-commit`; Release Gate de `main` y deployment.
6. `E2E staging` desde `main`.

### Recuperación

- **Falla la migración**: va en una transacción; no se aplica nada.
- **El cambio de comportamiento no se quiere**: aplicar
  `supabase/rollbacks/20261016110000_quote_conversion_notes_v1.sql` y
  `supabase migration repair --status reverted 20261016110000`. Las notas ya
  heredadas se quedan en sus pedidos.

