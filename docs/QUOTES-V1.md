# Presupuestos V1

Módulo independiente de presupuestos. No sustituye `orders.quote_status_id`.

## Diferencias con el diseño de partida

- `quote_statuses` ya existía y no tiene `is_initial`. El estado inicial de un presupuesto es el código `draft`.
- El seed comercial de DEMO solo creaba `pending` y `accepted`, y borra el catálogo de DEMO en cada reset. El seed ahora inserta también `draft` y `rejected`. Los códigos que ya existan no se renombran.
- `create_organization` no sembraba estados de presupuesto. Ahora llama a `seed_quote_statuses`. No hay un trigger en `tenants`: varios tests insertan ellos mismos el código `draft` y un trigger los rompería.
- La referencia de pedidos usa `order_number_counters` y el formato `PREFIJO-0001`. Presupuestos usa `quote_number_counters` y `PREFIJO-P0001`.
- No existe una RPC `create_order`. La creación oficial inserta en `orders` y deja que los triggers asignen la referencia y la actividad. `convert_quote_to_order` hace ese mismo insert, con el estado inicial del tenant, prioridad `normal` y sin tienda, canal ni fecha de entrega. `valid_until` no se copia a `due_at`. Si el presupuesto no tiene título, el pedido usa los primeros 120 caracteres de la descripción.
- `row_version` sigue el mismo contador que los pedidos.
- `quotes` no forma parte de Gestcopy Basic ni del plan `mvp`. Se enciende con `tenant_feature_overrides`.

## Resolución de features

1. Override explícito del tenant.
2. Feature del plan en una suscripción `active` o `trialing`.
3. Desactivado.

La función de base de datos es `tenant_has_feature`. La navegación, las páginas, las APIs y las políticas RLS consultan esa misma decisión.

Escritura y lectura de Presupuestos V1: `owner` y `admin`.

## Habilitar SUR4 después del merge

No forma parte de este cambio aplicarlo en Production. En una base local:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  node scripts/set-tenant-feature.mjs \
  --tenant sur4 \
  --feature quotes \
  --enabled true
```

El script rechaza cualquier host que no sea `localhost` o `127.0.0.1`. Repetirlo actualiza el mismo override.

## Archivos compartidos con Pedido V2

- `lib/nav/items.ts` y `components/app-nav.tsx`
- `app/api/context/route.ts`
- `lib/activity/types.ts` y `lib/activity/format.ts`
- `public.list_activity_log` y `public.create_organization`
- `supabase/seeds/demo-commercial.sql`

Pedido V2 ya está en `main`. La conversión no envía `file_status_id`: queda vacío, igual que un pedido creado sin ese dato. No se ha modificado el pedido rápido, la UI de archivos ni el contrato de `POST /api/orders`.
