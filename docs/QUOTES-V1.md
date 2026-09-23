# Presupuestos V1

Módulo independiente de presupuestos. No sustituye `orders.quote_status_id`.

## Diferencias con el diseño de partida

- `quote_statuses` ya existía y no tiene `is_initial`. El estado inicial de un presupuesto es el código `draft`.
- El catálogo visible es `draft` Borrador, `pending` En revisión, `sent` Enviado, `accepted` Aceptado y `rejected` Rechazado. `pending` se conserva. Si el nombre sigue siendo exactamente "Pendiente", pasa a "En revisión"; un nombre ya personalizado no se pisa. `sent` se añade sin borrar estados.
- `create_organization` y `create_internal_organization_v1` no sembraban estados de presupuesto. Ambos llaman a `seed_quote_statuses` y conservan el resto de su comportamiento. No hay un trigger en `tenants`: varios tests insertan ellos mismos el código `draft` y un trigger los rompería.
- La referencia de pedidos usa `order_number_counters` y el formato `PREFIJO-0001`. Presupuestos usa `quote_number_counters` y `PREFIJO-P0001`.
- No existe una RPC `create_order`. La creación oficial inserta en `orders` y deja que los triggers asignen la referencia y la actividad. `convert_quote_to_order` hace ese mismo insert, con el estado inicial del tenant, prioridad `normal` y sin tienda, canal ni fecha de entrega. `valid_until` no se copia a `due_at`. Si el presupuesto no tiene título, el pedido usa los primeros 120 caracteres de la descripción.
- `row_version` sigue el mismo contador que los pedidos.
- `quotes` no forma parte de Gestcopy Basic ni del plan `mvp`. Se enciende con `tenant_feature_overrides`.

## Resolución de features

1. Override explícito del tenant.
2. Feature del plan en una suscripción `active` o `trialing`.
3. Desactivado.

`tenant_has_feature` es la única resolución. Un usuario `authenticated` solo obtiene respuesta de un tenant donde tiene membership activa. Fuera de ese tenant la función devuelve `false`. `service_role` y una sesión directa de `postgres` o `supabase_admin` conservan el acceso operativo.

El fallback de plan no mira `subscriptions.livemode`. No debe usarse para una feature sensible a Stripe hasta que esa condición forme parte de la regla. `quotes` no está en Gestcopy Basic ni en el plan `mvp`, así que ese fallback no la enciende. Eso no se cambia en esta versión.

Escritura y lectura de Presupuestos V1: `owner` y `admin`. No hay archivado en V1: `authenticated` no puede actualizar `archived_at`.

## Habilitar en local

`scripts/set-tenant-feature.mjs` solo acepta `127.0.0.1` o `localhost`. No sirve para Production ni para una conexión de operador remota.

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  node scripts/set-tenant-feature.mjs \
  --tenant sur4 \
  --feature quotes \
  --enabled true
```

Repetirlo actualiza el mismo override local.

## Habilitar en Production

No forma parte de este cambio. No usar el script. Un operador, con una sesión `postgres` o `service_role` en el SQL Editor del proyecto, ejecuta:

```sql
select public.set_tenant_feature('sur4', 'quotes', true, null);
```

La función no está concedida a `authenticated`. No hace falta copiar credenciales al repositorio.

## Archivos compartidos con Pedido V2

- `lib/nav/items.ts` y `components/app-nav.tsx`
- `app/api/context/route.ts`
- `lib/activity/types.ts` y `lib/activity/format.ts`
- `public.list_activity_log`, `public.create_organization` y `public.create_internal_organization_v1`
- `supabase/seeds/demo-commercial.sql`

Pedido V2 ya está en `main`. La conversión no envía `file_status_id`: queda vacío, igual que un pedido creado sin ese dato. No se ha modificado el pedido rápido, la UI de archivos ni el contrato de `POST /api/orders`.
