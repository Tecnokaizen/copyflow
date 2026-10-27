# Facturación · Gestcopy Pro y oferta SUR4 (V1)

**Estado (27/10/2026, 23:59 Europe/Madrid):** código, migración, pruebas y scripts listos en la rama `feat/billing-pro-plan-sur4` (base `main` e218939), **sin commit**.

**Fuera de alcance:** Stripe Tax y las decisiones fiscales.

**Nada aplicado en:**
- Staging.
- Production.
- Stripe Live.

**Plazo:** la prueba interna de SUR4 termina el **02/11/2026 a las 13:53:09 UTC** y no habrá otra prórroga.

## 1. Decisiones aplicadas (propietario, 27/10)

| Tema | Decisión | Dónde se aplica |
| --- | --- | --- |
| Basic | 39 €/mes y 5 GiB. Incluye gestión operativa, presupuestos estándar e importación de clientes. | Migración: Basic gana `quotes` y `clients_import` |
| Pro | 79 €/mes y 50 GiB. Las funciones avanzadas V2.1 se añadirán con su propia migración cuando existan. | Migración: plan `pro`, id fijo `30000000-0000-4000-8000-000000000003` |
| IA | No figura en ningún plan ni se anuncia. | `ai_voice_orders` y la otra función de IA no están en ningún plan (phase60) |
| Venta de Pro | No hay venta general de Pro. Solo se contrata con una oferta por tenant concedida por un operador. | `lib/billing/access.ts` (autoservicio: solo `basic`). El checkout de Pro sin oferta devuelve 403 `offer_required`. |
| Oferta SUR4 | 79 € − 40 € = 39 €/mes. Se puede contratar hasta el 02/01/2027. | Cupón de Stripe de un solo uso, limitado al producto Pro, con `redeem_by` |
| Sin cambios automáticos | No hay cambios de precio ni de plan sin una decisión expresa y sin aceptar las condiciones. | Las condiciones se muestran antes de pagar, se aceptan con una casilla y se guarda su hash. En Checkout se repiten encima del botón. |
| Suscripciones | No se crean suscripciones paralelas ni se pierden datos. | El cambio de plan actualiza la misma fila (`provider_subscription_id`). La fila interna se convierte por D1. |

## 2. Qué cambia

### Base de datos: `20261028090000_commercial_plans_pro_offers_v1`

**Contenido:**
1. **Plan `pro`:** 79,00 EUR, `sort_order` 20.
   - Si ya existe un `pro` con otro id, la migración se detiene.
2. **`plan_features`:**
   - Basic gana `quotes` y `clients_import`.
   - Pro tiene el conjunto de Basic con `storage_bytes` = 53 687 091 200 (50 GiB).
3. **`billing_private.tenant_billing_offers`:**
   - Una oferta activa como máximo por tenant, plan y modo.
   - Estados: `active` → `redeemed` (webhook) o `revoked`.
   - Guarda la aceptación (quién, cuándo, hash de las condiciones) y el historial.
   - RLS activado y sin permisos para `anon`, `authenticated` ni `service_role`.
4. **Funciones solo de servidor** (`postgres` y `service_role`):

| Función | Uso | Rechazos |
| --- | --- | --- |
| `grant_tenant_billing_offer_v1` | Conceder una oferta | `invalid_input`, `reason_required`, `authorization_required`, `plan_not_found`, `invalid_discount`, `invalid_dates`, `tenant_not_found`, `offer_exists` |
| `revoke_tenant_billing_offer_v1` | Retirarla | Avisa de checkouts abiertos (`open_checkout_attempts`) |
| `list_tenant_billing_offers_v1` | Listar las ofertas | — |
| `accept_tenant_billing_offer_v1` | Aceptar las condiciones | `owner_required`, `offer_not_found`, `offer_not_active` |
| `redeem_tenant_billing_offer_v1` | Canjearla desde el webhook | Idempotente: `unchanged`, `redeemed_elsewhere`, `offer_mismatch` |

**Qué no hace:**
- no crea precios de Stripe;
- no toca suscripciones ni excepciones por tenant;
- no nombra ningún tenant.

**Vuelta atrás:** `supabase/rollbacks/20261028090000_commercial_plans_pro_offers_v1.sql`.
- Se niega si existe alguna suscripción en Pro.
- Quita las funciones, devuelve Basic a su estado anterior y desactiva Pro y sus precios.
- Conserva la tabla de ofertas como evidencia.

### Aplicación

