# Gestcopy Pro · Acceso anticipado V1 — implementación y validación

Implementa el [ADR](adr/2026-10-15-pro-early-access-v1.md) siguiendo la
[auditoría](PRO-EARLY-ACCESS-AUDIT.md). Base: `03fa094` (`main`).

## Qué cambia

| Pieza | Cambio |
| --- | --- |
| `supabase/migrations/20261015200000_pro_early_access_features_v1.sql` | Inserta `pro_early_access` (`…0008`) y `ai_voice_orders` (`…0009`) en `features`. Sin `plan_features`, sin overrides, sin tocar planes, suscripciones, precios, cuotas ni `quotes`. El id `…0007` queda libre porque la rama sin fusionar `feature/ai-voice-orders-v1` lo usa para `voice_orders`. |
| `lib/features/early-access.ts` | Códigos, política de presentación (`earlyAccessContext`), quién puede leer la página (`canViewProEarlyAccess`: cualquier rol activo con el programa) y lectura fail-closed en el navegador. |
| `lib/features/early-access-server.ts` | `resolveProEarlyAccess` (cliente de sesión + `tenant_has_feature`; error o excepción ⇒ `false`) y `proEarlyAccessGate` (sesión, tenant activo, membership activa y programa; cualquier fallo deniega). |
| `app/api/context/route.ts` | Añade `early_access`. Conserva `features.quotes`. Todas las respuestas (también el 403) llevan `Cache-Control: private, no-store, max-age=0, must-revalidate`. Sin cliente admin ni datos comerciales. |
| `lib/nav/pro-badge.ts`, `components/pro/pro-early-access-badge.tsx`, `components/app-nav.tsx` | Etiqueta junto a la identidad de la organización: «Pro · Acceso anticipado» (≥ 640 px) o «Pro · Anticipado» (móvil). Nombre accesible completo siempre. Oculta hasta que el contexto confirma el programa. No cambia la navegación por rol ni Presupuestos. |
| `app/pro/page.tsx`, `components/pro/early-access-info.tsx` | Página informativa en el shell actual. Sin programa (o sin sesión, tenant/membership inactivos, error) ⇒ no encontrado, sin detalles del programa. |
| `supabase/tests/phase47_pro_early_access.sql` + `release-gate.yml` | Suite SQL nueva, incluida en el Release Gate permanente. |
| `e2e/staging/pro-early-access.ts`, `e2e/staging/seed-viewer.ts` | Recorrido Pro de solo lectura contra Staging (mismo guard, egress y redacción que E2E V0) y alta idempotente de un viewer sintético en `e2e`. |

### Estado HTTP de «no encontrado»

Con Cache Components cada ruta dinámica emite primero su shell estático, así
que `notFound()` en `/pro` es un *soft 404*: el navegador recibe la página de
no encontrado con `<meta name="robots" content="noindex">` y HTTP 200 en el
build de producción (en `next dev` es 404). Es el comportamiento documentado
de Next 16 (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md`)
y el mismo que ya tienen `/quotes` y `/settings/billing`. La página no revela
nada del programa. Un 404 real exigiría la comprobación en `proxy`; no se
hace en V1.

### Contrato de `/api/context`

```jsonc
// Tenant enrolado
"early_access": { "pro": true, "voice_orders": { "status": "planned" } }
// Cualquier otro caso (sin override, false, error de RPC, excepción)
"early_access": { "pro": false }
```

`voice_orders.status` es siempre `"planned"` en V1: no se resuelve
`ai_voice_orders`, así que concederlo por error no anuncia nada. Ser
participante Pro no concede ningún permiso; la futura voz deberá comprobar
en cada petición sesión, tenant, membership, rol que crea pedidos, feature de
voz y disponibilidad técnica.

### Lo que no hace

Sin cambios en Stripe, Checkout, Portal, webhook, suscripciones, planes,
precios, cuotas ni permisos de presupuestos. Sin `slug === "sur4"`, sin
variables por copistería, sin endpoint para cambiar flags, sin dependencias
nuevas, sin micrófono, grabación, proveedor de IA ni flujo simulado.

## Operación: conceder, retirar y restaurar

Solo con un operador de confianza (rol `postgres` en el SQL editor del
proyecto correcto o `service_role`). `set_tenant_feature` no es ejecutable
por `authenticated` ni `anon`: ninguna copistería puede autoconcederse el
programa. El script `scripts/set-tenant-feature.mjs` sigue limitado a
localhost; no se ha modificado.

El bloque aborta si el tenant no es exactamente el esperado en ese entorno
(id, no solo slug), si falta la migración o si algún plan hereda el
programa. Ejemplo para el tenant sintético de Staging:

```sql
begin;
do $grant$
declare
  -- e2e en Staging (fmmfsbhcwxkaszrrarpw). Para otro entorno, su id real.
  v_expected constant uuid := '72ef5b99-f50a-4bdb-aa99-5befd120f364';
begin
  if (select t.id from public.tenants t where t.slug = 'e2e' and t.active)
     is distinct from v_expected then
    raise exception 'preflight: el tenant no coincide con el entorno esperado';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
                 where version = '20261015200000') then
    raise exception 'preflight: migración Pro no aplicada';
  end if;
  if exists (select 1 from public.plan_features pf
             join public.features f on f.id = pf.feature_id
             where f.code in ('pro_early_access', 'ai_voice_orders')) then
    raise exception 'preflight: un plan hereda el programa';
  end if;
  perform public.set_tenant_feature('e2e', 'pro_early_access', true, null);
