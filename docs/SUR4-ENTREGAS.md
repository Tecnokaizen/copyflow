# SUR4 — Registro de entregas E0–E11

Post-its, secuencia de trabajo (multirresponsabilidad), ficha y documentos A4.
Fuente de verdad: [ADR SUR4-01](adr/2026-10-27-sur4-ficha-postits-secuencia.md) y
[contrato técnico E0](SUR4-FICHA-POSTITS-CONTRATO.md). Este registro solo anota
estado y evidencias; si algo contradice al ADR o al contrato, mandan ellos.

Rama de trabajo: `feat/sur4-postits-secuencia`, desde `main` `e218939`.
Autorización del propietario (28/10/2026): desarrollo completo E0–E11, ramas,
commits, pruebas y PR en borrador. **No autorizado:** merge a `main`,
migraciones o despliegues en Production, datos reales de SUR4, cambios
destructivos. Migraciones y despliegues en Staging solo tras comprobar copia
y compatibilidad, y con ventana acordada con las sesiones de Stripe y release.

## Estado

| Entrega | Estado | Commit | Evidencias | Bloqueos para el merge |
| --- | --- | --- | --- | --- |
| E0 · Decisiones | Hecha | `0cf2639` | ADR y contrato copiados sin cambios: SHA-256 `eff3f524…` y `9e4c37c5…`, iguales a la exportación del documento (rev 17 y rev 10) | N15 |
| E1 · Pistas PostgREST | Hecha | (este commit) | `!orders_team_member_fk` en los cinco embeds reales del responsable (el documento contaba seis: `orders/mine` y la revisión solo leen la columna). `team_members(*)` pasa a `(id, name, active)`. `lib/orders/postgrest-hints.test.ts` falla sin la pista (comprobado quitándola). PostgREST local responde 200 con las pistas | N15 |
| E2 · Impresión segura | Pendiente | — | — | N15, N11, auditoría N23, tienda (SUR4) |
| E3 · Ficha reorganizada | Pendiente | — | — | N15 |
| E4 · Resguardo PDF | Pendiente | — | — | N15, N9, N12 |
| E5 · Post-its: base de datos | Pendiente | — | — | N15, N3, N4, N5, N8 |
| E6 · Post-its: API y ficha | Pendiente | — | — | N15 |
| E7 · Secuencia: base de datos | Pendiente | — | — | N15 |
| E8 · Secuencia: API, Configuración y ficha | Pendiente | — | — | N15 |
| E9 · Secuencia: listas y panel | Pendiente | — | — | N15 |
| E10 · Integración | Pendiente | — | — | Staging autorizado |
| E11 · Ayuda y cierre | Pendiente | — | — | E10 |

N15 = F12 cerrada y #146 fusionada en `main`.

## Decisiones pendientes y cómo se implementan mientras tanto

Se implementa la recomendación escrita en el documento (sección 8). Cada una
queda aislada para cambiarla sin rehacer la entrega, y ninguna entrega que la
use se fusiona hasta que el propietario la cierre.

| # | Recomendación implementada | Dónde vive | Si cambia |
| --- | --- | --- | --- |
| N3 | Estados Abierta, Resuelta y Anulada, más fijar | `order_notes.state`, `set_order_note_state_v1` | Un `CHECK` y una rama de la RPC |
| N4 | Solo el autor edita sus notas abiertas; anulan el autor, owner, admin y manager | `update_order_note_v1`, `set_order_note_state_v1` | Dos comprobaciones de rol en la RPC |
| N5 | Los post-its no suben `orders.row_version` | RPC de notas | Añadir el `UPDATE` con la marca de R5 |
| N8 | Destinatario «Para» opcional y sin avisos | `addressee_team_member_id` | Sin cambios de esquema |
| N9 | Hoja en el navegador; Resguardo en PDF de servidor, sin guardar en R2 | E4 | Solo E4 |
| N11 | Importes visibles para todos los miembros, como hoy | E2/E3 | Solo la ficha |
| N12 | Instrucciones en el Resguardo como «Descripción del trabajo» | E4 | Un bloque del PDF |

## Datos que no dependen del código

- Respuesta de SUR4 sobre si la Hoja muestra la tienda (antes del merge de E2).
- Auditoría N23 en Production, con su propia autorización (antes del merge de E2).
- Visto bueno de Tamara para #146 (puerta N15).
- Significado de las fechas de prueba (N10): no bloquea ninguna entrega.