| Archivo | Cambio |
| --- | --- |
| `lib/billing/checkout-parse.ts` | Acepta `offer_id` y `terms_hash`. Pro sin oferta devuelve `offer_required`. |
| `lib/billing/offer-terms.ts` | Texto de las condiciones, en español y calculado (importes y fechas), y su hash. |
| `lib/billing/offer-coupon.ts`, `lib/billing/offers.ts` | Validan el cupón contra la oferta antes de cada Checkout: modo, importe, duración, producto, un solo uso y `redeem_by`. También aceptan la oferta y la canjean. |
| `lib/billing/checkout.ts` | Checkout con cupón, condiciones encima del botón y metadatos `offer_id` y `offer_terms_hash`. **Con ancla:** `billing_cycle_anchor` y `proration_behavior: none`. La caducidad de la sesión se limita para que termine antes del ancla y antes de `redeem_by`. |
| `lib/billing/checkout-attempts*.ts` | Una sesión abierta solo se reutiliza si coinciden el plan, la oferta y el hash. Si no, se expira y se crea otra. |
| `lib/billing/webhook.ts` | Tras sincronizar la suscripción, canjea la oferta. Si falla, el evento es reintentable (`offer_redeem_failed`). |
| `lib/billing/stripe-config.ts`, ruta del portal | Los clientes Pro abren el portal con la configuración de cambio de plan (`STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE`). Basic usa la configuración por defecto, sin cambio de plan. |
| `app/api/billing/subscription`, `components/settings/billing-offer-card.tsx` | Tarjeta «Oferta para tu organización» con las condiciones, la casilla «He leído y acepto estas condiciones.» y el botón «Aceptar y contratar Gestcopy Pro». |

**El onboarding no cambia:** `create_organization` sigue creando:
- tenant, perfil, membresía Owner y `tenant_settings`;
- estados de pedido, tipos de cliente, canales y tienda.

El alta pública solo contrata Basic. Las suites phase25–phase31 pasan con la migración nueva.

### Scripts del operador (los ejecuta el propietario con sus claves; sin `--confirm-*` solo simulan)

| Script | Para qué |
| --- | --- |
| `scripts/billing/bootstrap-stripe-catalog.ts --plan pro` | Crea el producto «Gestcopy Pro» a 79 €/mes en Stripe y su fila en `billing_prices`. Exige que el precio de la base de datos coincida. |
| `scripts/billing/tenant-billing-offer.ts coupon` | Crea el cupón con clave de idempotencia y avisa si uno existente no coincide. |
| `scripts/billing/tenant-billing-offer.ts grant`, `revoke`, `inspect` | Concede, retira o consulta una oferta. `grant` comprueba el cupón y enseña las condiciones exactas. |
| `scripts/billing/tenant-billing-offer.ts portal` | Crea la configuración del portal Pro ↔ Basic. Se niega si la cuenta no tiene configuración por defecto o si esta permite cambiar de plan (ver el riesgo R2). |
| `scripts/billing/stripe-readonly-audit.ts` | Auditoría de Stripe **solo de lectura**. Para cerrar la de Live (sección 5). |

## 3. Calendario de cobros de la oferta SUR4

Comprobado en Stripe Test con relojes de prueba (sección 4): cliente sintético, tarjeta de prueba y sin dinero real.

| Si SUR4 paga… | Hoy | 02/11/2026 | 02/12/2026 | 02/01/2027 en adelante |
| --- | --- | --- | --- | --- |
| **Antes del 02/11 a las 13:08 UTC** (con ancla) | 0 € | 39 € | 39 € | 79 €/mes, salvo que antes cambie de plan o cancele |
| Igual, pero eligiendo Basic en diciembre desde «Gestionar suscripción» | 0 € | 39 € | 39 € | 39 €/mes en Basic, misma suscripción |
| **Después de las 13:08 UTC del 02/11** (sin ancla) | 39 € al pagar | — | 39 € un mes después | 79 €/mes desde el tercer mes |

**Notas:**
- La app usa el ancla si quedan entre 45 minutos y 27 días hasta el 02/11 13:53:09 UTC. Si no, aplica el calendario sin ancla.
- Las condiciones que ve SUR4 se calculan en el momento y coinciden con la fila que le corresponde.
- **Para no pagar 79 € el 02/01, SUR4 debe decidir antes del 02/01/2027 a las 13:53 UTC.** El cambio a Basic hecho desde el portal se aplica al final del periodo, sin prorrateo.
- Una vez en Basic, SUR4 no puede volver a Pro por su cuenta. Haría falta otra oferta del operador.

## 4. Pruebas y evidencias