end;
$grant$;
commit;
```

- **Retirar:** el mismo bloque con `false`. Un `false` explícito prevalece
  sobre cualquier plan. La etiqueta de una pestaña abierta desaparece al
  recargar; `/pro` y `/api/context` ya deniegan en la petición siguiente.
- **Restaurar la ausencia exacta** (estado previo sin fila):
  `delete from public.tenant_feature_overrides where tenant_id = <id> and
  feature_id = '31000000-0000-4000-8000-000000000008';` — solo esa fila.
  No borrar catálogo, otros overrides (`quotes`, voz), suscripciones,
  pedidos, archivos ni historial.
- **Registro operativo** (no hay historial en BD en V1): entorno, tenant,
  flag, operador, motivo, valor previo, valor nuevo y resultado.
- **Antes y después**, comparar un hash de suscripciones, planes,
  `plan_features`, `billing_prices`, overrides ajenos al programa y tenants:
  debe ser idéntico.

El piloto SUR4 es una operación posterior y separada (ADR, paso 5): snapshot
mínimo de solo lectura en Production, id real del tenant y este mismo bloque.
Esta entrega no lo ejecuta.

## Validación

### Local (Node 22.23.2, macOS)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` | OK |
| `npm run lint` | 0 errores (4 avisos previos en `lib/orders/quote-situation.test.ts`, no tocado) |
| `TZ=UTC npx tsx --test` | 1102 tests, 275 suites: 1102 PASS, 0 FAIL |
| `TZ=UTC npm run build` | OK; `/pro` y `/api/context` dinámicas (`ƒ`) |
| `ci/release-gate/check-migrations.ts` | PASS (1 migración nueva, aditiva) |

Nuevos tests: política (`early-access.test.ts`), resolución y guarda
(`early-access-server.test.ts`), contrato HTTP de `/api/context`
(`early-access-http.test.ts`, mismo arnés que `lib/quotes/http.test.ts`),
etiqueta (`lib/nav/pro-badge.test.ts`) y guardas estáticas
(`early-access-guards.test.ts`: sin APIs de micrófono, sin condiciones por
slug, sin acoplamiento con billing/service_role, migración sin concesiones,
suite en el gate). Mutaciones comprobadas en el contrato HTTP: «siempre
enrolado» y «200 sin `no-store`» fallan.

### SQL/RLS (Supabase local aislado, todas las migraciones desde cero)

`release_gate_security_invariants` y las 15 suites del gate en el orden de CI,
con `phase47_pro_early_access` incluida: **todas PASS**. Regresiones de
billing/flags fuera del gate permanente (`phase23`, `phase24`, `phase32`,
`phase33`): **PASS**.

`phase47` cubre: catálogo sin herencia ni concesiones; cada estado
`active/trialing/past_due/canceled` × `livemode` con programa OFF y ON
(el programa no depende de billing; control `core_orders` por plan);
los cinco roles del tenant enrolado; aislamiento A/B, usuario sin membership
y `anon`; ninguna autoconcesión (RPC, INSERT/UPDATE/DELETE de overrides,
`plan_features`, catálogo); membership y tenant inactivos; `ai_voice_orders`
independiente; revocación con `false` frente a un plan mal configurado;
restauración de la ausencia; `service_role` como operador; hash de
billing/cuotas/tenants/`quotes` idéntico tras conceder y retirar.
Inyección de fallos verificada (cada una hace fallar la suite): plan que
hereda el programa, tenant preenrolado, resolver sin comprobación de
membership, `EXECUTE` de `set_tenant_feature` a `authenticated`, concesión
que altera billing y concesión que altera `quotes`.

### Navegador local (dev server contra el Supabase aislado)

Tenants sintéticos `proa` (owner, staff, viewer) y `prob` (owner).

| Caso | `/api/context` | `/pro` |
| --- | --- | --- |
| ON · owner / staff / viewer de A | 200 `{"pro":true,"voice_orders":{"status":"planned"}}` | 200, «En preparación» |
| ON · owner de B en B | 200 `{"pro":false}` | 404 |
| ON · owner de B en A, owner de A en B | 403 | 404 |
| Sin sesión | 403 | 307 → `/auth/login?next=%2Fpro` |
| OFF · todos | `{"pro":false}` | 404 (`next dev`), sin texto del programa |
| `ai_voice_orders` concedido por error + `quotes` ON | voz sigue `planned`; `quotes` true sin afectar al programa | 200 |
| Membership inactiva | 403 | 404 |
| Tenant inactivo (programa ON) | 403 | 307 → `/tenant-inactive?reason=administratively_disabled` |

