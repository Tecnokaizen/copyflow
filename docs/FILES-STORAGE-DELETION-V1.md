# Files V1.1 — Eliminación física recuperable (outbox transaccional)

Migración: `supabase/migrations/20261014120000_files_storage_deletions_v1.sql`
Rollback no destructivo: `supabase/rollbacks/20261014120000_files_storage_deletions_v1.sql`
Tests: `supabase/tests/phase46_files_storage_deletion.sql`,
`supabase/tests/phase46_files_storage_deletion_concurrency.sh`,
`lib/files/storage-deletion.test.ts`.

## Protocolo

PostgreSQL y R2 no comparten transacción. Ningún flujo borra un objeto de R2
sin una reserva confirmada en PostgreSQL.

```
DELETE usuario (pedido/presupuesto)
  ruta: rol, archivado, tenant, storage_key == ids
  RPC soft_delete_*_file (authenticated + HMAC 'delete'):
      FOR UPDATE · deleted_at/deleted_by · INSERT outbox      ← una transacción
  (opcional) claim_storage_deletion → deleteObject → finish   ← service_role, servidor
  204

Cron diario /api/internal/files/cleanup (CRON_SECRET)
  claim_expired_file_uploads   pending+caducado: FOR UPDATE SKIP LOCKED
                               → INSERT outbox + DELETE metadatos  ← una transacción
  claim_storage_deletions      lease (token + caducidad) SKIP LOCKED
  deleteObject (404 = éxito)   clave validada en SQL (CHECK) y TS
  finish_storage_deletion      exige el token de lease vigente
```

- Los lectores (listados, download, preview, impresión, PDF, cuota) ya
  tratan `deleted_at IS NOT NULL` o la fila inexistente como "no existe":
  tras la reserva no se emiten URLs firmadas.
- Un COMPLETE tardío encuentra `deleted_at` o ninguna fila → `file not found`.
- Un archivo `pending` borrado por el usuario no se borra de R2 hasta
  `upload_expires_at + 5 min` (la URL PUT firmada podría seguir viva).
- Los PDFs oficiales se rechazan en la RPC (`quote_pdf_file_guard`,
  `official_pdf_protected` → HTTP 409 `OFFICIAL_PDF_PROTECTED`) antes de
  cualquier escritura o llamada a R2.

## Estados de una tarea (`files_private.storage_deletions`)

| Estado | Significado | Sale por |
|---|---|---|
| `pending` | Pendiente (o reintento con `next_attempt_at`) | claim |
| `processing` | Lease activo (`lease_token`, `lease_until`) | finish, o caducidad del lease → nuevo claim |
| `completed` | Objeto borrado (o ya inexistente) | terminal |
| `failed` | `max_attempts` (10) agotados, clave con fila viva, o clave inválida | solo `requeue_storage_deletion` (manual) |

Cada transición queda en `files_private.storage_deletion_events`.
Una tarea nunca modifica metadatos de archivos: no puede reactivar nada.

## Permisos

| Función | anon | authenticated | service_role | postgres |
|---|---|---|---|---|
| `soft_delete_order_file` / `soft_delete_quote_file` | — | ✔ (HMAC) | — | ✔ |
| `claim_expired_file_uploads`, `claim_storage_deletions`, `claim_storage_deletion`, `finish_storage_deletion`, `storage_deletion_backlog` | — | — | ✔ | ✔ |
| `requeue_storage_deletion` | — | — | — | ✔ (sesión postgres) |
| tablas `files_private.*` | — | — | — | ✔ |

El cliente service_role solo se usa en route handlers del servidor
(`lib/files/storage-deletion-server.ts`, `server-only`).

## Detección y recuperación

Respuesta del cron: `deletions` (claimed/completed/retry_scheduled/failed/stale/finish_errors)
y `backlog` (`pending`, `processing`, `stale_leases`, `failed`, `oldest_pending_at`).
Si `backlog.failed > 0` se registra `storage deletions require recovery`.

SQL editor (sesión postgres):

