# Kiosk V1 — operación y gates

## Estado de merge

No mergear mientras `Kiosk Supabase security` no esté verde. Ese workflow
reconstruye PostgreSQL desde migraciones, ejecuta las pruebas de seguridad y
aplica/verifica el rollback en una base efímera.

## Prerrequisitos por entorno

1. Generar un secreto aleatorio independiente de al menos 32 caracteres.
2. Guardarlo cifrado en Supabase Vault con el nombre
   `kiosk_signing_secret`.
3. Configurar el mismo valor en Vercel como variable server-only
   `KIOSK_SIGNING_SECRET`.
4. No reutilizar `SUPABASE_SERVICE_ROLE_KEY`.

Ejemplo para Vault, ejecutado una vez por un operador autorizado:

```sql
select vault.create_secret(
  '<valor-aleatorio-del-entorno>',
  'kiosk_signing_secret',
  'Kiosk request signing'
);
```

Si Vault y Vercel no coinciden, Kiosk falla cerrado.

## Opt-in por tenant

La migración no habilita ningún tenant. Kiosk solo está disponible cuando el
tenant tiene exactamente un canal activo con `code = 'kiosk'`. Desactivar ese
canal desactiva Kiosk sin cambiar código ni infraestructura.

## Frontera Vercel y WAF

La aplicación solo confía en Vercel cuando `VERCEL=1`, exige coincidencia
estricta entre `Host` y `X-Forwarded-Host` y obtiene la IP de
`X-Vercel-Forwarded-For`. En producción fuera de Vercel falla cerrada.

Antes de exponer Kiosk comercialmente, crear reglas Vercel Firewall:

- `POST /api/kiosk/orders`: máximo 5 solicitudes/minuto/IP.
- `GET /kiosk`: máximo 30 solicitudes/minuto/IP.
- bloquear métodos distintos de `POST` en `/api/kiosk/orders`.
- conservar Managed Rules/Bot Protection cuando estén disponibles en el plan.

La admisión distribuida de PostgreSQL sigue siendo la autoridad para POST; el
WAF reduce tráfico antes de ejecutar Next.js. El bootstrap aplica además un
límite DB independiente.

## Validación reproducible

En un runner con Docker:

```bash
npx supabase@2.117.0 start \
  --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
npx supabase@2.117.0 db reset --local --no-seed
npx supabase@2.117.0 test db --local \
  supabase/tests/phase12_kiosk_public_orders.sql
```

## Rollback exacto

Solo sobre una base validada y con una copia de seguridad:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/rollbacks/20260915191521_kiosk_public_orders.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/rollbacks/verify_20260915191521_kiosk_public_orders.sql
```

El rollback elimina wrappers, tablas y funciones Kiosk; elimina el esquema
`kiosk_private`; y restaura exactamente
`public.tg_activity_log_order_created()` al contrato anterior. No elimina ni
modifica canales porque la migración nunca los crea.