| Prueba | Resultado |
| --- | --- |
| Typecheck de la app y de los scripts | Sin errores |
| Pruebas unitarias (`TZ=UTC`) | 1378 en verde, incluidas las 25 de `lib/billing/offers.test.ts` |
| Suites SQL del Release Gate en local (Supabase aislado) | Todas pasan, incluida la nueva `phase60_commercial_plans_pro` y las de onboarding phase25–31 |
| Suites de kiosco `phase12` (concurrencia) y `phase39` (deadlock) | No ejecutables en el contenedor local (necesitan node o python3). Las cubre la CI. |
| Migración | Idempotente. La vuelta atrás se probó. |
| Stripe Test: parámetros reales del Checkout de la oferta | Aceptados. Total 0 €, cupón aplicado y texto de 437 caracteres. Visto en el navegador y la sesión expirada después (`cs_test_a1bOb6…`). |
| Stripe Test: configuración del portal de cambio de plan | Parámetros aceptados (`schedule_at_period_end` y `decreasing_item_amount`) |
| Stripe Test: relojes de prueba (sandbox `acct_1UFw6BAdPWvupeyh`) | Ver la tabla siguiente |

**Relojes de prueba:**
- relojes `clock_1UVJB6…`, `clock_1UVJBD…` y `clock_1UVJBM…`;
- suscripciones `sub_1UVJBB…`, `sub_1UVJBK…` y `sub_1UVJBR…`.

| Escenario | Facturas | Resultado |
| --- | --- | --- |
| A1: pago el 27/10 con ancla, se queda en Pro | 39 € el 02/11, 39 € el 02/12 y 79 € el 02/01. Descuento hasta el 27/12. | OK |
| Reutilizar el cupón de A1 | «Coupon … is used up and cannot be applied.» | OK, un solo uso |
| A2: con ancla, elige Basic el 10/12 | 39 € y 39 €, y el 02/01 39 € de Basic. Misma `sub_…`, cambio programado al final del periodo. | OK |
| B: pago el 02/11 a las 14:00, sin ancla | 39 € al pagar, 39 € el 02/12 y 79 € el 02/01 | OK |

**phase60 cubre en base de datos:**
- conceder, aceptar, canjear y retirar ofertas;
- la conversión D1 de interna (`ready_for_checkout`) a Stripe Pro: una sola suscripción vigente, 50 GiB, presupuestos e importación, y nada de IA;
- el cambio Pro → Basic en la misma fila, conservando los clientes, con 5 GiB y manteniendo presupuestos e importación.

## 5. Estado real de Stripe Live

**Fuentes:**
- la auditoría del 22/10, la última, hecha con una clave restringida;
- la base de datos de Production (lectura del 27/10).

**Verificado:**
- cuenta `acct_1UIZG0Lp1xesIawY` en Live;
- producto Basic `prod_VLLu94VIGVA67a` activo, con el precio `price_1UKfChLp1xesIawY7AI79bUY` a 39 EUR/mes, `livemode`;
- 0 cobros desde el 01/09, 0 transferencias y saldo 0;
- en Production existe la fila `billing_prices` de Basic Live.

**No verificado** (la clave devolvía 403):
- entidad legal, `charges_enabled`, `payouts_enabled` y requisitos pendientes;
- el webhook hacia `app.gestcopy.com`;
- checkout sessions, suscripciones y portal.

**Todavía no existen en Live:**
- el producto y el precio Pro;
- el cupón SUR4;
- la configuración del portal de cambio de plan.

**Para cerrar la auditoría,** el propietario ejecuta el script con una clave restringida **solo de lectura**. Necesita lectura de Account, Balance, Charges, Checkout Sessions, Coupons, Customer portal, Prices, Products, Subscriptions y Webhook Endpoints.

```bash
STRIPE_SECRET_KEY=rk_live_… npx tsx scripts/billing/stripe-readonly-audit.ts --app-origin https://app.gestcopy.com --since 2026-09-01
```

**Criterios para seguir:**
- todas las secciones con `ok: true`;
- `charges_enabled` y `payouts_enabled` a `true`, sin requisitos `past_due`;
- `webhooks.app_endpoint_ready` a `true`: el endpoint `…/api/webhooks/stripe` está activo con los 6 eventos que usa la app;
- existe una configuración del portal por defecto con `plan_changes: false`.

El script no imprime la clave, ni datos de clientes ni de tarjetas.