```sql
-- Tareas fallidas
select id, file_kind, tenant_id, file_id, storage_key, reason, attempts,
       manual_requeues, last_error, failed_at
from files_private.storage_deletions
where status = 'failed'
order by failed_at;

-- Historial de una tarea
select * from files_private.storage_deletion_events
where deletion_id = '<id>' order by id;

-- Atascadas (lease caducado sin cron)
select id, attempts, lease_until from files_private.storage_deletions
where status = 'processing' and lease_until < now();
```

Recuperación controlada:

1. Leer `last_error` y los eventos.
2. `live metadata references storage key`: NO reencolar; investigar por qué
   existe una fila visible con esa clave.
3. `storage key does not match ids`: NO reencolar; incidencia de integridad.
4. Error de R2 (red, credenciales, 5xx) ya resuelto:
   `select public.requeue_storage_deletion('<id>', '<motivo e incidencia>');`
   (nota obligatoria; reinicia `attempts`, incrementa `manual_requeues`,
   conserva `last_error`). El siguiente cron la procesa y vuelve a comprobar
   referencias vivas.

No hay reintentos infinitos: tras `max_attempts` la tarea queda `failed`.

## Despliegue (Staging primero)

1. Aplicar la migración (antes que el código). El código anterior sigue
   funcionando: sus DELETE encolan tareas que el cron nuevo cerrará (borrar un
   objeto ya borrado es idempotente).
2. Desplegar el código.
3. Verificar: borrar un archivo de prueba → 204, fila con `deleted_at`, tarea
   `completed`; ejecutar el cron manualmente → `ok: true`, `backlog.failed = 0`.

Rollback de código: seguro sin tocar la base de datos.
Rollback de base de datos: script no destructivo (restaura RPC anteriores,
revoca EXECUTE de mantenimiento a service_role, conserva todas las tareas).
Nunca borrar `files_private.storage_deletions` con tareas no finalizadas.

## Expand / contract

Expand (esta migración): tabla + RPC nuevas; `soft_delete_*` amplían su
respuesta (`storage_deletion_id`); `purge_expired_*_file` y el SELECT de
service_role sobre `order_files` se conservan.

Contract (migración futura, tras validar Production): eliminar
`purge_expired_order_file` / `purge_expired_quote_file`, revocar
`SELECT ON public.order_files/quote_files FROM service_role` si nada más lo
usa, y retirar `selectCleanupCandidates` (`lib/files/cleanup.ts`).

## Riesgos fuera de alcance

| Riesgo | Severidad | Contención propuesta |
|---|---|---|
| Borrado físico de `orders`/`tenants` (DELETE solo para service_role/postgres) o de `quotes` (solo postgres): `ON DELETE CASCADE` elimina `order_files`/`quote_files` sin encolar la eliminación en R2 → objetos huérfanos en bucket privado (sin URL emitible, pero retenidos). No existe ninguna ruta de aplicación ni función SQL que lo haga hoy. | Media (retención de datos) / Baja (seguridad) | Prohibir borrados físicos manuales; procedimiento de baja de tenant que encole por prefijo `orders/{tenant}/`, `quotes/{tenant}/`, `branding/{tenant}/`; trigger `BEFORE DELETE` que encole filas borradas fuera de `claim_expired_file_uploads` (trabajo aparte). |
| Logos (`branding/{tenant}/logo/*`): ya persisten primero en BD; un fallo de R2 deja huérfano, nunca metadatos rotos. | Baja | Barrido periódico de huérfanos por prefijo (trabajo aparte). |
| Inconsistencias anteriores a esta versión (filas `ready` sin objeto). | Media | Conciliación de solo lectura (HEAD por fila `ready`) — trabajo aparte. |
| URLs GET firmadas antes de la reserva siguen válidas ≤ 5 min o hasta el borrado en R2. | Baja | Inherente a URLs firmadas; TTL corto. |
| La cuota se libera al ocultar el archivo, no al borrarlo de R2. | Baja | Comportamiento previo, sin cambios. |
| `purge_expired_*_file` comprueba `CURRENT_USER`, que dentro de SECURITY DEFINER siempre es el propietario: la protección real es el GRANT. | Baja | Retirar en la fase contract. |
