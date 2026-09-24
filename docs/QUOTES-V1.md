# Presupuestos V1

Módulo independiente de presupuestos. No sustituye `orders.quote_status_id`.

## Diferencias con el diseño de partida

- `quote_statuses` ya existía y no tiene `is_initial`. El estado inicial de un presupuesto es el código `draft`.
- El catálogo visible es `draft` Borrador, `pending` En revisión, `sent` Enviado, `accepted` Aceptado y `rejected` Rechazado. `pending` se conserva. Si el nombre sigue siendo exactamente "Pendiente", pasa a "En revisión"; un nombre ya personalizado no se pisa. `sent` se añade sin borrar estados.
- Un presupuesto es trabajo potencial. No entra en los KPIs de pedidos. El panel muestra un bloque aparte solo si la feature `quotes` está activa y el rol puede abrir Presupuestos.
- `valid_until` sigue siendo una fecha, sin hora. `orders.due_at` sigue siendo timestamptz. La hora de entrega se convierte con la zona del navegador (`fromDateTimeLocalValue` / `toDateTimeLocalValue`), no con `tenant_settings.timezone`. Si esa hora local no vuelve idéntica, como `2026-03-29T02:30` en Europe/Madrid, la conversión devuelve null y la interfaz no deja guardarla.
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

Lectura, creación, edición, cambio de estado y conversión de Presupuestos V1: `owner`, `admin`, `manager` y `staff` (Personal), siempre con la feature `quotes` activa y membership operativa del tenant. `viewer` queda fuera. El gate común se comparte entre navegación, páginas, acciones, panel y APIs; RLS y las RPC vuelven a comprobar rol y feature en PostgreSQL.

La actividad de una ficha se lee mediante `list_quote_activity(p_quote_id)`, `SECURITY DEFINER` con `search_path` vacío. Devuelve como máximo los 50 eventos más recientes del presupuesto, filtrando `tenant_id`, `entity_type = quote` y `entity_id`. Un UUID inexistente o sin acceso devuelve una lista vacía. El endpoint comprueba además que el presupuesto pertenece al tenant del contexto. Esto no amplía la lectura directa de `activity_log` ni `list_activity_log`: Activity global sigue reservado a `owner`, `admin` y `manager`.

No hay archivado ni borrado en V1: se mantienen los permisos por columna y no se concede DELETE. `tenant_id`, referencia y enlace de conversión siguen protegidos.

El ajuste se instala con la migración aditiva `20260924160000_quotes_operational_access.sql`, después de las migraciones V1 existentes. No editar ni reaplicar `20260923190000_quotes_v1.sql` como sustituto. Aplicar la nueva migración antes de servir la versión del endpoint que llama a `list_quote_activity`; esta PR no ejecuta migraciones en Production ni modifica overrides.

Validación: `lib/quotes/access.test.ts` cubre la matriz de roles/feature y el uso del gate común; `phase34_quotes_operational_access.sql` comprueba RLS, operaciones, actividad acotada, aislamiento y revocación. `phase33_quotes_v1.sql` conserva los invariantes anteriores y `phase33_quotes_concurrency.sh` se ejecuta como owner y con `QUOTE_TEST_ROLE=staff`. Estas suites están incluidas en CI.

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

## Estado en Production

`quotes` no está incluida en Gestcopy Basic ni en el plan `mvp`. Esta PR no crea, cambia ni borra overrides.

SUR4 ya tiene un override explícito `quotes = true` en `tenant_feature_overrides`, aplicado en el smoke de #39. Los demás tenants no quedan habilitados por este cambio.

Para otro tenant, un operador con sesión `postgres` o `service_role` en el SQL Editor ejecuta `public.set_tenant_feature`. La función no está concedida a `authenticated`. No usar `scripts/set-tenant-feature.mjs` fuera de localhost y no copiar credenciales al repositorio.

## Archivos compartidos con Pedido V2

- `lib/nav/items.ts` y `components/app-nav.tsx`
- `app/api/context/route.ts`
- `lib/activity/types.ts` y `lib/activity/format.ts`
- `public.list_activity_log`, `public.create_organization` y `public.create_internal_organization_v1`
- `supabase/seeds/demo-commercial.sql`

Pedido V2 ya está en `main`. La conversión no envía `file_status_id`: queda vacío, igual que un pedido creado sin ese dato. El pedido completo, el pedido rápido y la edición de entrega prevista usan el selector compartido de fecha y hora. No se ha modificado la UI de archivos, el kiosk ni el contrato de `POST /api/orders`.
