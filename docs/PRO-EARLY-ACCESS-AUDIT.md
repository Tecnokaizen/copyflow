# Gestcopy Pro · Acceso anticipado V1 — auditoría del sistema existente

Fecha: 15 de octubre de 2026. Repositorio: `Tecnokaizen/copyflow`.

## Alcance y evidencia

Revisión del código y del historial SQL en `main`, commit
`03fa094e11c0b2e583381c5630cf96acf35631e2`. El conector de GitHub confirmó que
`main` era idéntico a ese commit durante la revisión. Se preparó un checkout
local separado en esa revisión; las copias locales anteriores contienen otros
trabajos y no se han modificado. La revisión local `28fd2e5` de Novedades está
fuera de esta base y no es un requisito para el programa Pro.

Se han leído las fuentes del proyecto: arquitectura inmutable, fuentes
oficiales, instrucciones y PRD SUR4. Los documentos SUR4 describen el modelo
histórico Sites/Airtable. Para Gestcopy prevalece la arquitectura compartida
Vercel/Supabase y la implementación actual del repositorio.

Esto acredita comportamiento implementado, no el estado actual de las filas
remotas. No se ha consultado ni escrito Production, Stripe ni los datos de
SUR4. Tampoco se ha ejecutado un E2E remoto nuevo. El cierre E2E V0 y el éxito
del workflow manual «E2E staging #1» se conservan como confirmación del usuario;
las dos ejecuciones locales satisfactorias están documentadas en
[E2E-STAGING-V0.md](E2E-STAGING-V0.md).

## Inventario real

| Área | Implementación observada | Implicación para Pro V1 |
| --- | --- | --- |
| Planes | `plans` + `plan_features` + `features` | Ya existe catálogo; no hace falta un catálogo paralelo. |
| Basic | Seed `20260921201000_billing_basic_plan_v1.sql`: `basic`, Gestcopy Basic, 39 EUR/mes | Mantener intacto. No acredita por sí solo la suscripción actual de SUR4. |
| MVP | El mismo seed conserva `mvp`, interno/legacy, sin reescribir suscripciones | No asumir que todos los tenants están en Basic o gestionados por Stripe. |
| Funciones Basic | `core_orders`, `core_clients`, `core_team`, `activity_log`; migración posterior añade `storage_bytes` = 5.368.709.120 | 5 GiB. El comentario del primer seed sobre almacenamiento está superado por el segundo. |
| Suscripciones | `subscriptions`; índice `subscriptions_one_current_per_tenant_idx` para `trialing/active/past_due` | Crear otra suscripción «Pro gratuita» chocaría con el modelo de suscripción vigente. |
| Stripe | `billing_prices`, customers, checkout attempts, webhook events y `sync_billing_subscription_v1` | No son necesarios para un programa de acceso anticipado. |
| Test/Live | `subscriptions.livemode`, `STRIPE_MODE`, filtros de precio, cliente, suscripción y validación de webhook | No cambiar estas rutas para representar Pro. |
| Checkout | `lib/billing/access.ts` y `checkout-parse.ts`: solo `basic` + `month`; el cuerpo rechaza campos ajenos, incluido tenant | Pro no es actualmente un plan contratable. |
| Facturación HTTP/UI | `app/api/billing/subscription/route.ts`, Checkout, Portal y `/settings/billing`: owner | Mantener los permisos y el acceso a precios/acciones de facturación. |
| Facturación SQL | SELECT de `subscriptions` para owner/admin; políticas de onboarding permiten lectura mínima de miembros pendientes | El permiso SQL de lectura es más amplio que el de la pantalla de facturación. No ampliarlo por el programa. |
| Overrides | `tenant_feature_overrides`: PK `(tenant_id, feature_id)`, booleano, límite y timestamps | Extensión mínima para enrolar un tenant sin cambiar su plan. |
| Resolver efectivo | RPC `tenant_has_feature`; wrapper `lib/features/tenant-has-feature.ts` | Se usa en servidor. El helper puro `resolve.ts` y sus pruebas no sustituyen esta autorización SQL. |
| Escritura de flags | `set_tenant_feature`; EXECUTE restringido a `service_role`, además del propietario de BD | Ni owner ni admin de una copistería pueden autoconcederse Pro mediante esta RPC. |
| Contexto frontend | `/api/context` expone actualmente `features.quotes`; AppNav lo consume | Punto de extensión para estado del programa, independiente de billing. |
| Roles | `owner/admin/manager/staff/viewer`; pedidos escritos por los cuatro primeros | Un flag no concede un rol ni cambia memberships. |
| Presupuestos | Feature `quotes`, navegación + HTTP + SQL/RLS; no está en Basic/MVP por las migraciones inspeccionadas | Ser candidato Pro no debe activar ni desactivar presupuestos automáticamente. |
| Voz / Pro | No hay módulo operativo de voz ni programa Pro en la base inspeccionada; `pro` aparece como caso rechazado por Checkout | Se requiere una incorporación explícita. No presentar voz como disponible. |

## Cómo se resuelven actualmente las funcionalidades

En `supabase/migrations/20260923190000_quotes_v1.sql`:

1. Para `authenticated`, la RPC comprueba membership activa del usuario en
   el tenant solicitado; si no existe, devuelve `false`. Los operadores tienen
   acceso explícito. La RPC no comprueba por sí misma `tenants.active`.
2. Una fila de override, incluso con `enabled=false`, tiene precedencia.
3. Sin override, busca `plan_features` de suscripciones `active/trialing`.
4. Sin coincidencia, devuelve `false`.

