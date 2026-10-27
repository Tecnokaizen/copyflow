# Migración `20261028090000_commercial_plans_pro_offers_v1`

Alcance, dependencias, riesgos y procedimiento de aplicación, verificación y recuperación. Complementa [BILLING-PRO-OFFERS-V1.md](BILLING-PRO-OFFERS-V1.md) (PR #158).

**Estado (28/10/2026):**
- **Staging** (`fmmfsbhcwxkaszrrarpw`): aplicada. 87 migraciones. Autorización, verificación y compatibilidad en la sección 0.
- Hay una copia completa de Staging, cifrada y restaurada con éxito en una base aislada, tomada **después** de aplicarla.
- **Production** (`wsclqvlzjdgwkxbolhoy`): no aplicada ni autorizada.
- La autorización para Staging es independiente de la de Production.
- **Despliegue selectivo y E2E:** en espera del cierre formal del Release Gate R5/R6.

## 0. Staging: estado real, autorización y verificación (28/10/2026)

**Estado:**
- Código desplegado: `gestcopy-staging` 1b11745, sin cambios.
- Base de datos: 87 migraciones; la última, `20261028090000`.
- Los commits 494ba33 y 1ea797e están solo en local en la sesión de integración, sin push.
- Production: NO-GO.
- **No se revierte:** decisión del propietario.

### Autorización utilizada (hora UTC del 27/10; en Madrid, ya 28/10)

| Hora | Hecho |
| --- | --- |
| 23:21:41 | La sesión de integración da el OK operativo: no hay E2E en marcha. **No es una autorización.** |
| 23:21:56 | Dry-run sobre `fmmfsbhcwxkaszrrarpw`: solo `20261028090000` |
| 23:22:05 | Primer `db push`, **denegado** por el control de permisos de la sesión. No se buscó otra vía. |
| 23:22:58 | La sesión de facturación pide decisión al propietario, con un botón de respuesta redactado por la sesión |
| 23:27:03 | **Autorización usada.** Mensaje del propietario en la sesión de facturación (ese botón): «Autorizo aplicar la migración 20261028090000 en Staging (fmmfsbhcwxkaszrrarpw) con db push, tal como mostró el dry-run. Solo Staging, nada en Production.» |
| 23:27:09–23:27:20 | `db push --linked`: aplicada. A las 23:27:20, PostgREST recarga su caché de esquema sin errores. |
| Durante el push | Llega un segundo mensaje del propietario, con condiciones. **La condición 3 (copia previa) no se cumplió**: Staging no tenía copias (Supabase `backups: []`, PITR desactivado, B2 solo para Production). |
| 23:32:15 | Llega la indicación «Mantén la migración de Billing pendiente de autorización…», **después** de aplicada. Hasta entonces la sesión no la conocía. |
| 23:38–23:40 | Copia completa de Staging (`20261027T233844Z`), ya con la migración. Restaurada con éxito en una base aislada. |

### Verificación en Staging (solo lectura)

| Comprobación | Resultado |
| --- | --- |
| Integridad | El MD5 de `prosrc` de las 7 funciones coincide con el fichero de la migración |
| Permisos de funciones | Las 6 RPC nuevas: SECURITY DEFINER, `search_path` vacío, solo `service_role` (ni `anon`, ni `authenticated`, ni `public`). `tenant_has_feature` conserva sus permisos (`authenticated` y `service_role`). |
| Tablas nuevas | `feature_rollouts` y `tenant_billing_offers`: RLS activado, 0 políticas, sin `SELECT` para `anon`, `authenticated` ni `service_role`. Esquema `billing_private` sin `USAGE` para esos roles. |
| RLS en `public` | 0 tablas sin RLS; 69 políticas. La migración no crea ni cambia políticas. |
| Aislamiento: owner de d3-alta (solo miembro de d3-alta) | `quotes` propio: **sí**, por plan (efecto buscado). `clients_import` propio: no (retenida). Funciones de e2e: no. Ve 0 presupuestos de otros tenants (e2e tiene 70 y demo 1). Ve 1 tenant. |
| Aislamiento: owner de e2e | `quotes` e importación propios: sí, por concesión, como antes. Funciones de d3-alta y demo: no. Ve sus 70 presupuestos y 0 de otros tenants. |
| Aislamiento: staff de e2e | Igual que antes: ve sus 70 presupuestos y 0 de otros tenants |
| Registros desde la aplicación (23:27:20 → verificación) | Sin errores de la aplicación. Los únicos `ERROR` son los dos intentos fallidos de copia de las 23:37 (lecturas, 42501 por RLS), ya resueltos. |

Las pruebas de aislamiento cambian de rol (`set local role authenticated` y `request.jwt.claims`) solo dentro de la transacción de la consulta: no escriben nada.

### Compatibilidad del código desplegado (1b11745)

| Punto | Resultado |
| --- | --- |
| Checkout | Solo acepta `basic` (`BILLING_PLAN_CODES = ["basic"]`): Pro no se puede contratar con este código. No hay precios Pro en `billing_prices` de Staging. |
| `GET /api/billing/subscription` | Lee el plan unido a la suscripción, no lista planes. No hay suscripciones Pro. |
| Webhook (`resolve-plan-from-price`) | Resuelve el plan desde `billing_prices`, sin cambios |
| RPC que usa el código (`finalize_billing_checkout_attempt_v2`, `sync_billing_subscription_v1`, `claim_` y `finalize_billing_webhook_event_v1`, `activate_tenant_after_billing_v1`) | La migración no las toca |
| `tenant_has_feature` | Misma firma y mismo contrato. Solo cambia el resultado donde debe: d3-alta ve el módulo de presupuestos. |
| Capacidad (`storage_bytes`) | Basic sigue con 5 GiB |

**Conclusión:** el código de Staging es compatible con el esquema nuevo. El único cambio visible es que d3-alta tiene presupuestos por plan; d3-alta es un tenant sintético de las pruebas D3. No se detecta riesgo de aislamiento ni de RLS.

### Recuperación en Staging (documentada, **sin ejecutar**)

- **Nivel 1:** el rollback de la sección 6 revierte la migración.
  - En Staging, su efecto sería que d3-alta pierde presupuestos por plan; nadie más cambia.
  - `pro` queda inactivo y las dos tablas de `billing_private` se conservan (vacías salvo la retención).
  - Funcionalmente equivale al estado anterior.
  - Necesita autorización y `migration repair` (solo el propietario).
- **Nivel 2:** la copia `20261027T233844Z` es **posterior** a la migración.
  - Sirve para volver al estado de antes del E2E de facturación.
  - **No** sirve para deshacer la migración: para eso existe el nivel 1. No existe una copia de Staging anterior a la migración.

## 1. Qué modifica

Una sola transacción (`begin` … `commit`): si falla cualquier sentencia, no queda nada aplicado.

| Objeto | Cambio | Tipo |
| --- | --- | --- |
| Comprobación previa | Aborta si existe un plan `pro` con otro id, o si el catálogo no tiene las 7 funciones (`activity_log`, `core_clients`, `core_orders`, `core_team`, `quotes`, `clients_import`, `storage_bytes`) | Guarda |
| `public.plans` | Inserta `pro` con id fijo `30000000-0000-4000-8000-000000000003` y 79,00 EUR. Si ya existe con ese id, actualiza nombre, precio, moneda, `active` y orden (`on conflict (code) do update`). | Datos de catálogo |
| `public.plan_features` | **Basic:** `quotes` y `clients_import` habilitadas. **Pro:** `activity_log`, `core_*`, `quotes`, `clients_import` y `storage_bytes` = 53687091200 (50 GiB). Upsert por `(plan_id, feature_id)`. | Datos de catálogo |
| `billing_private.feature_rollouts` | **Tabla nueva.** RLS activado y sin permisos para `public`, `anon`, `authenticated` ni `service_role`. Una fila: `clients_import` en `held` (D2). | Esquema nuevo |
| `public.tenant_has_feature(uuid, text)` | **Se redefine.** Misma firma, mismos permisos (`authenticated` y `service_role`; no `anon`), SECURITY DEFINER, `search_path` vacío y `stable`. Cuerpo = el de `20260923190000_quotes_v1` más la comprobación de retención: si el plan da la función pero está `held`, devuelve `false`. Las concesiones por tenant siguen teniendo prioridad. | Función compartida |
| `public.set_feature_rollout_v1` | **Nueva.** Libera o retiene una función, con motivo, autor e historial. | RPC solo de servicio |
| `billing_private.tenant_billing_offers` | **Tabla nueva**, con 2 índices (una oferta activa por tenant, plan y modo; consulta por tenant). RLS activado y sin permisos. | Esquema nuevo |
| `grant_`, `revoke_`, `list_`, `accept_` y `redeem_tenant_billing_offer_v1` | **Nuevas.** SECURITY DEFINER, `search_path` vacío, permiso solo para `postgres` y `service_role`. | RPC solo de servicio |

**No toca:**
- tablas, políticas, triggers ni funciones de pedidos, clientes o presupuestos;
- datos de tenants, memberships, suscripciones ni Auth;
- precios de Stripe (`billing_prices`).

**No crea ni cambia ninguna política RLS.**

## 2. Dependencias

| Necesita | Viene de |
| --- | --- |
| `public.features`, `public.plans`, `public.plan_features` y `public.subscriptions` | `20260907171432_remote_schema` |
| Plan `basic` y funciones `core_*` y `activity_log` | `20260921201000_billing_basic_plan_v1` |
| Función `storage_bytes` | `20260921180000_storage_bytes_feature_v1` |
| Función `quotes`, `public.tenant_feature_overrides` y el cuerpo anterior del resolvedor | `20260923190000_quotes_v1`. **Es la única definición previa** de `tenant_has_feature`: ninguna migración posterior lo cambia, así que la redefinición no deshace nada. |
| Función `clients_import` | `20261016120000_clients_import_v1` |
| `public.billing_checkout_attempts` | `20260922101225_paid_onboarding_concurrency_hardening_v1` |
| Esquema `billing_private` | `20261018161000_billing_storage_capacity_explicit_v1` |
| Bloqueo de facturación por tenant `pg_advisory_xact_lock(hashtextextended(tenant, 31))` | El mismo que `prepare_billing_checkout_attempt_v2` y `grant_internal_subscription_v1` (`20261018170000`) |
| `public.tenants`, `public.memberships`, `auth.uid()` y `auth.role()` | Línea base |

Relacionadas, sin dependencia de esquema:
- **A1** (`20261018180000`, `set_tenant_feature_v2`): escribe las concesiones que el resolvedor consulta primero.
- **Voz** (`20261018190000`): usa el resolvedor con `ai_voice_orders`, que no está en ningún plan.

## 3. Efecto en RLS y en el esquema compartido

El resolvedor es **compartido**. Hoy lo usan:

| Dónde | Función consultada | Efecto de la migración |
| --- | --- | --- |
| Políticas RLS: `quotes` (`quotes_select_admin`, `quotes_insert_admin`, `quotes_update_admin`), `quote_items_operational_select`, `quote_versions_operational_select`, `quote_files_select_operative` | `quotes` | Un tenant con suscripción **Basic** `active` o `trialing` pasa a ver y crear presupuestos por plan, dentro de las mismas reglas de rol y membership. Los tenants con concesión siguen igual. |
| 12 funciones de presupuestos (crear borrador, convertir, archivos, notas, actividad…) | `quotes` | Lo mismo |
| `imports_private.assert_import_access` | `clients_import` | **Ninguno:** la función está retenida. Solo la tienen los tenants con concesión. |
| `ai_voice_status`, `ai_reserve_usage` y `ai_set_voice_usage_limit` | `ai_voice_orders` | Ninguno: no está en ningún plan |
| `set_tenant_feature_v2` | — | Ninguno |

- **Rendimiento:** solo hay un `EXISTS` adicional sobre `feature_rollouts` (clave primaria, 1 fila), y solo cuando el plan concede la función.
- **Seguridad:** las tablas nuevas solo se leen y escriben por RPC SECURITY DEFINER; las RPC no se exponen a `anon` ni a `authenticated`. Como antes, el resolvedor no distingue `livemode` en el respaldo por plan.

## 4. Riesgos

| # | Riesgo | Control |
| --- | --- | --- |
| M1 | Los tenants Basic sin concesión ganan presupuestos por plan (efecto buscado, decisión del 27/10) | Listarlos antes con la consulta P5 y confirmar. En Staging solo cambió d3-alta. |
| M2 | El resolvedor desplegado no es el de `quotes_v1`, por ejemplo por un cambio manual | P4 compara el MD5 de `prosrc` con `66f4c1a08668495eb374de45ea5228fb`. Si no coincide, **no se aplica**. |
| M3 | Ya existe un plan `pro` con otro id | La guarda aborta la migración entera |
| M4 | Al catálogo le falta alguna de las 7 funciones | La guarda aborta la migración entera |
| M5 | Orden de versiones | La versión debe ser mayor que la última aplicada. Ninguna otra rama tiene migraciones pendientes que no estén en `main` (revisado el 28/10). El dry-run debe listar **solo** esta. |
| M6 | El rollback quita presupuestos e importación por plan a Basic | Solo ante una incidencia y con autorización. Antes, dar concesiones a quien las necesite (P5). |
| M7 | El rollback no se puede usar si hay suscripciones Pro | Se niega por diseño: un cliente Pro que paga requiere una decisión comercial |

## 5. Compatibilidad con el release (R5/R6)

- **Sin solapes.** `20261022120000_order_direct_write_guard_v1` (R5) y `20261022130000_assignee_eligibility_v1` (R6) no tocan `tenant_has_feature`, `plans`, `features`, `plan_features` ni `billing_private`. Esta migración no toca pedidos, asignaciones ni memberships.
- **Probada después de R5/R6:**
  - en local, `db reset` con las 86 migraciones previas más esta, Release Gate completo (45 suites);
  - en Staging, aplicada sobre las 86 de Production, incluidas 120000 y 130000.
- **Orden en Production:**
  1. después de cerrar el Release Gate R5/R6;
  2. después del merge de #158 (el código tolera la migración ausente: la página de facturación muestra la lista de ofertas vacía);
  3. con una copia v2 de menos de 2 horas.
- **Código y base de datos son compatibles en ambos órdenes.** El código actual funciona con la base nueva y el código nuevo con la base anterior.

## 6. Procedimiento

Cada entorno requiere su propia autorización. Para Production: F12 cerrado, copia v2 reciente, E2E correcto y autorización expresa.

### Precomprobaciones (solo lectura, en el entorno de destino)

```sql
-- P1. Historial: la última aplicada debe ser la esperada (hoy, 20261022130000) y no debe existir 20261028090000.
select count(*), max(version) from supabase_migrations.schema_migrations;

-- P2. Plan pro: ninguna fila, o la del id fijo.
select id, active from public.plans where code = 'pro';

-- P3. Catálogo: 7 filas.
select count(*) from public.features
where code in ('activity_log','core_clients','core_orders','core_team','quotes','clients_import','storage_bytes');

-- P4. Resolvedor sin cambios: 66f4c1a08668495eb374de45ea5228fb.
select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'tenant_has_feature';

-- P5. Quién gana presupuestos por plan (Basic vigente sin concesión) y quién tiene importación por concesión.
select t.slug, p.code as plan, s.status, s.provider,
       (select o.enabled from public.tenant_feature_overrides o join public.features f on f.id = o.feature_id
         where o.tenant_id = t.id and f.code = 'quotes') as quotes_override,
       (select o.enabled from public.tenant_feature_overrides o join public.features f on f.id = o.feature_id
         where o.tenant_id = t.id and f.code = 'clients_import') as import_override
from public.tenants t
left join lateral (select * from public.subscriptions s where s.tenant_id = t.id and s.status in ('active','trialing')
                   order by s.created_at desc limit 1) s on true
left join public.plans p on p.id = s.plan_id
order by t.slug;
```

### Aplicación

1. **Copia previa:**
   - **Production:** lote v2 del runner B1.3 de menos de 2 horas, verificado.
   - **Staging:** `~/copyflow-ops/staging-backups/run-staging-backup.sh` y `run-staging-restore-drill.sh verify`.
2. Carpeta de push con **exactamente** las migraciones del commit (`git archive <sha> supabase/migrations supabase/config.toml`) y el enlace de la CLI del entorno correcto. Comprobar `supabase/.temp/project-ref` antes de seguir.
3. `npx -y supabase@2.117.0 db push --dry-run --linked`: debe listar **solo** `20261028090000_commercial_plans_pro_offers_v1.sql`. Nunca usar `--include-all`.
4. `npx -y supabase@2.117.0 db push --linked`. La CLI crea un rol temporal `cli_login_postgres`, válido unos 5 minutos; hay que mencionarlo en el informe.

### Verificación (solo lectura)

```sql
-- V1. Historial: una más que antes, la última 20261028090000.
select count(*), max(version) from supabase_migrations.schema_migrations;
-- V2. Catálogo.
select p.code, f.code, pf.limit_value from public.plan_features pf
join public.plans p on p.id = pf.plan_id join public.features f on f.id = pf.feature_id
where pf.enabled and p.code in ('basic','pro') order by 1, 2;
-- V3. Retención: clients_import:held.
select f.code, r.state from billing_private.feature_rollouts r join public.features f on f.id = r.feature_id;
-- V4. Resolvedor nuevo: b95d65208abd4021cc15f3c8a4b59e23.
select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'tenant_has_feature';
-- V5. Funciones y tablas: SECURITY DEFINER, search_path vacío, sin anon ni authenticated en las RPC nuevas; RLS en las 2 tablas.
-- V6. Repetir P5 con tenant_has_feature(t.id, 'quotes') y (t.id, 'clients_import'):
--     la importación solo donde hay concesión; presupuestos = P5 previsto.
```

Resultado en Staging el 28/10: V1 87 / `20261028090000`; V2 según la tabla de la sección 1; V3 `clients_import:held`; V4 `b95d6520…`; V5 correcto. V6: importación solo en e2e y e2e-import, y presupuestos nuevos solo en d3-alta.

### Recuperación

**Nivel 1 (preferente): rollback lógico de la migración.**

Solo ante una incidencia diagnosticada y con autorización.

1. P5 y concesiones previas a quien deba conservar presupuestos o importación.
2. Ejecutar `supabase/rollbacks/20261028090000_commercial_plans_pro_offers_v1.sql`:
   - es una sola transacción;
   - se niega si hay suscripciones Pro;
   - restaura el resolvedor de `quotes_v1`;
   - quita `quotes` y `clients_import` de Basic;
   - retira `pro` (inactivo y sus precios desactivados);
   - elimina las 6 RPC;
   - **conserva** las dos tablas de `billing_private` como evidencia.
3. `supabase migration repair --status reverted 20261028090000 --linked`. Solo el propietario, porque cambia el historial.
4. Verificar:
   - P4 vuelve a `66f4c1a08668495eb374de45ea5228fb`;
   - `pro` inactivo;
   - Basic sin `quotes` ni `clients_import`;
   - el historial sin `20261028090000`.

Volver a aplicarla más tarde es seguro: las tablas usan `if not exists` y la retención `on conflict do nothing`.

**Nivel 2: restaurar desde copia.**
- Solo si el nivel 1 no basta.
- Primero se restaura en una base aislada (`restore-database-local.sh`, `RESTORE_DATABASE_ISOLATED_SUCCESS`). Restaurar sobre el entorno real es una operación destructiva con autorización propia.
- Hay que tener en cuenta los requisitos externos al lote: secretos de Vault, configuración de Auth, `pg_trgm` y RLS automático.
- **Staging:** lote `database/2026/10/27/20261027T233844Z`, ya con esta migración aplicada. Registro en `~/copyflow-ops/staging-backups/RECORD-20261027T233844Z.md`.
