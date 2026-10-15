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