## 6. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| R1 | La auditoría de Stripe Live está sin cerrar | Bloquea todos los pasos Live (sección 8). Se cierra con el script de la sección 5. |
| R2 | **Trampa del portal por defecto.** Stripe convierte la primera configuración del portal de una cuenta en la predeterminada, y esa no se puede desactivar. Si fuera la de cambio de plan, cualquier cliente Basic podría pasarse a Pro sin oferta. | El script `portal` se niega si no hay configuración por defecto o si esta permite cambiar de plan. **Ocurrió en el sandbox de Test** (`bpc_1UVJ0e…`): se renombró y se le quitó el cambio de plan. En Live hay que confirmar antes que la configuración por defecto existe y no permite cambiar de plan. |
| R3 | **La migración activa la importación de clientes para SUR4 en Production.** Hoy está apagada en todos los tenants, a la espera de una activación controlada. | Decisión D2 (sección 7). Si se quiere esperar: una excepción `clients_import = false` para SUR4 (A1) antes de la migración. |
| R4 | Plazo y ventanas: hay que coordinarse con la sesión de release (F11/F12) y su lote de copias v2 | El merge y la migración van después de F12, cada paso con su autorización y una copia v2 de menos de 2 h |
| R5 | Si SUR4 paga después de las 13:08 UTC del 02/11, el calendario cambia (tabla de la sección 3) | Las condiciones mostradas se adaptan solas, pero conviene que SUR4 pague antes del 01/11 |
| R6 | `gestcopy-staging` no contiene `main` (e218939). Fusionar la rama entera allí choca en tres archivos de pedidos ajenos a este cambio. | Llevar a Staging **solo el commit de facturación**: se aplica sin conflictos (comprobado en memoria con `git merge-tree`) |
| R7 | En Staging, la migración da presupuestos e importación por plan a d3-alta y e2e | Ambos son tenants sintéticos. Hay que avisar a la sesión de integración antes de aplicarla. |
| R8 | Stripe Tax está fuera de alcance | Los importes se cobran tal cual (39 € y 79 €). La decisión fiscal queda pendiente aparte. |
| R9 | Las migraciones posteriores (E5, E7…) deben llevar una versión mayor que `20261028090000` | Comprobarlo en cada nueva migración |

## 7. Decisiones pendientes del propietario

- **D1 · Cobro de 79 € desde el 02/01/2027.** Implementado así:
  - Pro sigue a 79 € salvo que SUR4 cambie de plan o cancele antes.
  - SUR4 lo acepta expresamente antes de pagar: casilla en la app, hash guardado y texto en Checkout.
  - Alternativa: que la suscripción termine sola el 02/01. SUR4 perdería el servicio si no decide a tiempo.
  - Recomendado: mantenerlo y **avisar a SUR4 antes del 15/12** con la fecha límite del 02/01 a las 13:53 UTC.
  - Si se quiere que SUR4 decida «en enero» sin pagar ningún mes a 79 €, el descuento tendría que cubrir 3 meses, en vez de terminar el 02/01.
- **D2 · Importación de clientes para SUR4** (R3): activarla con la migración, como dice la decisión de Basic, o retenerla con una excepción hasta una activación controlada.
- **D3 · Tenant del E2E en Staging:** se propone `d3-pendiente`, sintético de D3, sin suscripción vigente y con un Owner. `e2e`, DEMO y d3-alta quedan fuera.

## 8. Runbook

Cada paso se autoriza por separado. **No se hacen cobros Live de prueba.** El único pago real es el de SUR4, hecho por su Owner.

### Staging (Stripe Test, sandbox `acct_1UIZG9PvaU0aOV2Q`)

