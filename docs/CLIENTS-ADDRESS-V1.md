# Clientes · dirección opcional (#101)

Petición de una copistería cliente: dirección postal **opcional** en el alta y
la edición de clientes, visible en la ficha. Reutilizable por cualquier tenant;
sin lógica por copistería.

## Diseño

| Pieza | Cambio |
| --- | --- |
| `20261016100000_clients_address_v1.sql` | `clients.address text` nullable (≤ 500 caracteres, `CHECK`). Sin relleno: los clientes existentes siguen válidos con `NULL`. `create_client_v2`/`update_client_v2` = v1 + `p_address` en la misma transacción, `SECURITY INVOKER` (roles, RLS y duplicados de v1 intactos). Nombre nuevo: PostgREST no elige entre sobrecargas (`PGRST203`) y la app desplegada sigue usando v1. |
| `lib/clients/write-rpc.ts` | Sin dirección en la petición → v1 (no se toca la guardada). Alta sin dirección → v1. Si v2 aún no existe y no hay dirección que guardar → v1; con dirección → 503 «La dirección todavía no está disponible» (nunca se pierde en silencio). |
| Formulario y ficha | Campo «Dirección (opcional)» en el alta (todas las entradas: Clientes, pedido, presupuesto) y en la edición desde la ficha del cliente. Donde la dirección no se ha cargado (p. ej. editar el cliente desde un pedido), el campo no aparece y la petición no la incluye, así que no se borra. |
| `GET /api/clients/:id` | Incluye `address`; si la columna aún no existe (42703) responde sin ella. |

Fuera de alcance V1: la dirección no aparece en el listado ni en el historial
de actividad (el trigger registra una lista fija de campos). No hay importador
de clientes en `main`, así que no hay compatibilidad que mantener.

## Despliegue y vuelta atrás

Independiente del orden: el código funciona sin la migración (sin dirección) y
la migración no cambia nada para la app anterior. Recomendado: migración
(`db push` con dry-run previo) → merge/despliegue.

Vuelta atrás: revertir el código. La columna y las funciones v2 pueden quedarse
(aditivas, sin consumidores); no borrar direcciones guardadas.

## Pruebas

- `supabase/tests/phase48_clients_address.sql` (Release Gate): v1 sigue
  funcionando, v2 guarda/recorta/vacía, una sola entrada de historial por alta,
  atomicidad ante dirección demasiado larga, duplicados, viewer (42501), otro
  tenant, `CHECK` directo, sin `EXECUTE` para `anon`, `SECURITY INVOKER`.
- `lib/clients/address.test.ts`: payload, estado «no cargada» frente a «sin
  dirección», y selección v1/v2 con su fallback.

## Gate final de integración — 16 de octubre de 2026

Rama actualizada con `main` `6e3fc12` (#106, #99, #105, #94 y #95) en `f2cd96b`,
sin conflictos (`app/api/clients/route.ts` se combina con la guarda de sesión de
#94).

| Comprobación | Resultado |
| --- | --- |
| tsc · lint · build | OK (lint: 0 errores; 4 avisos ya existentes en `main`) |
| Unitarias | 1157/1157 |
| Guarda de migraciones | PASS: 1 migración, posterior a la última de `main` |
| Smokes de navegador | Cliente en línea 8/8; alta de pedidos 3/3 anchos; cobro 234; presupuestos: alta 384, borrador 290, conversión 581; justificantes 85 |
| SQL de la rama desde cero (`main` + #107) | 55/55, `phase48` y concurrencias incluidas |
| App actual sobre la migración | Suites SQL de `main` sobre `main` + #107: 54/54. Por PostgREST: `create_client`/`update_client` v1 funcionan y una edición v1 conserva la dirección guardada |
| App nueva sin la migración | Por PostgREST con `writeClient` real: alta y edición sin dirección (v1), dirección rechazada con `CLIENT_ADDRESS_UNAVAILABLE` sin crear nada, ficha sin dirección (fallback 42703) |
| App nueva con la migración | Alta con dirección (recortada) y sin ella, edición, borrado con `null`, sin tocar si no se envía, más de 500 caracteres → 22023; viewer, otro tenant y `anon` denegados |
| Clientes existentes | Misma huella de todos los campos antes y después; `address` `NULL` en todos |
| Production, solo lectura | 69 migraciones (= `main`); 108 clientes en 4 tenants; sin columna `address` ni funciones v2; `create_client` y `update_client` con el mismo md5 que `main` (la migración no las cambia) |
| Dry-run en Production | Solo `20261016100000_clients_address_v1.sql` |
| Reversión | `supabase/rollbacks/20261016100000_clients_address_v1.sql`, probada: deja `clients` y sus RPC como en `main` y se niega si algún cliente ya tiene dirección |

### Orden seguro y procedimiento (requiere autorización)

El orden es indiferente para la seguridad, pero se recomienda **migración antes
del merge**: así la dirección está disponible desde el primer despliegue y no se
muestra «La dirección todavía no está disponible».

1. Revalidar la PR: head, todos los checks en verde, `CLEAN` y `main` sin cambios.
2. Foto de Production en solo lectura: número de clientes y huella de sus campos,
   columnas, restricciones, triggers y md5 de las RPC de clientes.
3. `db push --dry-run --linked` desde un directorio con exactamente las
   migraciones del head: debe listar solo `20261016100000`. Si lista otra cosa,
   parar. Después, `db push --linked`.
4. Comprobación inmediata: 70 migraciones; misma huella de clientes y ninguno con
   dirección; columna `address` nula, `clients_address_length_check`,
   `create_client_v2`/`update_client_v2` con el md5 esperado y sin `EXECUTE` para
   `anon`; v1 sin cambios; comprobación HTTP sin sesión en verde.
5. Squash merge con `--match-head-commit`; esperar el Release Gate de `main` y el
   deployment de Production; repetir la comprobación HTTP.
6. `E2E staging` desde `main` (crea un cliente en el alta del pedido).

### Recuperación

- **Falla la migración**: va en una transacción; no se aplica nada.
- **Falla la app nueva tras el merge**: revertir el código (PR de revert o
  deployment anterior en Vercel). La columna y las v2 pueden quedarse: la app
  anterior no las usa.
- **Retirar la migración**: `supabase/rollbacks/20261016100000_clients_address_v1.sql`
  y `supabase migration repair --status reverted 20261016100000`, solo mientras
  ningún cliente tenga dirección. Con direcciones guardadas, recuperación hacia
  delante.

