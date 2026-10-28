# Orígenes de retorno de Stripe por entorno (propuesta V1)

**Estado:** propuesta. No hay nada implementado ni cambiado en Vercel, Production ni Stripe Live.

**Origen:** incidencia «redirección de Checkout de Staging a Production» (`docs/BILLING-PRO-OFFERS-V1.md`). El 28/10 el propietario decidió corregirla con orígenes de retorno configurados y validados por entorno, sin confiar en cabeceras `Host` no verificadas.

**Base:** `main` `ab4ca95`. Ningún fichero afectado ha cambiado desde `e218939`.

## 1. Problema

En Staging (Vercel Preview, rama `gestcopy-staging`), después de pagar, cancelar o salir del portal, Stripe devuelve al navegador a `app.gestcopy.com` o a `{slug}.app.gestcopy.com`. Son dominios de Production.

**Causa:**
- `lib/tenant/request-origin.ts` llama a `lib/tenant/trusted-origin.ts`.
- Fuera del desarrollo local, la app nunca usa `Host` para construir URLs. Los únicos orígenes posibles son los de Production: `PRODUCTION_APP_ORIGIN` y `tenantOrigin(slug)`.
- En Production eso es correcto y seguro. En Preview manda a Production.

**URLs afectadas (5):**

| Flujo | Dónde se construye | Hoy, también en Preview |
| --- | --- | --- |
| Onboarding, éxito | `app/api/onboarding/route.ts` → `appHostOriginFromRequest` | `https://app.gestcopy.com/onboarding/success?session_id={CHECKOUT_SESSION_ID}` |
| Onboarding, cancelar | ídem | `https://app.gestcopy.com/onboarding?canceled=1` |
| Facturación, éxito | `lib/billing/checkout.ts` → `createStripeCheckoutForAttempt` | `https://{slug}.app.gestcopy.com/settings/billing/success?session_id={CHECKOUT_SESSION_ID}` |
| Facturación, cancelar | ídem | `https://{slug}.app.gestcopy.com/settings/billing?canceled=1` |
| Portal | `lib/billing/checkout.ts` → `createPortalSessionForTenant` | `https://{slug}.app.gestcopy.com/settings/billing` |

**Efecto:**
- Sobre los datos, ninguno: el webhook de Staging activa y sincroniza, y las páginas de éxito solo leen.
- El riesgo es de operación. Quien prueba acaba en un dominio de Production y podría iniciar sesión allí por error.
- Además, las páginas de éxito no se pueden probar en Staging.

**No afectados:** webhooks, base de datos, objetos y configuraciones de Stripe, correos.

## 2. Requisitos

1. El origen de retorno se configura por entorno y se valida antes de usarlo.
2. Fuera del desarrollo local no se leen `Host` ni `X-Forwarded-Host` para construir estas URLs.
3. Production y Stripe Live se comportan exactamente igual que hoy.
4. Ante una configuración inválida, la app no crea la sesión de Stripe y devuelve un error claro (fail closed). Nunca vuelve a usar Production como reserva desde Preview.

## 3. Diseño

### 3.1 Configuración

Nueva variable de servidor, `BILLING_RETURN_APP_ORIGIN`:

| Entorno | Valor | Resultado |
| --- | --- | --- |
| Production | Sin definir | `https://app.gestcopy.com`, igual que hoy. Si se define, solo vale ese mismo valor. |
| Preview, solo rama `gestcopy-staging` | `https://copyflow-git-gestcopy-staging-tecnokaizen.vercel.app` | Retorno a Staging |
| Otras ramas Preview | Sin definir | Checkout y portal responden 503 `billing_return_origin_not_configured`, sin crear nada en Stripe |
| Desarrollo local | Sin definir | Igual que hoy: `localhost` o `{slug}.localhost` con su puerto, solo con `NODE_ENV=development` |

En Preview no hace falta una URL por tenant: la app usa la URL de la rama y el selector de tenant de Preview que ya existe (`?tenant=`, ver 3.3).

### 3.2 Validación

Una función pura nueva, `resolveBillingReturnOrigins(env)`, en `lib/billing/return-origins.ts`, sin `server-only`, para poder probarla. Devuelve los constructores de URL o un motivo de rechazo.

1. **Forma:** `new URL()` válido; `https:`; sin usuario ni contraseña; sin ruta (o solo `/`), query ni fragmento; puerto por defecto.
2. **Production** (`VERCEL_ENV=production`): solo `https://app.gestcopy.com`. Cualquier otro valor se rechaza (`production_origin_mismatch`), con log y 503.
3. **Preview** (`VERCEL_ENV=preview`): el host tiene que ser uno de estos:
   - un host de plataforma de este mismo deployment (`VERCEL_BRANCH_URL` o `VERCEL_URL`), que Vercel inyecta en el entorno y que no vienen de la petición;
   - el dominio base de Preview (`TENANT_PREVIEW_BASE_DOMAIN`).

   Nunca vale `app.gestcopy.com` ni ningún `*.app.gestcopy.com` de Production. Si no, se rechaza (`preview_origin_not_allowed`). Sin variable, se rechaza (`not_configured`).
4. **Modo de Stripe:** con `STRIPE_MODE=live` solo vale el origen de Production en `VERCEL_ENV=production` (`live_requires_production_origin`). Así un Checkout de Live nunca puede volver a una Preview.
5. **Sin cabeceras:** la función no recibe `Host` ni `X-Forwarded-Host`. El tenant sale de la base de datos (`tenantSlug` del servidor), no de la petición, y se valida con `SLUG_PATTERN`.