| Paso | Quién | Qué |
| --- | --- | --- |
| S0 | Propietario | Autoriza el commit y el PR en borrador de esta rama |
| S1 | Sesión de integración | Lleva el commit de facturación a `gestcopy-staging` (se aplica limpio) y despliega |
| S2 | Propietario, avisando a la sesión de integración | Aplica `20261028090000` en Staging (`fmmfsbhcwxkaszrrarpw`). Postcheck: plan `pro`, `plan_features` y las funciones. |
| S3 | Propietario, con el entorno de Staging | 1. `bootstrap-stripe-catalog.ts --plan pro --create --confirm-test`<br>2. Confirmar en el panel que existe la configuración del portal por defecto sin cambio de plan.<br>3. `tenant-billing-offer.ts portal --confirm-test`<br>4. Poner `STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE` en Vercel Preview y redesplegar.<br>5. `tenant-billing-offer.ts coupon --coupon-id gestcopy-e2e-pro-39 --redeem-by 2027-01-02T22:59:59Z --confirm-test` |
| S4 | Propietario (SQL de servicio) | Montar `d3-pendiente` como SUR4:<br>1. `grant_internal_subscription_v1(…, 'basic', 'trialing', '2026-11-02T13:53:09Z', motivo, quién)`<br>2. `set_internal_billing_activation_v1(…, 'ready_for_checkout', motivo, quién)` |
| S5 | Propietario | `tenant-billing-offer.ts grant --tenant d3-pendiente --coupon-id gestcopy-e2e-pro-39 --anchor 2026-11-02T13:53:09Z --promo-ends-before 2027-01-02T13:53:09Z --redeem-by 2027-01-02T22:59:59Z --terms-version e2e-pro-39-v1 --reason "E2E Staging oferta Pro" --authorized-by <propietario> --confirm-test` |
| S6 | Propietario, como Owner de d3-pendiente | Ajustes → Facturación: leer la oferta, marcar la casilla y contratar. Checkout debe mostrar 0 € hoy y el cupón. Pagar con la tarjeta 4242. |
| S7 | Claude (solo lectura) | Comprobar:<br>• el evento procesado;<br>• una sola suscripción vigente (Stripe, Pro, Test);<br>• la fila interna `converted_to_stripe`;<br>• la oferta `redeemed`, sin retenciones;<br>• 50 GiB, presupuestos e importación.<br>Después, idempotencia: «Resend» del evento en Stripe → `unchanged`. |
| S8 | Propietario | Portal: cambiar a Basic, que queda programado al final del periodo. Cancelar al final del periodo y reactivar. Una cuenta Basic no ve la oferta y recibe 403 al pedir Pro. |
| S9 | Propietario | Limpieza: cancelar la suscripción de Test y devolver `d3-pendiente` a su estado |

### Production y Stripe Live (después de F12, con la auditoría Live cerrada y una copia v2 de menos de 2 h)

| Paso | Qué |
| --- | --- |
| L0 | Merge del PR (orden fijado con la sesión de release) y despliegue. El código tolera que la migración aún no esté: sin ofertas, la tarjeta no aparece. |
| L1 | Aplicar `20261028090000` (dry-run, después push). Postcheck: una migración más (hoy hay 86 y la última es `20261022130000`), plan `pro` con el id fijo, `plan_features` y el efecto en SUR4 según D2. |
| L2 | `bootstrap-stripe-catalog.ts --plan pro --inspect`, después `--create --confirm-live` |
| L3 | Confirmar la configuración del portal por defecto sin cambio de plan. Después `tenant-billing-offer.ts portal`, y luego `--confirm-live`. Poner `STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE` en Vercel Production y redesplegar. |
| L4 | `tenant-billing-offer.ts coupon --coupon-id gestcopy-sur4-pro-39 --redeem-by 2027-01-02T22:59:59Z --name "Gestcopy Pro · oferta SUR4"`, después `--confirm-live` |
| L5 | SQL de servicio: `set_internal_billing_activation_v1('<id SUR4>', 'ready_for_checkout', 'Activación de la contratación de Pro con oferta, aprobada el 27/10/2026', '<propietario>')` |
| L6 | `tenant-billing-offer.ts grant --tenant sur4 --coupon-id gestcopy-sur4-pro-39 --anchor 2026-11-02T13:53:09Z --promo-ends-before 2027-01-02T13:53:09Z --redeem-by 2027-01-02T22:59:59Z --terms-version sur4-pro-39-v1 --reason "Oferta comercial SUR4 aprobada por el propietario el 27/10/2026" --authorized-by <propietario>`. Revisar `terms_now` y repetir con `--confirm-live`. |
| L7 | El Owner de SUR4 acepta y paga, **antes del 02/11 a las 13:08 UTC**. Lo ideal, antes del 01/11. |
| L8 | Verificación de solo lectura, igual que S7, en Live |
| L9 | Recordatorio a SUR4 antes del 15/12 (decisión D1) |

### Vuelta atrás

**Antes de que SUR4 pague:**
- `tenant-billing-offer.ts revoke`;
- `set_internal_billing_activation_v1(…, 'deferred_until_go_live', …)`;
- invalidar el cupón en el panel de Stripe. Sin oferta, la app no lo aplica, y Checkout no admite códigos promocionales.

**Migración:** el archivo de rollback. Se niega si ya hay suscripciones Pro.

**Después de que SUR4 pague:** el propietario cancela o reembolsa en Stripe y el webhook sincroniza. No hay vuelta atrás automática de datos, ni hace falta: los datos del tenant no se tocan.
