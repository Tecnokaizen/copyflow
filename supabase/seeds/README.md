# Seeds — Gestcopy

## `demo-commercial.sql`

Seed comercial **explícito** para el tenant con slug `demo` (`demo.app.gestcopy.com`).

### Qué hace

Reconstruye el dataset operativo de DEMO como una copistería generalista:

- 5 categorías + 12 servicios
- 30 clientes
- 7 `team_members` operativos (sin Auth)
- 200 pedidos (`150` Recogido + `8` Cancelado + `42` operativos)
- ~60–67 eventos de `activity_log` con actores de equipo ficticios
- payloads de activity **compatibles con los triggers reales** y con `lib/activity/format.ts`
- catálogos de configuración (estados, canales, tipos, etc.)
- fechas relativas a `now()` en TZ `Europe/Madrid`

Marca de dataset: `metadata.seed = "gestcopy-demo-commercial-v1"`.

### Qué borra (solo `slug = demo`)

Dentro de una transacción, y **solo** con `tenant_id` del tenant demo:

- `activity_log`
- `orders`
- `clients`
- `services` / `service_categories`
- `team_members` **solo si todos tienen** `user_id IS NULL`
- catálogos configurables del tenant (estados, canales, contextos, etc.)
- `order_number_counters` del tenant demo

### Guard de `team_members`

Antes de borrar/reconstruir el equipo operativo:

- si existe **cualquier** `team_members.user_id IS NOT NULL` en DEMO → `RAISE EXCEPTION` y **rollback total**
- no se borra, no se modifica, no se continúa en silencio

Tras el seed se valida:

- `count(*)` de `team_members` en demo = **7**
- `count(*)` con `user_id IS NOT NULL` = **0**

### Qué preserva

- `tenants`
- `memberships`
- Auth / `profiles`
- `subscriptions` / planes globales
- fila de `tenant_settings` (se actualiza de forma controlada, no se elimina)

### Restricciones de seguridad

- **DEMO ONLY**
- **NEVER TOUCH SUR4**
- resuelve el tenant por `slug = 'demo'` (exactamente 1 fila)
- aborta si `sur4` no existe o si `demo.id = sur4.id`
- todas las escrituras van con `tenant_id = v_demo`
- validaciones pre-`COMMIT`; cualquier fallo hace rollback

### Actor técnico

Los triggers de `activity_log` requieren `auth.uid()` + membership.

El script:

1. elige dinámicamente un `owner` activo del tenant demo
2. configura `request.jwt.claim.sub` / `request.jwt.claims` (igual que los tests del repo)
3. self-check de `auth.uid()` y `has_tenant_role(..., owner)`
4. **no** crea/modifica Auth ni memberships

La timeline comercial final usa `user_id = NULL` + `team_member_id` ficticio para que la UI muestre nombres como Laura Vega / Iván Delgado, no perfiles Owner reales.

Los eventos curados replican el contrato de `tg_activity_log_*` (p. ej. `status_name`, `option_name`, `metadata.field`, `metadata.reference`) para que `formatActivityEvent()` renderice frases comerciales legibles.

### Referencias de pedido

No asigna `DEMO-0001` a mano. Deja activo `tg_assign_order_reference` y resetea solo el counter del tenant demo para regenerar desde `DEMO-0001`.

### Idempotencia

Puede ejecutarse más de una vez: cada ejecución reconstruye íntegramente el dataset operativo de DEMO (resultado estable: 30/7/12/200, no duplicados).

### NO automático

**No** está conectado a `supabase db reset`.  
**No** modificar `supabase/config.toml` para ejecutarlo en cada reset.

### Cómo revisar antes de ejecutar

1. Leer este README y el encabezado del SQL.
2. Confirmar entorno (solo el proyecto Gestcopy esperado).
3. Confirmar que el tenant `demo` existe y que no estás en un flujo SUR4/cliente.
4. Tener claro que es **destructivo para datos operativos de DEMO**.

### Cómo ejecutar (cuando se apruebe)

Ejemplo con CLI local (ajusta conexión; **no** pegues secretos en el repo):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/demo-commercial.sql
```

O pegar el archivo en el SQL Editor del proyecto Supabase correspondiente, ejecutándolo completo.

### Cómo verificar después

Comprobar en tenant demo:

- 200 pedidos, referencias distintas `DEMO-…`
- 30 clientes / 7 equipo / 12 servicios / 5 categorías / 5 estados
- 150 recogidos / 8 cancelados / 42 operativos
- actividad reciente con actores de equipo
- tenant `sur4` intacto

### Prohibido

- ejecutar este seed contra SUR4 u otros tenants
- usarlo en clientes reales
- desactivar triggers / `session_replication_role`
- instalar extensiones o cambiar schema/RLS/RPC/Auth