### 3.3 URLs resultantes

| Flujo | Production (sin cambios) | Staging (`gestcopy-staging`) |
| --- | --- | --- |
| Onboarding, éxito | `https://app.gestcopy.com/onboarding/success?session_id=…` | `{rama}/onboarding/success?session_id=…` |
| Onboarding, cancelar | `https://app.gestcopy.com/onboarding?canceled=1` | `{rama}/onboarding?canceled=1` |
| Facturación, éxito | `https://{slug}.app.gestcopy.com/settings/billing/success?session_id=…` | `{rama}/settings/billing/success?tenant={slug}&session_id=…` |
| Facturación, cancelar | `https://{slug}.app.gestcopy.com/settings/billing?canceled=1` | `{rama}/settings/billing?tenant={slug}&canceled=1` |
| Portal | `https://{slug}.app.gestcopy.com/settings/billing` | `{rama}/settings/billing?tenant={slug}` |

`{rama}` es `https://copyflow-git-gestcopy-staging-tecnokaizen.vercel.app`.

**`?tenant=` reutiliza el selector de Preview que ya existe (`lib/supabase/proxy.ts`):**
- solo funciona en Preview o en local, y solo sobre un host de app de confianza;
- valida el slug, lo guarda en la cookie `httpOnly` `gc_preview_tenant` y redirige sin el parámetro, conservando `session_id`;
- el acceso lo siguen decidiendo la membresía y RLS; la cookie solo elige el contexto.

### 3.4 Cambios de código

| Fichero | Cambio |
| --- | --- |
| `lib/billing/return-origins.ts` (nuevo) | Validador y constructores de las 5 URLs |
| `lib/tenant/request-origin.ts` | Fuera del desarrollo local, delega en el validador. En local, igual que hoy. |
| `lib/billing/checkout.ts` | Éxito, cancelación y portal salen de los constructores |
| `app/api/onboarding/route.ts` | Éxito y cancelación salen de los constructores |
| `app/api/billing/checkout-session/route.ts`, `portal-session/route.ts`, `app/api/onboarding/route.ts` | Comprobación al principio, junto a `assertStripeConfig()`: 503 antes de reservar un intento o llamar a Stripe |

Sin migraciones, sin cambios en webhooks y sin tocar objetos ni configuraciones del portal de Stripe.

### 3.5 Pruebas

- **Validador (matriz):**
  - Production sin variable, igual y distinta;
  - Preview con la URL de la rama, con `VERCEL_URL` y sin variable;
  - Preview con `app.gestcopy.com`, con `{slug}.app.gestcopy.com` y con un dominio ajeno;
  - `http:`, con ruta, query, fragmento, usuario o puerto;
  - Live con un origen de Preview;
  - `Host` y `X-Forwarded-Host` manipulados, sin efecto.
- **Regresión de Production:** las 5 URLs son idénticas byte a byte a las de hoy.
- **Preview:** `?tenant=` y `{CHECKOUT_SESSION_ID}` intactos; el slug se codifica.
- **Cableado:** las 3 rutas usan los constructores, y con un 503 no se crea ninguna sesión de Stripe ni ningún intento.
- Las pruebas actuales de `trusted-origin` y `trusted-host` no cambian.

## 4. Despliegue propuesto (cada paso con autorización del propietario)

1. **Código:** PR borrador desde `main`, independiente de #158 y #161, con la CI completa.
2. **Vercel, solo Preview:** crear `BILLING_RETURN_APP_ORIGIN` limitada a la rama `gestcopy-staging`. Es un cambio de configuración de Preview, no de Production.
3. **Staging:** publicación coordinada con la sesión de integración, fast-forward sobre la HEAD de `gestcopy-staging`, Vercel READY y rollback anotado.
4. **E2E en Staging** (Stripe Test, tarjeta 4242): onboarding, éxito y cancelación de Facturación, y salida del portal. Las cinco vuelven a la URL de la rama. Después, revisión de solo lectura.
5. **Production:** merge en el orden de la sesión de release. Sin variable en Production, las URLs no cambian.

## 5. Riesgos

- **Protección de Vercel:** la URL de la rama exige sesión de Vercel. Ya es así para todas las pruebas de Staging.
- **Otras ramas Preview:** Checkout y portal dan 503. Es intencionado, para que no vuelvan a Production.
- **Cookie de tenant de Preview:** dura 14 días. Volver con `?tenant=` la fija en el mismo tenant donde empezó el Checkout.
- **Calendario de SUR4:** Production no cambia, así que esta corrección no está en el camino crítico de Live (L0–L8). Decide el propietario si Live espera a que esté hecha o va en paralelo.

## 6. Fuera de alcance (posibles pasos siguientes)

- **`appOrigin()` con `APP_BASE_URL`:** lo usa el enlace de `tenant-inactive`. Acepta cualquier origen `http(s)` sin validarlo por entorno, y se le podría aplicar el mismo validador.
- **Alias de tenant en Preview** (`e2e`, `demo` y `audit.preview.app.gestcopy.com`): se podrían usar cuando el slug tenga alias, pero V1 usa la URL de la rama para todos.
- **Dominios propios de tenants** (`tenant_domains`).
