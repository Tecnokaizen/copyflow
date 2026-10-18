# Concesiones de funcionalidades por tenant V1 (Frente A1)

Concesiones auditables y temporales sobre `tenant_feature_overrides`: cada
override lleva motivo, operador, fecha de concesión y una fecha de revisión
opcional, y cada cambio queda en un historial de solo inserción. Desbloquea la
importación de SUR4 (A2/A3), la voz (B1, #90) y la conciliación de Basic/Pro
(C1, R5 del [ADR #134](https://github.com/Tecnokaizen/copyflow/pull/134)).

**No es un segundo sistema de permisos:** la resolución sigue siendo
`tenant_has_feature` (override, después plan `active`/`trialing`, si no
`false`), sin cambios. Nada caduca ni se revoca solo.

## Qué cambia

| Pieza | Cambio |
| --- | --- |
| `supabase/migrations/20261018180000_tenant_feature_grants_audit_v1.sql` | Columnas `reason`, `granted_by`, `granted_at` y `review_at` en `tenant_feature_overrides`; tabla `tenant_feature_override_events`; `set_tenant_feature_v2`, `clear_tenant_feature_override` y `list_tenant_feature_reviews_due`; triggers de auditoría; TRUNCATE de los overrides bloqueado. Aditiva y en una transacción |
| `supabase/rollbacks/20261018180000_tenant_feature_grants_audit_v1.sql` + `verify_…` | Rollback exacto (se niega si perdería historial) y su verificación |
| `supabase/tests/phase54_tenant_feature_grants.sql` | Suite SQL de seguridad y comportamiento, en el Release Gate |
| `supabase/tests/phase54_tenant_feature_grants_concurrency.sh` | Concurrencia real y ciclo rollback → reaplicación, en `kiosk-supabase.yml` |
| `lib/features/tenant-feature-grants-guards.test.ts` | Guardas estáticas: hueco de la migración, funciones heredadas intactas, sin concesiones ni caducidad, privilegios, rollback y CI |

Sin cambios en la aplicación, en `set_tenant_feature`, en `tenant_has_feature`,
en planes, suscripciones, precios, cuotas ni Stripe. Ningún tenant recibe nada.

## Auditoría del estado previo

| Objeto | Hallazgo |
| --- | --- |
| `tenant_feature_overrides` | RLS activa y sin políticas. `anon`/`authenticated` sin privilegios. `service_role` solo con los de defecto: TRUNCATE, REFERENCES, TRIGGER y MAINTAIN (sin SELECT ni escritura). Sin motivo, operador, revisión ni historial |
| `set_tenant_feature(slug, code, enabled, limit)` | EXECUTE solo para `service_role`. **Su comprobación interna es inútil:** mira `current_user`, que dentro de `SECURITY DEFINER` es siempre el propietario (`postgres`). La única barrera real es el GRANT. No se toca (firma, cuerpo y permisos); A1 registra sus llamadas |
| `tenant_has_feature(tenant, code)` | Correcta: `authenticated` necesita membership activa; operador = JWT `service_role` o sesión `postgres`/`supabase_admin` sin JWT. Ignora `limit_value` y `livemode`. No se toca |
| Retirada | No existía: `set_tenant_feature` solo hace *upsert*. Volver a «sin override» exigía un `DELETE` manual sin rastro |
| TRUNCATE | `service_role` (y el propietario) podían vaciar todos los overrides sin rastro |

## Diseño

### Términos del override

`reason` (1–500), `granted_by` (1–200), `granted_at` y `review_at`. Los tres
primeros van juntos o ninguno (CHECK). **Solo `set_tenant_feature_v2` los
escribe**; el trigger `BEFORE` lo garantiza:

- Una inserción por otra vía (v1, SQL directo) los deja a `NULL`.
- Un cambio de `enabled` o `limit_value` por otra vía borra `reason`,
  `granted_by` y `granted_at` (ya no explican el estado) y **conserva**
  `review_at` (el recordatorio del operador no se pierde en silencio).
- Una llamada sin cambios (p. ej. v1 idempotente) los conserva.
- La clave `(tenant_id, feature_id)` no se puede modificar.

Invariante: si un override tiene motivo, coincide con el del último evento, que
es de `set_tenant_feature_v2`.

### Historial: `tenant_feature_override_events`

Una fila por cada INSERT, UPDATE o DELETE de un override, sea cual sea la vía,
con valores antiguos y nuevos (`enabled`, `limit_value`, `review_at`), motivo y
operador del cambio, y el actor técnico (`session_user`, rol del JWT y `sub`).

| `source` | Cuándo | Motivo y operador |
| --- | --- | --- |
| `set_tenant_feature_v2` | concesión o cambio | obligatorios |
| `clear_tenant_feature_override` | retirada | obligatorios |
| `set_tenant_feature` | llamada a la v1 | `NULL` |
| `direct_sql` | DML del propietario | `NULL` |
| `tenant_deleted` / `feature_deleted` | cascada al borrar el tenant o la funcionalidad | `NULL` |
| `migration` (`action = baseline`) | overrides existentes al aplicar A1 | texto fijo |

- **Solo inserción:** UPDATE, DELETE y TRUNCATE se rechazan incluso para el
  propietario (trigger). Solo quien pueda desactivar triggers (dueño de la
  tabla) podría alterarlo, y eso exige una operación deliberada fuera de las
  migraciones (la guarda de migraciones la marca).
- **Sin claves foráneas:** el historial sobrevive al tenant y a la funcionalidad
  (guarda `tenant_slug`/`feature_code` mientras existen).
- **Sin privilegios para ningún rol de API**, tampoco `service_role`; RLS activa
  sin políticas. Se consulta como propietario (editor SQL).
- **Atribución:** el trigger lee el llamante PL/pgSQL inmediato en
  `PG_CONTEXT` (primera línea `PL/pgSQL function` tras la suya). Así reconoce
  la v1 sin modificarla. Una vía desconocida queda como `direct_sql`: la
  atribución puede degradarse, nunca bloquear un cambio, y la suite falla si
  ocurre. La retirada pasa motivo y operador en el ajuste local de transacción
  `app.tenant_feature_override_clear` (patrón `app.order_lifecycle`), que el
  trigger solo acepta si el llamante es `clear_tenant_feature_override`.

### Funciones de operador

Las tres: `SECURITY DEFINER`, `search_path = ''`, EXECUTE solo para
`service_role` (revocado a `public`, `anon` y `authenticated`) y, dentro, la regla
de operador de `tenant_has_feature`: `auth.role() = 'service_role'` o
`session_user in ('postgres', 'supabase_admin')` sin JWT. (`current_user` no sirve
dentro de `SECURITY DEFINER`.)

| Función | Qué hace |
| --- | --- |
| `set_tenant_feature_v2(p_slug, p_code, p_enabled, p_limit, p_reason, p_review_at, p_operator)` | *Upsert* del override con sus términos y un evento, en la misma transacción. Todos los argumentos son explícitos: `p_limit` y `p_review_at` admiten `NULL`. `p_review_at` debe ser futura y se guarda tal cual (`NULL` la quita). Devuelve `event_id`, `action`, `previous` y `current`. Errores: `42501` (no operador), `22023` (argumento inválido), `P0002` (tenant o funcionalidad inexistente) |
| `clear_tenant_feature_override(p_slug, p_code, p_reason, p_operator)` | Borra el override: el tenant vuelve a resolver por su plan, como antes de cualquier override. Idempotente: sin override devuelve `removed = false` y no escribe nada |
| `list_tenant_feature_reviews_due(p_as_of default now())` | Informe de solo lectura: overrides con `review_at <= p_as_of`. No cambia nada |

`set_tenant_feature` (v1) sigue disponible y con el mismo comportamiento; sus
llamadas quedan en el historial sin motivo. Los runbooks nuevos deben usar la v2.

### Decisiones técnicas

- **Todo en `public`, sin esquema privado nuevo:** coherente con
  `tenant_feature_overrides` y sin tocar `release_gate_security_invariants.sql`,
  que #135/#136 ya modifican (habría conflicto textual). El aislamiento lo dan
  RLS sin políticas y la ausencia de privilegios.
- **`review_at` no desactiva nada:** `tenant_has_feature` no lo lee (la suite lo
  comprueba) y no hay cron ni trigger temporal. Revisar es una decisión del
  operador con `list_tenant_feature_reviews_due`.
- **TRUNCATE bloqueado en los overrides** (trigger) y retirado a
  `service_role`: vaciarlos saltaría el historial. Nadie lo usaba.
- **Evento de línea base** por cada override existente al migrar (Production:
  los de SUR4 y demás pilotos), para que el historial explique el estado actual
  desde el primer día.

## Operación (solo operador de confianza)

Editor SQL del proyecto correcto como `postgres`, o `service_role`. Antes de
cada operación, comprobar el **id** del tenant en ese entorno (no solo el slug)
y guardar la foto previa. Patrón:

```sql
begin;
do $op$
declare
  v_expected constant uuid := '<id real del tenant en este entorno>';
begin
  if (select t.id from public.tenants t where t.slug = '<slug>' and t.active)
     is distinct from v_expected then
    raise exception 'preflight: el tenant no coincide con el entorno esperado';
  end if;
  if to_regprocedure('public.set_tenant_feature_v2(text,text,boolean,bigint,text,timestamptz,text)') is null then
    raise exception 'preflight: A1 no está aplicada';
  end if;
  raise notice '%', public.set_tenant_feature_v2(
    '<slug>', '<code>', true, null,
    '<motivo verificable: acuerdo, ticket, piloto>',
    '<fecha de revisión UTC o null>'::timestamptz,
    '<operador responsable>');
end;
$op$;
commit;
```

- **Cambiar** (límite, revisión, `false` explícito): la misma llamada con los
  nuevos valores y un motivo nuevo. Un `false` explícito prevalece sobre el plan.
- **Retirar** (volver a la ausencia de override):
  `select public.clear_tenant_feature_override('<slug>', '<code>', '<motivo>', '<operador>');`
- **Revisiones vencidas:** `select * from public.list_tenant_feature_reviews_due();`
- **Historial de un tenant:**
  `select * from public.tenant_feature_override_events where tenant_id = '<id>' order by id;`

Reglas operativas: no retirar `clients_import` con lotes de importación abiertos
(la retirada bloquea también la reversión); el resto de overrides, suscripciones
y catálogo no se tocan; cada operación en Production necesita su propia
autorización. La concesión de SUR4 (A3) es una operación posterior y separada.

## Compatibilidad

- **Orden de migraciones:** Staging ya tiene D2/D1 (`20261018160000`, `161000` y
  `170000`, aplicadas el 18/10 desde #135/#136), así que A1 va **después** de
  ellas: #128 → D2 → D1 → **A1** (`20261018180000`) → #90 → C1. Consecuencias:
  - en `main`, #135 y #136 se integran **antes** que A1 (si A1 entrara antes, la
    guarda de migraciones bloquearía las suyas, que ya no se pueden renumerar);
  - en Production, D2/D1 se aplican antes que A1 o en el mismo `db push`;
  - #90 (`20261018150000`) tampoco entra ya en Staging por el procedimiento
    estándar: hay que renumerarla por encima de A1 (p. ej. `20261018190000`).
- **#90 (voz, phase53):** sigue usando `set_tenant_feature`;
  funciona igual y queda registrado como `source = set_tenant_feature`. Su
  `phase53_ai_voice_budget_concurrency.sh` borra overrides con `DELETE`
  directo: se registra como `direct_sql`. Sin conflictos de texto
  (`git merge-tree`).
- **#135/#136 (Billing D2/D1, `20261018160000`–`170000`, phase55–57):** no tocan
  overrides; sin conflictos de texto.
- **phase47 (acceso anticipado):** pasa sin cambios.
- **Production:** las llamadas actuales a la v1 y la resolución no cambian.

## Validación local

Pila Supabase aislada (`supabase@2.117.0`, Postgres 17.6), todas las
migraciones desde cero.

| Gate | Resultado |
| --- | --- |
| Guarda de migraciones (`check-migrations.ts`, base `main` `67543ee`) | PASS (1 migración, aditiva) |
| `TZ=UTC npx tsx --test` | 1309/1309 PASS |
| `tsc --noEmit` · `npm run lint` · `npm run build` | OK · 0 errores (4 avisos previos en `lib/orders/quote-situation.test.ts`) · OK |
| Release Gate SQL (invariantes + 23 suites, `phase54` incluida) | PASS |
| Secuencia completa de `kiosk-supabase` (trigger previo a Kiosk, todas las suites y concurrencias, `phase54` .sh, rollback de Kiosk y diff) | PASS de principio a fin en la segunda pasada. En la primera fallaron dos pruebas ajenas a A1: el falso positivo de `phase51_order_lines_concurrency.sh` (corregido en #135; las dos pasadas usan esa corrección en una copia fuera del repo) y la fila huérfana de #137 en `files_private.storage_deletions` |
| `phase54_tenant_feature_grants_concurrency.sh` repetido 4 veces | PASS (sin intermitencias) |
| Rollback de A1 frente a `db reset --version 20261018170000` (`main` + D2/D1) | `pg_dump --schema-only -n public` idéntico (salvo los tokens `\restrict`) |
| Ensayo del procedimiento de Staging en local (BD con el mismo historial que Staging: 82 versiones, md5 `d705e8d1…`) | El `db push --dry-run` estándar lista solo `20261018180000`; `db push` la aplica (83). Con el número anterior (`20261017120000`) el CLI la rechaza y pide `--include-all`; lo mismo le pasa a #90 con `20261018150000`. Desde el árbol de esta PR sin los ficheros de D2/D1, el CLI falla («Remote migration versions not found») |
| Guarda de migraciones según el orden de integración en `main` (merges simulados) | A1 renumerada después de #135/#136: PASS. #136 después de A1 renumerada: FAIL (sus tres versiones quedarían por debajo). Con `20261017120000`, al revés: solo pasa si A1 entra antes que #135/#136 |
| `main` + D2/D1 + A1 (`20261018180000`) desde cero | Release Gate SQL de ese árbol (facturación incluida), `phase57` y `phase54` .sh: 40/40 PASS |
| Migración sobre una BD con overrides previos | un evento `baseline` por override; rollback sin opt-in permitido (solo línea base) |
| Árboles combinados desde cero (`git merge-tree`): A1 + #90 · A1 + #136 (incluye #135) · A1 + #90 + #136 | 81 · 83 · 84 migraciones; Release Gate SQL de cada árbol más `phase53`/`phase57`/`phase54` .sh: todo PASS |
| Inyección de fallos (cada una hace fallar `phase54`) | EXECUTE de v2 a `authenticated`; trigger de solo inserción desactivado; SELECT del historial a `service_role`; v2 sin la comprobación interna; `tenant_has_feature` que obedece `review_at`; contexto de retirada que sobrevive a la llamada |

## Aplicar A1 en Staging (requiere autorización)

Staging (`fmmfsbhcwxkaszrrarpw`), consultado en solo lectura el 18/10: 82
migraciones (las 79 de `main` más D2/D1; última `20261018170000`; md5 de la lista
`d705e8d13773ecf066c9719b6e95b02b`, igual que el árbol de #136), ningún objeto de
A1 y los overrides `demo.quotes`, `e2e.quotes`,
`e2e.clients_import` y `e2e-import.clients_import`. No hay datos de SUR4.

1. **Foto previa (solo lectura):** número y md5 de la lista de versiones de
   `supabase_migrations.schema_migrations`; que no exista
   `tenant_feature_override_events`; overrides (`tenant`, `code`, `enabled`,
   `limit_value`) y su hash; resolución `tenant_has_feature` como operador para
   cada tenant × código del catálogo; hash de suscripciones, planes,
   `plan_features` y `billing_prices`; md5 de `set_tenant_feature` y
   `tenant_has_feature`.
2. **Dry-run** desde un directorio enlazado a Staging con exactamente las 82
   migraciones de Staging más la de A1 (`main` tras integrar #135, #136 y A1;
   antes, el árbol de #136 más el fichero de A1):
   `npx supabase@2.117.0 db push --linked --dry-run` debe listar **solo**
   `20261018180000_tenant_feature_grants_audit_v1.sql`. Si lista otra cosa,
   parar. Nunca `--include-all`. Si responde «Remote migration versions not
   found in local migrations directory», al directorio le faltan los ficheros
   de D2/D1: **no** seguir su sugerencia (`migration repair --status reverted …`
   o `db pull`), que borraría D2/D1 del historial de Staging; parar y corregir
   el directorio.
3. **Aplicar:** `npx supabase@2.117.0 db push --linked`.
4. **Postchecks (solo lectura):** 83 migraciones; tantos eventos `baseline`
   como overrides y ningún otro; overrides, resolución, hashes de facturación y
   md5 de las dos funciones heredadas idénticos a la foto previa; el historial
   sin privilegios para `anon`/`authenticated`/`service_role`; las tres funciones
   con EXECUTE solo para `service_role`.
5. **Prueba en transacción revertida** (tenant sintético, no deja nada):
   `begin; select public.set_tenant_feature_v2('e2e', 'clients_import', true, null, 'A1 smoke', now() + interval '1 day', '<operador>'); select * from public.tenant_feature_override_events order by id desc limit 1; rollback;`
6. **Regresión:** workflow `E2E staging` (V0 y presupuestos) sobre la rama de
   Staging. A1 no cambia código de aplicación: no hace falta desplegar.
7. **Después:** A2 (ensayo en Staging con tenants sintéticos) y, con su propia
   autorización, Production con el mismo procedimiento, después de D2/D1 (o en
   el mismo `db push`) y antes de #90.

**Si algo falla:** la migración es una única transacción; si falla, no se
aplica nada. Para revertir una A1 ya aplicada: exportar el historial, aplicar el
rollback con `PGOPTIONS='-c app.rollback_tenant_feature_grants=discard_history'`
si hay eventos que no son de línea base, ejecutar el `verify_…` y marcar
`supabase migration repair --status reverted 20261018180000`. Ningún override
cambia de valor al revertir.

## Pendiente

- A2 (ensayo en Staging) y A3 (SUR4 en Production), con autorización.
- Actualizar los runbooks de #90 y de acceso anticipado a la v2 cuando A1 esté
  integrada.
- Retirar o endurecer la v1 (su comprobación interna) en una PR posterior, una
  vez que ningún runbook la use.