Hash de billing/quotes/tenants idéntico antes y después de ON→OFF. Revisión
visual: escritorio 1280 px y móvil 375 px, claro y oscuro; sin scroll
horizontal; etiqueta activa en `/pro`; sin errores de consola. Pestaña
abierta tras retirar: la etiqueta persiste hasta recargar, pero `/pro` ya
devuelve 404 y el contexto `pro:false` (límite conocido de la auditoría).

### Staging (`fmmfsbhcwxkaszrrarpw`, tenant `e2e`, 15/10/2026)

Despliegue autorizado por el usuario: fast-forward de `gestcopy-staging`
`49020c8..5d16740` (merge de esta rama; árbol idéntico al de la rama), sin
force push. `main` sin cambios (`03fa094`). Production no se ha tocado y
Staging no contiene datos de SUR4.

| Paso | Resultado |
| --- | --- |
| Preflight de solo lectura | Catálogo sin ids `…0008/…0009`; tenants `audit`, `demo`, `e2e`; único override `demo.quotes`; 0 suscripciones; sin datos SUR4 |
| Migración (`supabase db push --linked`, `--dry-run` previo: solo esta) | Aplicada con versión `20261015200000`; 0 filas de plan, 0 overrides |
| E2E V0, código anterior + migración | 3/3 PASS · `20261015T185441Z-e728` (`E2E-0009`) |
| Despliegue del código nuevo | `/api/context` pasa a responder `private, no-store` |
| Viewer sintético (`seed-viewer.ts`, terminal de confianza) | `e2e-viewer@example.com`, membership `viewer` en `e2e` |
| Programa OFF (sin fila) · recorrido Pro owner + viewer | PASS · `20261015T191806Z-feea` |
| E2E V0 con código nuevo, programa OFF | 3/3 PASS · `20261015T191533Z-a7ff` (`E2E-0010`) |
| Concesión con el bloque de preflight (valor previo: sin fila) | `e2e.pro_early_access = true` |
| Programa ON · recorrido Pro owner + viewer | PASS · `20261015T191917Z-168e` |
| E2E V0 con código nuevo, programa ON | 3/3 PASS · `20261015T192108Z-4b52` (`E2E-0011`) |
| Retirada (`false`) · recorrido Pro owner + viewer | PASS · `20261015T192243Z-fcb0` |
| Restauración de la ausencia (solo esa fila) | 0 overrides del programa |
| Hash de suscripciones/planes/precios/overrides ajenos/tenants | `f486ae26…` idéntico antes, durante y después |
| Resolución final | `audit`, `demo`, `e2e`: programa `false`; `demo.quotes` sigue `true` |

Cada recorrido Pro comprueba, para owner y viewer: contrato y `no-store` de
`/api/context`; etiqueta en `/` a 1440 px y 375 px, claro y oscuro (nombre
accesible completo, texto corto solo en móvil, sin scroll horizontal);
acceso directo a `/pro` (ON: página, «En preparación», bloque de voz sin
acciones, `aria-current`; OFF: página de no encontrado con `noindex` y sin
texto del programa); y que nunca se llama a `getUserMedia`. Todas las
peticiones del navegador se quedaron en el host `e2e`, Supabase Staging y el
bucket `gestcopy-files-staging`. Lo único bloqueado fue la barra de
comentarios de `vercel.live` («foreign»), y no hubo ningún intento hacia
Production. Los artefactos (capturas incluidas) pasan por el redactor y se
escanean en busca de secretos.

Ejecución del recorrido (después de fijar el flag con el bloque anterior):

```bash
set -a; source .env.e2e.local; set +a
E2E_VIEWER_EMAIL=e2e-viewer@example.com E2E_VIEWER_PASSWORD=… npx tsx e2e/staging/seed-viewer.ts
E2E_PRO_EXPECT=on E2E_VIEWER_EMAIL=e2e-viewer@example.com E2E_VIEWER_PASSWORD=… \
  PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs npx tsx e2e/staging/pro-early-access.ts
```

La contraseña del viewer no se guarda en el repositorio. Para repetir el
recorrido, basta con volver a ejecutar `seed-viewer.ts` con una nueva, que
solo la resincroniza.

## Pendiente

- Workflow manual `e2e-staging.yml` en GitHub: no lanzado. Las ejecuciones
  E2E anteriores se hicieron en local con el mismo runner y la misma
  configuración de Staging, como en `docs/E2E-STAGING-V0.md`.
- Pestaña abierta tras retirar el programa: comprobado solo en local (la
  etiqueta persiste hasta recargar; el servidor deniega en la siguiente petición).
- Piloto SUR4 / Production: fuera de esta entrega (ADR, paso 5).