El wrapper TypeScript devuelve `false` cuando la RPC falla. El contexto de
aplicación comprueba sesión, tenant activo y membership activa. Para operar
siguen haciendo falta los permisos de rol y las políticas/RPC de cada módulo.

### Límites que condicionan la propuesta

- **No hay filtro `livemode` en el fallback de `tenant_has_feature`.** La propia
  función lo documenta. No usarlo como nueva autoridad de pago. Los flags del
  programa propuesto no se vincularán a ningún plan en V1.
- **Las reglas de estado no son idénticas:** billing considera vigente
  `past_due`, pero el fallback booleano solo `active/trialing`. Un override
  tampoco exige una suscripción vigente. No deducir «está pagando» de un flag.
- **No hay caducidad, motivo, actor ni historial de concesiones** en
  `tenant_feature_overrides`. Tiene timestamps, pero no hay trigger de
  `updated_at` propio en su creación; el setter sí actualiza ese campo.
  V1 debe evitar prometer duración o convertir el programa en un trial.
- **`limit_value` no es una cuota genérica aplicada automáticamente.** La cuota
  de archivos usa `resolve_tenant_storage_limit_bytes` y `plan_features`; no
  consume el override. No prometer más almacenamiento por enrolar Pro.
- **`tenant_settings` no es un lugar adecuado para derechos Pro:** contiene
  configuración que pueden modificar usuarios de organización autorizados.
- **`/api/context` no declara actualmente el encabezado privado `no-store`**
  que sí declara billing. Añadirlo al extender el estado del programa, sin
  introducir caché compartida por tenant o usuario.
- **AppNav carga contexto al montar.** Una retirada de acceso puede dejar una
  etiqueta antigua hasta recargar. Esa etiqueta no debe autorizar operaciones;
  futuras APIs de voz deberán comprobar acceso en cada petición.
- **El script `scripts/set-tenant-feature.mjs` solo admite localhost.** No es
  una herramienta de activación remota. No quitarle su protección para activar
  staging o SUR4.

## Revisión de seguridad y cobertura existente

`getCurrentContext` resuelve usuario, hostname/tenant y membership;
`getCurrentTenant` requiere tenant activo. Presupuestos combina feature + rol
operativo y su implementación SQL mantiene tenant/RLS. Los overrides tienen
RLS habilitado y no conceden acceso directo a `anon/authenticated`.

Las pruebas SQL existentes de fase 33 cubren intento de autoconcesión por
usuario autenticado y resolución de otro tenant; fase 34 cubre roles,
membership inactiva, tenant inactivo y operaciones entre tenants. Se han leído,
no ejecutado contra una BD en esta revisión.

El Release Gate permanente ejecuta fase 34 y otras suites de aislamiento; las
fases 23/24/32/33 están en el workflow específico `kiosk-supabase.yml` y no en
la lista permanente de `release-gate.yml`. Para V1, incluir la nueva suite Pro
en el gate permanente y ejecutar también las regresiones de billing/flags.

Comprobaciones locales realizadas sobre la base auditada:

| Comprobación | Resultado |
| --- | --- |
| 11 ficheros de pruebas existentes: features, billing, seguridad Stripe, idempotencia, roles, navegación, presupuestos, contrato API, seguridad Production y guard/redactor E2E | **125 tests, 23 suites; 125 PASS, 0 FAIL, 0 omitidos** |
| Dependencias locales reutilizadas | `package.json` y lock sin diferencias entre la base auditada y la instalación reutilizada |
| Runtime | Node 25.8.1 local; CI exige Node 22. Esta ejecución no sustituye la validación en ese runtime. |
| SQL/RLS dinámico, build, lint, typecheck, staging | No ejecutados en esta fase documental; siguen como gates de implementación. |

No se añaden tests nuevos para documentos. Las comprobaciones estáticas de
seguridad no equivalen a una prueba dinámica de RLS ni certifican Production.

## Incertidumbres que debe resolver el preflight de activación

Sin leer o modificar datos reales no se puede afirmar qué subscription,
provider, `livemode` u overrides tiene hoy SUR4, ni si sus presupuestos están
habilitados. El precio Basic 39 €/mes está confirmado como intención del
usuario y como catálogo del código, no como cobro remoto verificado.

Antes de activar el programa, obtener un snapshot mínimo de solo lectura en
el entorno previsto: identidad del tenant, activo, plan/provider/status/mode,
flags efectivos y overrides previos. No extraer pedidos, clientes, email,
datos bancarios ni payloads de Stripe. Una discrepancia con Basic se informa;
no se «corrige» cambiando suscripciones dentro de esta misión.

## Fuentes técnicas y siguiente decisión

- [ADR de implementación propuesto](adr/2026-10-15-pro-early-access-v1.md).
- [Arquitectura inmutable](Arquitectura%20inmutable%20de%20Copyflow.md),
  fuente de verdad del proyecto.
- [Vercel: aplicación multi-tenant](https://vercel.com/kb/guide/nextjs-multi-tenant-application):
  mismo codebase y despliegue para los tenants.
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security):
  autorización por filas y cautela con roles que pueden omitir RLS.

Pendientes heredados, fuera de la implementación funcional Pro: protección
obligatoria de `main`, vulnerabilidades de `npm audit`, limpieza periódica de
fixtures E2E y avisos de acciones Node 20/Ubuntu. No se dan por resueltos.
