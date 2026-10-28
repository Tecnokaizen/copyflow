# Facturación · Gestcopy Pro y oferta SUR4 (V1)

**Estado (28/10/2026):** rama `feat/billing-pro-plan-sur4` (base `main` e218939), PR en borrador [#158](https://github.com/Tecnokaizen/copyflow/pull/158).

**Incluye las decisiones del 28/10:**
- **D1:** calendario fijo de la oferta.
- **D2:** el derecho comercial va separado de la activación operativa.

**Fuera de alcance:** Stripe Tax y las decisiones fiscales.

**Nada aplicado en Production ni en Stripe Live.** Staging queda pendiente del E2E de la sección 8.

**Migración:** alcance, dependencias, efecto en RLS y procedimiento de aplicación, verificación y recuperación en [BILLING-PRO-MIGRATION-20261028090000.md](BILLING-PRO-MIGRATION-20261028090000.md).

**Plazo:** la prueba interna de SUR4 termina el **02/11/2026 a las 13:53:09 UTC (14:53 en Madrid)** y no habrá otra prórroga.

## 1. Decisiones aplicadas

| Tema | Decisión | Dónde se aplica |
| --- | --- | --- |
| Basic | 39 €/mes y 5 GiB. Incluye gestión operativa, presupuestos estándar e importación de clientes. | Migración: Basic gana `quotes` y `clients_import` como derechos de plan |
| Pro | 79 €/mes y 50 GiB. Las funciones avanzadas V2.1 llegarán con su propia migración cuando existan. | Migración: plan `pro`, id fijo `30000000-0000-4000-8000-000000000003` |
| IA | No figura en ningún plan ni se anuncia. | `ai_voice_orders` y la otra función de IA no están en ningún plan (phase60) |
| Venta de Pro | No hay venta general de Pro. Solo se contrata con una oferta por tenant concedida por un operador. | `lib/billing/access.ts` (autoservicio: solo `basic`). El checkout de Pro sin oferta devuelve 403 `offer_required`. |
| Oferta SUR4 | 79 € − 40 € = 39 €/mes en las cuotas del 02/11 y del 02/12/2026, y 79 €/mes desde el 02/01/2027. | Cupón de Stripe de un solo uso, limitado al producto Pro. Oferta con ancla. |
| **D1** · Aceptación y salida | Las condiciones se aceptan de forma expresa antes de contratar. SUR4 debe poder cambiar a Basic o cancelar antes de la renovación. | Casilla en la app, hash guardado y texto en Checkout. El portal Pro permite cambiar a Basic o cancelar al final del periodo. |
| **D1** · Calendario fijo | Ver la regla de la sección 3. | `lib/billing/offer-terms.ts` y validación `calendar_mismatch` en `grant_tenant_billing_offer_v1` |
| **D2** · Importación | Basic y Pro la incluyen comercialmente, pero la migración **no la activa** en ningún tenant. | `billing_private.feature_rollouts`: `clients_import` empieza retenida. Ver la sección 2. |
| Suscripciones | No se crean suscripciones paralelas ni se pierden datos. | El cambio de plan actualiza la misma fila (`provider_subscription_id`). La fila interna se convierte por D1. |

## 2. Qué cambia

### Base de datos: `20261028090000_commercial_plans_pro_offers_v1`

**1. Plan `pro`:** 79,00 EUR, `sort_order` 20. Si ya existe un `pro` con otro id, la migración se detiene.

**2. Derechos comerciales (`plan_features`):**
- Basic gana `quotes` y `clients_import`.
- Pro tiene el conjunto de Basic, con `storage_bytes` = 53 687 091 200 (50 GiB).

**2b. Activación operativa (D2):**
- **`billing_private.feature_rollouts`:**
  - Una fila `held` impide que el plan active esa funcionalidad.
  - Sin fila, o con la fila `released`, el plan se aplica como hasta ahora.
  - RLS activado y sin permisos para `anon`, `authenticated` ni `service_role`.
- **`clients_import` entra como `held`.**
  - La migración no la activa para nadie.
  - Volver a aplicar la migración no la retiene de nuevo si un operador ya la liberó.
- **`tenant_has_feature`:** mantiene sus reglas y añade una sola comprobación.
  1. Primero, las excepciones por tenant (A1).
  2. Después, el plan vigente.
  3. Si la funcionalidad está retenida, el plan no la activa.

  Se conservan los permisos (`authenticated` y `service_role`), `SECURITY DEFINER` y el `search_path` vacío.
- **`set_feature_rollout_v1(código, 'held' | 'released', motivo, quién)`:**
  - solo de servicio e idempotente (`unchanged`);
  - guarda el historial;
  - rechazos: `invalid_input`, `reason_required`, `authorization_required`, `feature_not_found`.

**Dos formas de activar la importación**, cada una con su autorización:

| Alcance | Cómo |
| --- | --- |
| Un tenant (activación controlada) | Excepción A1: `set_tenant_feature_v2('<slug>', 'clients_import', true, null, '<motivo>', <revisión o null>, '<quién>')` |
| Todos los tenants con Basic o Pro | `set_feature_rollout_v1('clients_import', 'released', '<motivo>', '<quién>')` |

**3. `billing_private.tenant_billing_offers`:**
- Una oferta activa como máximo por tenant, plan y modo.
- Estados: `active` → `redeemed` (webhook) o `revoked`.
- Guarda la aceptación (quién, cuándo y hash de las condiciones) y el historial.

**4. Funciones de ofertas** (`postgres` y `service_role`):

| Función | Uso | Rechazos |
| --- | --- | --- |
| `grant_tenant_billing_offer_v1` | Conceder una oferta | `invalid_input`, `reason_required`, `authorization_required`, `plan_not_found`, `invalid_discount`, `invalid_dates`, **`calendar_mismatch`** (regla D1), `tenant_not_found`, `offer_exists` |
| `revoke_tenant_billing_offer_v1` | Retirarla | Avisa de checkouts abiertos |
| `list_tenant_billing_offers_v1` | Listar | — |
| `accept_tenant_billing_offer_v1` | Aceptar | `owner_required`, `offer_not_found`, `offer_not_active` |
| `redeem_tenant_billing_offer_v1` | Canjear desde el webhook | Idempotente |

**Qué no hace:**
- no crea precios de Stripe;
- no toca suscripciones ni excepciones por tenant;
- no nombra ningún tenant.

**Vuelta atrás:** `supabase/rollbacks/20261028090000_commercial_plans_pro_offers_v1.sql`.
- Se niega si existe alguna suscripción en Pro.
- Restaura `tenant_has_feature` tal como estaba (`20260923190000_quotes_v1`).
- Quita las funciones nuevas, devuelve Basic a su estado anterior y desactiva Pro y sus precios.
- Conserva las tablas `tenant_billing_offers` y `feature_rollouts` como evidencia.

### Aplicación

| Archivo | Cambio |
| --- | --- |
| `lib/billing/checkout-parse.ts` | Acepta `offer_id` y `terms_hash`. Pro sin oferta devuelve `offer_required`. |
| `lib/billing/offer-terms.ts` | Condiciones calculadas a partir de la oferta, **nunca de la hora actual**, y su hash. Fecha límite para contratar, coherencia del calendario y momento en que la oferta se puede usar (regla D1). |
| `lib/billing/offer-coupon.ts`, `lib/billing/offers.ts` | Validan el cupón contra la oferta antes de cada Checkout. Aceptan y canjean la oferta. |
| `lib/billing/checkout.ts` | Checkout con cupón, condiciones encima del botón y metadatos de la oferta. Con ancla: `billing_cycle_anchor` y `proration_behavior: none`. La sesión caduca 10 minutos antes del ancla o del último momento válido de pago. |
| `lib/billing/checkout-attempts*.ts` | Una sesión abierta solo se reutiliza si coinciden el plan, la oferta y el hash. |
| `lib/billing/webhook.ts` | Canjea la oferta tras sincronizar. Si falla, el evento es reintentable. |
| `lib/billing/stripe-config.ts`, ruta del portal | Los clientes Pro abren la configuración de cambio de plan (`STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE`). |
| `app/api/billing/subscription`, `components/settings/billing-offer-card.tsx` | Tarjeta «Oferta para tu organización» con las condiciones, una casilla de aceptación y el botón de contratar |

**El onboarding no cambia:**
- `create_organization` crea tenant, perfil, membresía Owner, `tenant_settings`, estados de pedido, tipos de cliente, canales y tienda.
- El alta pública solo contrata Basic.
- Las suites phase25–31 pasan.

### Scripts del operador (los ejecuta el propietario con sus claves; sin `--confirm-*` solo simulan)

| Script | Para qué |
| --- | --- |
| `bootstrap-stripe-catalog.ts --plan pro` | Crea el producto y el precio Pro a 79 €/mes y su fila en `billing_prices` |
| `tenant-billing-offer.ts coupon` | Crea el cupón con clave de idempotencia |
| `tenant-billing-offer.ts grant`, `revoke`, `inspect` | Concede, retira o consulta. `grant` comprueba el cupón y el calendario, y muestra las condiciones, la fecha límite y si se puede usar ya. |
| `tenant-billing-offer.ts portal` | Configuración del portal Pro ↔ Basic. Se niega si la configuración por defecto falta o permite cambiar de plan (riesgo R2). |
| `stripe-readonly-audit.ts` | Auditoría de Stripe **solo de lectura** (sección 5) |

## 3. Regla del calendario fijo (D1)

**Regla.** Ningún periodo con precio promocional pasa de `promo_ends_before`, para la oferta de SUR4 el **02/01/2027 a las 13:53:09 UTC**. Desde esa fecha se aplica el precio ordinario de 79 €/mes, salvo que antes SUR4 haya cambiado de plan o cancelado.

**Consecuencias:**
1. **Con ancla, que es el caso de SUR4:**
   - las fechas son fijas: 0 € hasta el ancla, una cuota con descuento en el ancla y en cada mes siguiente, y la primera cuota ordinaria exactamente en `promo_ends_before`;
   - `grant` se niega con `calendar_mismatch` si el ancla más los meses no da esa fecha exacta.
2. **Una oferta nunca se reajusta sola.**
   - Se puede contratar desde 27 días antes del ancla hasta **45 minutos antes** (para SUR4, hasta el **02/11/2026 a las 14:08, hora de Madrid**).
   - Después se cierra: la app la oculta y Checkout la rechaza.
   - Ya no existe la vuelta a «2 cuotas desde el pago», que era lo que podía alargar el precio de 39 € más allá del 02/01.
3. **Si SUR4 contrata más tarde:**
   - solo con una **nueva oferta autorizada**: ancla el 02/12/2026 a las 13:53:09 UTC, 1 cuota, cupón de 1 mes y el mismo `promo_ends_before`;
   - así se mantiene el precio de 79 € desde el 02/01;
   - pasado el 02/12 a las 14:08 (hora de Madrid) ya no cabe ninguna cuota con descuento antes del 02/01, así que no hay promoción posible.
4. **Ofertas sin ancla** (futuras, no las de SUR4):
   - las cuotas con descuento cuentan desde el pago;
   - solo se pueden contratar mientras esas cuotas terminen, como tarde, en `promo_ends_before`.
5. **«Válido para contratar»** muestra la fecha límite real, con hora.
   - Por eso el cupón y la oferta de SUR4 caducan en el ancla: `redeem_by` el 02/11/2026 a las 13:53:09 UTC.
   - Ya no se usa el 02/01/2027 como fecha límite para contratar: con la regla anterior, contratar después del 02/12 no tendría ningún descuento.

**Calendario resultante para SUR4.** Comprobado en Stripe Test con relojes de prueba, con cliente sintético y sin dinero real.

| Caso | Hoy | 02/11/2026 | 02/12/2026 | 02/01/2027 en adelante |
| --- | --- | --- | --- | --- |
| Contrata antes del 02/11 a las 14:08 (Madrid) y se queda en Pro | 0 € | 39 € | 39 € | 79 €/mes |
| Igual, pero cambia a Basic antes de la renovación desde «Gestionar suscripción» | 0 € | 39 € | 39 € | 39 €/mes en Basic, misma suscripción |
| Igual, pero cancela antes de la renovación | 0 € | 39 € | 39 € | Nada: la suscripción termina el 02/01 |
| No contrata antes del 02/11 a las 14:08 (Madrid) | La oferta se cierra. Sigue en Basic o, con una oferta nueva autorizada, paga 39 € el 02/12 y 79 € desde el 02/01. | | | |

**Para no pagar 79 € el 02/01, SUR4 tiene que actuar antes del 02/01/2027 a las 14:53 (hora de Madrid).** El cambio a Basic y la cancelación desde el portal se aplican en esa renovación, sin prorrateo.

### Recordatorio a SUR4 (D1, antes del 15/12/2026)

**Quién y cuándo:** lo envía el propietario entre el 01/12 y el 15/12. Este texto es solo un borrador; no se envía nada automáticamente.

> **Asunto:** Tu plan Gestcopy Pro: decide antes del 2 de enero
>
> Hola:
>
> Os recordamos que la oferta de Gestcopy Pro a 39 €/mes termina con la cuota del 2 de diciembre. A partir del 2 de enero de 2027 el precio de Pro será de 79 €/mes, como aceptasteis al contratar.
>
> Si preferís seguir con Gestcopy Basic (39 €/mes, 5 GiB, gestión operativa, presupuestos e importación), podéis cambiarlo antes del 2 de enero a las 14:53 desde Ajustes → Facturación → «Gestionar suscripción». El cambio se aplica en esa renovación y conserváis todos vuestros datos. También podéis cancelar desde el mismo sitio.
>
> Si no hacéis nada, seguiréis en Pro a 79 €/mes.
>
> Cualquier duda, respondednos a este correo.

## 4. Pruebas y evidencias

| Prueba | Resultado |
| --- | --- |
| Pruebas unitarias (`TZ=UTC`) | En verde, incluidas las 30 de `lib/billing/offers.test.ts`: regla D1, oferta posterior de una cuota, ofertas sin ancla y comprobaciones estáticas de D2 |
| Typecheck de la app y de los scripts, y lint | Sin errores |
| Suites SQL del Release Gate en local, con la base reiniciada | Todas en verde. **phase60** cubre D2 (retención, excepción A1 para un solo tenant, liberación idempotente y nueva retención) y D1 (`calendar_mismatch`). |
| phase50 (importación), phase54 (A1), phase33 (presupuestos) | En verde. La importación sigue funcionando con excepciones por tenant. |
| Suites de kiosco phase12 y phase39 | No se pueden ejecutar en el contenedor local. Las cubre la CI. |
| Stripe Test: Checkout real de la oferta | Parámetros aceptados: total 0 €, cupón y texto de condiciones (`cs_test_a1bOb6…`, expirada) |
| Stripe Test: portal de cambio de plan | Parámetros aceptados (`schedule_at_period_end` y `decreasing_item_amount`) |
| Stripe Test: relojes de prueba (sandbox `acct_1UFw6BAdPWvupeyh`) | Detalle en la tabla siguiente |

| Escenario | Resultado |
| --- | --- |
| A1: pago el 27/10 con ancla | 39 € el 02/11, 39 € el 02/12 y 79 € el 02/01 |
| A2: cambio a Basic el 10/12 | 39 €, 39 €, y 39 € de Basic el 02/01, en la misma `sub_…` |
| Reutilizar el cupón | Rechazado: es de un solo uso |
| B: pago sin ancla | 39 €, 39 € y 79 € desde el tercer mes |

Con la regla D1, el escenario B ya no se aplica a la oferta de SUR4: pasado el plazo, la oferta se cierra.

## 5. Estado real de Stripe Live

**Verificado** en la auditoría del 22/10, la última:
- cuenta `acct_1UIZG0Lp1xesIawY` en Live;
- Basic `prod_VLLu94VIGVA67a` con el precio `price_1UKfChLp1xesIawY7AI79bUY` a 39 EUR/mes;
- 0 cobros, 0 transferencias y saldo 0;
- en Production existe la fila `billing_prices` de Basic Live.

**No verificado** (la clave devolvía 403):
- entidad legal, `charges_enabled`, `payouts_enabled` y requisitos;
- el webhook hacia `app.gestcopy.com`;
- sesiones de Checkout, suscripciones y portal.

**Todavía no existen en Live:** el producto y el precio Pro, el cupón de SUR4 y la configuración del portal de cambio de plan.

**Para cerrar la auditoría,** el propietario ejecuta el script con una clave restringida **solo de lectura**:

```bash
STRIPE_SECRET_KEY=rk_live_… npx tsx scripts/billing/stripe-readonly-audit.ts --app-origin https://app.gestcopy.com --since 2026-09-01
```

**Criterios para seguir:**
- todas las secciones con `ok: true`;
- `charges_enabled` y `payouts_enabled` a `true`, sin requisitos `past_due`;
- `webhooks.app_endpoint_ready` a `true`;
- existe una configuración del portal por defecto con `plan_changes: false`.

## 6. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| R1 | La auditoría de Stripe Live está sin cerrar | Bloquea los pasos Live. Se cierra con el script de la sección 5. |
| R2 | Trampa del portal por defecto: Stripe convierte la primera configuración del portal en la predeterminada | El script `portal` se niega si no hay configuración por defecto o si permite cambiar de plan. Ocurrió en el sandbox de Test (`bpc_1UVJ0e…`, ya neutralizada). |
| R3 | Activación accidental de la importación | **Resuelto con D2:** queda retenida hasta una decisión expresa |
| R4 | Plazo y ventanas, que hay que coordinar con la sesión de release | Merge y migración después de F12, con una copia v2 de menos de 2 h y autorización para cada paso |
| R5 | SUR4 no contrata antes del 02/11 a las 14:08 (Madrid) | La oferta se cierra sola. Una oferta nueva solo con autorización (sección 3). |
| R6 | `gestcopy-staging` no contiene `main`: la rama entera choca en tres archivos de pedidos | Integrar en Staging **solo los commits de facturación** (590445a y 9cc52b1). Comprobado el 28/10 en una copia aparte sobre 1b11745: sin conflictos, tsc limpio y 1485 pruebas unitarias en verde. |
| R7 | En Staging, la migración da presupuestos por plan a los tenants con Basic vigente | Medido el 28/10 en solo lectura: solo cambia **d3-alta**; demo y e2e ya los tenían por concesión. La importación no cambia para nadie: solo e2e y e2e-import la tienen, por concesión. Se avisa antes a la sesión de integración. |
| R8 | Stripe Tax está fuera de alcance | Los importes se cobran tal cual |
| R9 | Las migraciones posteriores deben llevar una versión mayor que `20261028090000` | Comprobarlo en cada nueva migración |
| R10 | Sin `STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE`, SUR4 no puede cambiar a Basic por su cuenta | Requisito del paso L3, antes de L7 |

## 7. Decisiones del propietario

- **D1:** aprobada el 28/10, con la regla de la sección 3. **Confirmar la regla:**
  - la oferta de SUR4 caduca el 02/11 a las 14:08 (hora de Madrid);
  - una contratación posterior necesita una oferta nueva;
  - nunca hay precio de 39 € más allá del 02/01.
- **D2:** aprobada el 28/10. Implementada: la importación queda retenida. Activarla, para SUR4 o para todos, es una operación aparte con su propia autorización.
- **D3:** el E2E de Staging usará `d3-pendiente`.

## 8. Runbook

Cada paso se autoriza por separado. **No se hacen cobros Live de prueba.** El único pago real es el de SUR4, hecho por su Owner.

### Staging (Stripe Test, sandbox `acct_1UIZG9PvaU0aOV2Q`), autorizado el 28/10

| Paso | Quién | Qué |
| --- | --- | --- |
| S1 | Sesión de integración | Llevar **solo** los commits de #158 a `gestcopy-staging` (cherry-pick; se aplican limpios sobre 1b11745) y desplegar |
| S2 | Claude, avisando antes a la sesión de integración | Aplicar `20261028090000` en Staging (`fmmfsbhcwxkaszrrarpw`). Postcheck: plan `pro`, `plan_features`, `clients_import` `held` y las funciones. |
| S3 | Propietario, con el entorno de Staging | 1. `bootstrap-stripe-catalog.ts --plan pro --create --confirm-test`<br>2. Confirmar la configuración del portal por defecto sin cambio de plan.<br>3. `tenant-billing-offer.ts portal --confirm-test`<br>4. Poner `STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE` en Vercel Preview y redesplegar.<br>5. `tenant-billing-offer.ts coupon --coupon-id gestcopy-e2e-pro-39 --redeem-by 2026-11-02T13:53:09Z --confirm-test` |
| S4 | Claude (SQL de servicio en Staging) | Montar `d3-pendiente` como SUR4:<br>1. `grant_internal_subscription_v1(…, 'basic', 'trialing', '2026-11-02T13:53:09Z', motivo, quién)`<br>2. `set_internal_billing_activation_v1(…, 'ready_for_checkout', motivo, quién)` |
| S5 | Propietario | `tenant-billing-offer.ts grant --tenant d3-pendiente --coupon-id gestcopy-e2e-pro-39 --anchor 2026-11-02T13:53:09Z --promo-ends-before 2027-01-02T13:53:09Z --redeem-by 2026-11-02T13:53:09Z --terms-version e2e-pro-39-v1 --reason "E2E Staging oferta Pro" --authorized-by <propietario> --confirm-test` |
| S6 | Propietario, como Owner de d3-pendiente | Ajustes → Facturación: leer la oferta, marcar la casilla y contratar. Checkout debe mostrar 0 € hoy y el cupón. Pagar con la tarjeta 4242. |
| S7 | Claude (solo lectura) | Comprobar:<br>• el evento procesado;<br>• una sola suscripción vigente (Stripe, Pro, Test);<br>• la fila interna `converted_to_stripe` y la oferta `redeemed`;<br>• sin retenciones;<br>• 50 GiB y presupuestos sí, **importación no** (retenida).<br>Después, «Resend» del evento → `unchanged`. |
| S8 | Propietario | Portal: cambiar a Basic, que queda programado al final del periodo. Cancelar al final del periodo y reactivar. Un tenant Basic no ve la oferta y recibe 403 al pedir Pro. |
| S9 | Propietario y Claude | Limpieza: cancelar la suscripción de Test, devolver `d3-pendiente` a su estado y retirar el acceso de pruebas del propietario (membresía Owner y usuario de Auth). |
| S10 | Propietario, después Claude (solo lectura) | Onboarding de pago, pedido por el propietario el 28/10: alta de un usuario nuevo, organización nueva, Basic en Checkout de Test con la tarjeta 4242, y comprobación de tenant, Owner, membresía, configuración inicial, derechos y aislamiento. Guion completo en «Guion de S10», bajo la tabla de estado. |

#### Estado del E2E de Staging (28/10/2026)

| Paso | Estado |
| --- | --- |
| S1 | La sesión de integración tiene preparados en local los cherry-picks (`git cherry-pick -x`) sobre 1b11745: **494ba33** y **1ea797e**. Sin conflictos y sin tocar archivos de pedidos. tsc limpio, 1472 pruebas unitarias en verde y 0 fallos, eslint sin errores. **No los ha subido:** espera a que se aplique la migración. Después hará el push sin forzar y esperará a que el despliegue esté en READY. |
| S2 | **Aplicada el 28/10**, con autorización expresa del propietario y el OK de la sesión de integración (sin E2E en marcha). Detalle a continuación. |
| Copia | Hecha antes del E2E, a petición del propietario. Lote `20261027T233844Z`: runner B1.3, clave age solo de Staging, fuera de Git. Integridad SHA-256 correcta. Restauración aislada con `RESTORE_DATABASE_ISOLATED_SUCCESS` y la huella igual en los 5 esquemas, en 41 s. Registro en `~/copyflow-ops/staging-backups/RECORD-20261027T233844Z.md`. |
| Gate | El propietario esperó al cierre formal del Release Gate R5/R6 y lo aceptó el 28/10. Acta de la sesión de release: `acta-cierre-r5r6-release-gate-20261027.md`, del 27/10 a las 23:35 UTC, con addendum de las 23:58 UTC. F12.2 es seguimiento de Production y no bloquea Staging. Los checks de #158 están en verde en `d7339eb`, `kiosk-database` incluido. Verificación de la migración en [BILLING-PRO-MIGRATION-20261028090000.md](BILLING-PRO-MIGRATION-20261028090000.md), sección 0. |
| S1 | **Hecho el 28/10.**<br>• **Código:** `1ea797e` = 1b11745 + **494ba33** + **1ea797e**. Son los cherry-picks de 590445a y 9cc52b1, idénticos en los 28 ficheros de facturación.<br>• **CI completa en verde sobre `1ea797e`**, lanzada con `workflow_dispatch` en la rama `integration/staging-20261028-billing-pro`: Release gate, run 40607185670 (App, Database y Backup recovery), y Kiosk Supabase security, run 40607189053.<br>• **Publicación:** fast-forward de `gestcopy-staging`, 1b11745..1ea797e, sin force. Ni `main` ni otras ramas cambian.<br>• **Vercel:** `dpl_8JBDLS8ekTECykzgbnzHrx3Mj8Uj` READY (fra1, 00:21Z), con los alias `e2e`, `demo` y `audit.preview.app.gestcopy.com`. La vuelta atrás es `dpl_Fd4pnZywHG9e1fFeqWjPbzFYBKXX` (1b11745). |
| Incidencia S1 | El PR borrador #159, contra `main` y solo para CI, sale **en conflicto**: 1b11745 no desciende de e218939, porque R6 entró en Staging por otro commit. GitHub no lanza ahí los workflows de PR, así que la CI se lanzó sobre la rama, que prueba exactamente `1ea797e`. Cambiar la base de #159 a `gestcopy-staging` lo bloqueó el modo automático y no se insistió. |
| Migraciones | Siguen 87, la última `20261028090000`, sin volver a aplicarla. `feature_rollouts`: `clients_import:held`. |
| S4 | **Hecho el 28/10 a las 00:22Z.**<br>• `grant_internal_subscription_v1` (00:22:17Z): Basic interna `trialing` hasta el 02/11 a las 13:53:09 UTC (`a72271c8-…`, 5 GiB).<br>• `set_internal_billing_activation_v1` (00:22:22Z): `ready_for_checkout`, sin Checkout abiertos.<br>• **Derechos:** `d3-pendiente` tiene presupuestos por plan y no la importación. La importación solo la tienen `e2e` y `e2e-import`, por concesión. Ninguna suscripción Pro.<br>• **Aislamiento, como Owner de `d3-pendiente`:** 1 tenant visible y 0 membresías, presupuestos, pedidos o suscripciones ajenos. `tenant_has_feature` sobre otro tenant devuelve `false`. |
| S3 | **Hecho por el propietario el 28/10.** Redespliegue con `STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE`: `dpl_AfNNF3J91r8d853BizEknVzqTStE` READY a las 15:18:52Z, mismo código `1ea797e`. |
| S5 | **Hecho por el propietario el 28/10 a las 15:22:36Z.** Oferta `e5948b1e-…` en `active`:<br>• cupón `gestcopy-e2e-pro-39`, −40 € durante 2 meses;<br>• ancla el 02/11 a las 13:53:09Z y `promo_ends_before` el 02/01/2027 a las 13:53:09Z;<br>• `livemode=false`.<br>No se repite. |
| Acceso S6 | **Preparado el 28/10 a las 15:38Z.** El único Owner de `d3-pendiente` era el usuario sintético `e2e-d3-pendiente@example.com`, sin credenciales para el propietario.<br>• **Usuario de pruebas del propietario:** `8f6abbc0-…`, con un alias de su correo. Lo creó el propietario a las 15:37:50Z, ya confirmado, con un script local que solo acepta Staging y pide la contraseña sin mostrarla. La contraseña no pasó por el chat ni por Claude.<br>• **Membresía:** Claude añadió por SQL el perfil y la membresía Owner `29174b78-…`, solo en `d3-pendiente`. El Owner sintético se mantiene. Hay dos Owners, y ni el código ni las funciones SQL asumen uno solo.<br>• **Verificación:** el usuario tiene una sola membresía, Owner activa en `d3-pendiente`. Es el único cambio de membresías de las últimas 3 h. Con su RLS ve 1 tenant, solo las membresías y la suscripción de `d3-pendiente`, y 0 pedidos, clientes o ajustes ajenos. Presupuestos sí, importación no.<br>• **Descartado:** las invitaciones de la app nunca crean Owner, y en Staging su enlace apunta al dominio de Production. El alta pública de Staging exige confirmar el correo, y el SMTP de Auth no está verificado.<br>• **En S9:** retirar esta membresía y este usuario. |
| S6 | **Hecho por el propietario el 28/10**, con su usuario de pruebas:<br>• aceptó la oferta a las 15:41:34Z (hash `5127a472…`);<br>• el Checkout `cs_test_a1HLm2…` se completó;<br>• la suscripción `sub_1UVYzTPvaU0aOV2QaA1HUIS5` se creó a las 15:42:15Z.<br>Stripe reutilizó el cliente de Test `cus_VTGE7ajPHxwHbU`, el de las pruebas D3 del 19/10. |
| S7 | **PASS el 28/10 a las 15:51Z.**<br>• **Eventos:** `customer.subscription.created` (`evt_1UVYzUPvaU0aOV2QThXuNMx1`) y `checkout.session.completed` (`evt_1UVYzUPvaU0aOV2QCZmYY7J7`), los dos `processed` al primer intento, sin error y con `livemode=false`.<br>• **Suscripción:** una sola vigente, `5b00f522-…`, Stripe Pro de Test `active`, del 28/10 a las 15:41:35Z hasta el ancla del 02/11 a las 13:53:09Z. Es la única Pro de Staging.<br>• **Fila interna `a72271c8-…`:** `canceled` y `converted_to_stripe`, cerrada a las 15:42:18Z y enlazada a `sub_1UVYzT…`.<br>• **Oferta `e5948b1e-…`:** `redeemed` a las 15:42:18Z, con el historial `granted` → `accepted` → `redeemed`.<br>• **Intento de Checkout `717378e5-…` (Pro):** `completed`. El de Basic del 19/10 quedó `expired`.<br>• **Retenciones:** ninguna nueva. Solo queda la del 19/10, en `reconciled`.<br>• **Derechos:** 50 GiB desde el plan actual, presupuestos sí e importación no (`held`, sin concesiones). El tenant está activo y `ready`. Siguen 87 migraciones.<br>• **Logs:** en Supabase no hay errores en la ventana; las 213 peticiones dieron 200. Vercel no devuelve registros de esa ventana.<br>• **Idempotencia:** el propietario reenvió `evt_1UVYzUPvaU0aOV2QCZmYY7J7` desde el panel de Stripe (Test). Llegó a las 15:50:22Z como una sola llamada a `claim_billing_webhook_event_v1`, sin sincronización, cierre ni canje: la ruta lo trata como ya terminado (`duplicate: true`) y no lo reprocesa.<br>Después del reenvío no cambió nada: el evento sigue en una fila, intento 1, procesado a las 15:42:19Z; siguen las mismas 4 suscripciones con sus fechas, una sola vigente y una sola Pro en Staging; la oferta sigue `redeemed`, con 3 entradas de historial; el intento de Checkout no cambió; no hay retenciones abiertas ni eventos sin cerrar. Derechos iguales (50 GiB, presupuestos sí, importación no) y 87 migraciones. Sin errores en los logs de Supabase desde las 15:46Z. |
| S8 | **PASS el 28/10 a las 16:56Z: A, B y C correctos** (detalle en las filas siguientes). Guion preparado el 28/10 a las 15:55Z. Para un suscriptor Pro, el portal usa la configuración de cambio de plan: cancelación al final del periodo, cambio Pro ↔ Basic sin prorrateo y bajada de precio programada al final del periodo. Primero se cancela y se reactiva, porque con un cambio programado Stripe puede limitar la cancelación en el portal. Después se programa la bajada.<br>**A. Cancelar y reactivar.** El propietario, con su usuario de pruebas en `d3-pendiente`, abre Ajustes → Facturación → «Gestionar suscripción». Comprueba que el portal ofrece cambiar de plan (prueba de S3), sin cambiarlo aún. Cancela la suscripción y vuelve a la app, que debe mostrar Cancelación «Cancelará al final del periodo».<br>Claude comprueba que se procesó `customer.subscription.updated`; que la fila `5b00f522-…` tiene `cancel_at_period_end` o `cancel_at` igual al 02/11 a las 13:53:09Z, sigue `active` y en Pro con 50 GiB; y que no hay suscripción nueva, ni retenciones, ni cambios en la oferta.<br>Después el propietario reactiva en el portal; la app debe mostrar «No programada», y Claude comprueba que se han limpiado las marcas de cancelación.<br>**B. Bajada a Basic.** En el portal, cambiar el plan a Basic y confirmar. El portal debe indicar que el cambio se aplica el 2 de noviembre, sin cargo hoy.<br>Claude comprueba que los eventos se procesaron o ignoraron sin error; que la fila sigue en Pro `active` hasta el 02/11 con 50 GiB; y que no hay suscripción nueva ni retenciones. La app no muestra el cambio programado, porque no lo guarda; Stripe lo aplicaría el 02/11 a las 13:53Z, pero S9 cancela antes. El paso efectivo a Basic en la misma suscripción ya se probó con relojes de Test.<br>**C. Sin oferta y 403 al pedir Pro.** Claude ya comprobó que `list_tenant_billing_offers_v1` no devuelve ofertas para `d3-alta` ni `e2e` (los Basic), ni para `demo` o `d3-pendiente`. Esos dos Basic solo tienen Owners sintéticos, así que la prueba en vivo se hace en `demo`, con `tecnokaizen@gmail.com`: Facturación no muestra la oferta Pro. Desde la consola del navegador, `POST /api/billing/checkout-session` con `{"plan_code":"pro","billing_interval":"month"}` debe devolver 403 `offer_required`. Esa respuesta se da antes de mirar el plan del tenant, así que es la misma que daría un tenant Basic. |
| S8 · A, cancelación | **PASS el 28/10 a las 16:09Z.** El propietario canceló desde el portal y la app muestra «Cancelará al final del periodo».<br>• **Evento:** un solo `customer.subscription.updated` (`evt_1UVZNPPvaU0aOV2QtnIv8vr2`), procesado al primer intento a las 16:07:01Z, sin error y con `livemode=false`.<br>• **Suscripción `5b00f522-…`:** sigue `active` y en Pro. Stripe marca la cancelación con `cancel_at` igual al final del periodo, el 02/11 a las 13:53:09Z, y deja `cancel_at_period_end=false`. La app trata los dos casos igual.<br>• **Sin efectos secundarios:** siguen 4 suscripciones y ninguna nueva; la oferta no ha cambiado (`redeemed`); no hay retenciones abiertas.<br>• **Derechos:** 50 GiB, presupuestos sí, importación no. El tenant sigue activo y `ready`.<br>• **Logs:** el webhook siguió el flujo normal (reclamar, sincronizar, activar y cerrar) y todas las llamadas dieron 200. Postgres no registra errores. |
| S8 · A, reactivación | **PASS el 28/10 a las 16:17Z.** El propietario reactivó desde el portal y la app muestra «No programada».<br>• **Evento:** un solo `customer.subscription.updated` (`evt_1UVZWnPvaU0aOV2Q8i0KLdYq`), procesado al primer intento a las 16:16:43Z, sin error y con `livemode=false`.<br>• **Suscripción `5b00f522-…`:** `active` y en Pro, con `cancel_at=null` y `cancel_at_period_end=false`. El periodo sigue terminando el 02/11 a las 13:53:09Z.<br>• **Sin efectos secundarios:** siguen 4 suscripciones; la oferta sigue `redeemed`; no hay retenciones abiertas ni eventos sin cerrar hoy.<br>• **Derechos:** 50 GiB, presupuestos sí, importación no. El tenant sigue activo y `ready`.<br>• **Logs:** el webhook hizo su flujo normal, con todas las llamadas en 200. Postgres no registra errores. |
| S8 · B, bajada a Basic | **PASS el 28/10 a las 16:27Z.** El portal ofreció el cambio de plan, lo que confirma la configuración de S3. El propietario eligió Basic y Stripe indicó que el cambio se aplica el 2 de noviembre, sin cargo hoy.<br>• **Evento:** un solo `customer.subscription.updated` (`evt_1UVZfvPvaU0aOV2QkqCqDB4O`), procesado al primer intento a las 16:26:11Z, sin error y con `livemode=false`. No llegó ningún evento `subscription_schedule.*`.<br>• **Suscripción `5b00f522-…`:** sigue `active` y en Pro hasta el 02/11 a las 13:53:09Z, sin marcas de cancelación. El cambio programado no se guarda en la app; Stripe lo aplicaría al final del periodo con otro `customer.subscription.updated`.<br>• **Sin efectos secundarios:** siguen 4 suscripciones y una sola Pro en Staging; la oferta sigue `redeemed`; no hay retenciones abiertas ni eventos sin cerrar.<br>• **Derechos:** 50 GiB, presupuestos sí, importación no.<br>• **Logs:** el webhook hizo su flujo normal, con todas las llamadas en 200. Postgres no registra errores.<br>• **Para S9:** la suscripción tiene ahora un calendario de Stripe asociado. Al cancelarla de inmediato desde el panel, Stripe libera ese calendario. |
| S8 · C, sin oferta y 403 al pedir Pro | **PASS el 28/10 a las 16:56Z** para la protección de Checkout Pro sin oferta.<br>• **Prueba del propietario:** desde `d3-pendiente`, como Owner autenticado, `POST /api/billing/checkout-session` con `{"plan_code":"pro","billing_interval":"month"}` devolvió **HTTP 403**, `code: offer_required`, «This plan is only available with an offer». La ruta comprueba el Owner y la configuración de Stripe, y rechaza al validar la petición, antes de mirar el plan del tenant. Un tenant Basic recibe la misma respuesta.<br>• **Sin oferta disponible:** `list_tenant_billing_offers_v1` no devuelve ofertas para `d3-alta` ni `e2e` (los Basic), ni para `demo`, ni para `d3-pendiente`, cuya oferta ya está `redeemed`.<br>• **En el servidor, a las 16:55Z:** ningún intento de Checkout nuevo desde las 16:28Z (siguen 5); ningún evento ni suscripción cambiada desde las 16:27Z; 0 retenciones abiertas; 87 migraciones. Los 2 eventos `failed` que hay son del 19/10 (`internal_subscription_current`), de la retención ya `reconciled`.<br>• **Pendiente:** la prueba visual en un tenant Basic. Pasa al tenant que cree S10 (ver la incidencia siguiente). |
| Incidencia S8 · C: 404 en `demo` | `/settings/billing?tenant=demo` dio 404. **Diagnóstico en solo lectura, sin cambiar permisos ni datos.**<br>• **Causa: la sesión del navegador.** Las 13 consultas a `demo`, de 16:41:51Z a 16:44:54Z, las hizo el usuario de pruebas de `d3-pendiente` (`8f6abbc0-…`), en dos sesiones suyas, y no `tecnokaizen@gmail.com`. La RLS le devolvió 0 filas porque no es miembro de `demo`. Sin tenant no hay contexto, y la página responde `notFound()` sin llegar a consultar membresías.<br>• **Descartado:**<br>– la ruta: existe y funciona en `d3-pendiente`;<br>– el contexto Preview: la cookie de tenant apuntaba a `demo`, como se pidió;<br>– la membresía: con la identidad de `tecnokaizen@gmail.com` (`0c800299-…`), `demo` es visible y su membresía Owner está activa. Ese usuario no tiene actividad desde las 15:36Z.<br>• **Conclusión:** el aislamiento funcionó como debe. Un Owner de otro tenant no ve `demo`.<br>• **Para repetir en `demo`:** cerrar la sesión del usuario de pruebas, o todas las ventanas privadas, e iniciar sesión con `tecnokaizen@gmail.com`.<br>• **Prueba visual de Basic:** `demo` no es Basic (no tiene suscripción), y los Basic `d3-alta` y `e2e` solo tienen Owners sintéticos. Se hace en el tenant de S10. |
| Limitación de Staging: direcciones de vuelta | En Preview, las direcciones de vuelta de Stripe solo usan orígenes de confianza (`lib/tenant/trusted-origin.ts`): `https://app.gestcopy.com` para el onboarding y `https://{slug}.app.gestcopy.com` para Facturación y el portal. Es así por diseño; solo el desarrollo local usa orígenes locales.<br>• **Efecto:** después de pagar o cancelar en Checkout, o al salir del portal, el navegador acaba en un dominio de Production. Ahí no se inicia sesión ni se hace nada: se vuelve a mano a la URL de Preview.<br>• **Sin efecto en los datos:** la activación la hace el webhook de Staging. La página de éxito solo lee el estado; `/api/onboarding/status` no activa nada.<br>• No bloquea el E2E. En Live es el comportamiento correcto. |
| S10 | **Reanudado con autorización del propietario el 28/10 a las ~17:20Z**, con la incidencia del alta pública abierta y el alta pública marcada FAIL. Se había detenido en el paso 2 a las ~17:12Z.<br>**Condiciones:**<br>• usar `tecnokaizen+s10@gmail.com` (`6303e298-…`), sin crear otros usuarios ni tocar el Owner de `demo`;<br>• login, onboarding de `s10-onboarding-1028` y Basic, solo en Stripe Test;<br>• no corregir ni desplegar el callback durante el E2E sin coordinación;<br>• no tocar Production ni Stripe Live;<br>• no ejecutar S9 ni liberar Staging para post-its.<br>**Partida, a las 17:20Z:** el usuario sigue confirmado, sin sesión, perfil ni membresías; el slug está libre; 7 tenants, 5 intentos de Checkout, 9 suscripciones, 0 eventos nuevos, 0 retenciones y 87 migraciones. Guion a las 16:56Z (abajo). |
| Incidencia S10: confirmación del alta pública | **FAIL del flujo público de confirmación. Abierta y bloqueante para el lanzamiento comercial y Stripe Live**, por decisión del propietario del 28/10. Auditoría en solo lectura a las 17:14Z, sin borrar usuarios ni cambiar membresías o contraseñas.<br>**Usuarios:**<br>• `tecnokaizen@gmail.com` (`0c800299-…`): existe desde el 14/10, confirmado, con perfil y Owner activo de `demo`. **Sin cambios:** `updated_at` sigue a las 15:36:13Z y su última sesión es de las 15:24Z.<br>• `tecnokaizen+s10@gmail.com` (`6303e298-…`): **creado en S10** por el formulario público a las 17:06:56Z. **Confirmado** a las 17:10:04Z por el enlace del correo. Sin perfil, sin membresías y sin sesiones; nunca ha iniciado sesión.<br>• Hay 10 usuarios de Auth: los 9 de partida más el de S10. No hay ningún duplicado.<br>**Qué pasó, según los logs de Auth:**<br>1. 17:06:56Z: alta de `+s10`. Supabase envió la confirmación con su SMTP por defecto (`noreply@mail.app.supabase.io`). La dirección de vuelta aceptada fue `…vercel.app/auth/confirm?next=%2Fonboarding`.<br>2. 17:09:41Z: otra alta, con `tecnokaizen@gmail.com`. Supabase la registró como `user_repeated_signup`: no creó ningún usuario, no envió correo y no tocó el existente.<br>3. 17:10:04Z: primer clic en el enlace. `GET /auth/v1/verify` confirmó el correo (`user_signedup`) y redirigió (303) a `/auth/confirm`.<br>4. 17:10:28Z: segundo clic en el mismo enlace. «One-time token not found» (403, enlace ya usado), y redirección a la misma página.<br>**Causa:**<br>• El correo usa el enlace por defecto de Supabase, que pasa por su `/auth/v1/verify`. Supabase confirma ahí y vuelve a la app.<br>• El cliente del navegador (`createBrowserClient` de `@supabase/ssr`) usa PKCE, así que Supabase vuelve con un `code`.<br>• `app/auth/confirm/route.ts` solo acepta `token_hash` y `type` (para `verifyOtp`). No canjea `code` en ningún sitio de la app, así que muestra «No token hash or type» y no crea la sesión.<br>• Es decir: la confirmación sí se hizo en Supabase; lo que falla es la vuelta a la app. La ruta espera una plantilla de correo con `token_hash`, y la de Staging no la tiene. El repositorio no define esa plantilla, y en local las confirmaciones están desactivadas.<br>**Alcance:** el mismo código está en Production. Hay que comprobar la plantilla «Confirm signup» de Production antes de abrir el alta comercial. No se ha consultado Production.<br>**Corrección, según el propietario:**<br>• Va aparte del E2E, preferentemente en el callback. `/auth/confirm` debe aceptar `code` (PKCE, con `exchangeCodeForSession`) además de `token_hash` y `type`, y tratar los errores que devuelve Supabase.<br>• Con pruebas de regresión para los dos caminos.<br>• No se corrige ni se despliega durante este E2E sin coordinación.<br>• La plantilla con `token_hash` queda como alternativa, por entorno.<br>**Para cerrarla:**<br>• corrección revisada y con la CI en verde;<br>• despliegue coordinado en Staging;<br>• repetir el registro completo con un usuario nuevo autorizado en Staging. |
| S9 | Pendiente. No se ejecuta ni se libera Staging para la sesión de post-its hasta que el propietario lo indique. |

#### Guion de S10: onboarding de pago (preparado el 28/10)

**Qué prueba:** alta de un usuario nuevo, creación de la organización, Checkout Basic de Test, activación por webhook, Owner, membresía, configuración inicial, derechos de Basic y aislamiento entre tenants. También la prueba visual de Basic pendiente de S8 · C.

**Cómo funciona en Staging** (código y funciones revisados en solo lectura):
- `/onboarding` solo se abre en el dominio de la app, sin tenant elegido y con sesión iniciada. Si el navegador tiene la cookie de tenant de Preview, redirige a `/`.
- `create_organization` crea en una sola llamada el perfil, el tenant en `pending_billing` e inactivo, la membresía Owner, `tenant_settings`, los estados de pedido y de presupuesto, los tipos de cliente, los canales de entrada y la tienda.
- Después abre Checkout de Basic mensual (39 €). Si se vuelve a `/onboarding` con un tenant pendiente de pago, la página lo muestra con un botón para reanudar el pago: abre un Checkout nuevo para el mismo tenant, sin crear otra organización.
- El tenant se activa solo con el webhook. La página de éxito solo consulta.

**Partida, a las 16:55Z:** 7 tenants, 9 usuarios de Auth, 9 suscripciones, 5 intentos de Checkout y 87 migraciones. Ningún tenant ni usuario `s10`.

**Propietario:**
1. **Navegador limpio.** Cerrar todas las ventanas privadas y abrir una nueva. Así no quedan la sesión del usuario de pruebas de `d3-pendiente` ni la cookie de tenant.
2. **Alta del usuario.** Abrir `https://copyflow-git-gestcopy-staging-tecnokaizen.vercel.app/auth/sign-up` y registrarse con un alias nuevo, por ejemplo `tecnokaizen+s10@gmail.com`, y una contraseña que no se comparte.
   - Si llega el correo de confirmación y el enlace apunta a `copyflow-git-gestcopy-staging-…vercel.app`, abrirlo.
   - Si el formulario da error, el correo no llega en 5 minutos (el SMTP de Auth de Staging no está verificado) o el enlace apunta a un dominio `gestcopy.com`, no abrirlo. En su lugar, usar el script local de Staging con **otro** alias, por ejemplo `tecnokaizen+s10b@gmail.com` y `--note s10-onboarding`. Crea el usuario ya confirmado, pide la contraseña sin mostrarla y no crea perfil ni membresía: eso lo hace el onboarding.
   - Anotar qué camino se usó.
   - **Resultado del 28/10:** el alta pública creó y confirmó `tecnokaizen+s10@gmail.com`, pero la vuelta a la app falla («No token hash or type»). Ver «Incidencia S10». El propietario pidió no crear más usuarios, así que no se usa el script.
3. **Iniciar sesión** en `…vercel.app/auth/login?next=/onboarding` con el usuario nuevo.
4. **Crear la organización:** nombre `S10 Onboarding E2E` y slug `s10-onboarding-1028`. Al continuar se abre Checkout de Stripe Test: Basic, 39 €/mes. Pagar con 4242 4242 4242 4242, una fecha futura y cualquier CVC.
   - Si se cancela en Checkout, Stripe lleva a Production. Volver a `…vercel.app/onboarding` y pulsar el botón para reanudar el pago del mismo tenant.
5. **Después de pagar,** Stripe lleva a `https://app.gestcopy.com/onboarding/success?session_id=…`, que es Production. No iniciar sesión ahí: cerrar esa pestaña.
   - Opcional: abrir la misma dirección en Preview, cambiando solo el dominio, para ver el estado de la activación. Si después redirige a `s10-onboarding-1028.app.gestcopy.com`, cerrar esa pestaña sin iniciar sesión.
6. **Prueba visual de Basic:** abrir `…vercel.app/settings/billing?tenant=s10-onboarding-1028`. Debe mostrar Basic activo y ninguna oferta Pro. Desde la consola del navegador, la misma petición Pro de S8 · C debe devolver 403 `offer_required`.
7. **Aislamiento visible (opcional):** con el mismo usuario, `…vercel.app/settings/billing?tenant=demo` debe dar 404. Después, volver con `?tenant=s10-onboarding-1028`.
8. Avisar a Claude con la hora aproximada del pago y el camino del paso 2.

**Claude comprueba (solo lectura):**
- el usuario está confirmado y tiene perfil;
- el tenant `s10-onboarding-1028` pasa de `pending_billing` e inactivo a `ready` y activo;
- una sola membresía, Owner y activa, y es la única del usuario;
- la configuración inicial: `tenant_settings`, estados de pedido y de presupuesto, tipos de cliente, canales de entrada y tienda;
- el intento de Checkout de onboarding `completed`, una sola suscripción Stripe Basic de Test `active`, y los eventos procesados al primer intento, sin error y con `livemode=false`;
- los derechos: 5 GiB, presupuestos sí, importación no (retenida);
- el aislamiento en los dos sentidos: el Owner nuevo solo ve su tenant y 0 filas ajenas, y el usuario de pruebas de `d3-pendiente` no ve el tenant nuevo;
- sin efectos secundarios: ninguna retención nueva, sigue una sola Pro (`d3-pendiente`), la oferta sigue `redeemed`, 87 migraciones y logs sin errores.

**Límites:** solo Staging y Stripe Test. No se toca Production ni Stripe Live, y en los dominios de Production no se inicia sesión. El tenant, el usuario y la suscripción de Test de S10 se quedan como evidencia; su limpieza se decide con S9. Si algo falla, se para, se documenta y se avisa.

**Cómo se aplicó S2:**
- Enlace de la CLI: `fmmfsbhcwxkaszrrarpw` (Staging); Production es `wsclqvlzjdgwkxbolhoy` y no se ha tocado.
- Carpeta de push con exactamente las migraciones de 9cc52b1 (`git archive`).
- `db push --dry-run --linked`: lista **solo** `20261028090000_commercial_plans_pro_offers_v1.sql`.
- Después, `db push --linked`. La CLI crea un rol temporal `cli_login_postgres`, válido unos 5 minutos.

**Postcheck de S2 (solo lectura):**
- 87 migraciones; la última, `20261028090000`.
- Planes `basic`, `mvp` y `pro` (`30000000-0000-4000-8000-000000000003`).
- Basic: `quotes` y `clients_import`, con 5 GiB. Pro: el mismo conjunto, con 50 GiB.
- `feature_rollouts`: `clients_import:held`.
- Las 6 funciones son SECURITY DEFINER, con `search_path` vacío y solo para `service_role`. `tenant_has_feature` conserva sus permisos.
- Las 2 tablas tienen RLS. 0 ofertas y 0 suscripciones Pro.

**Efecto por tenant (R7):**
- Importación: solo e2e y e2e-import, por su concesión individual. Igual que antes.
- Presupuestos: d3-alta los gana por plan. demo y e2e ya los tenían por concesión.

**Incidencia: no había copia previa.**
- La condición del propietario pedía una copia o una recuperación válida y reciente **antes** de aplicar. Llegó con el push ya en marcha y no se cumplió.
- Comprobado después: Supabase no lista copias de Staging (`backups: []`, PITR desactivado) y el sistema de copias B2 cubre solo Production.
- Mitigación disponible:
  - la migración no toca datos de tenants ni de pedidos. Solo añade el plan `pro`, los derechos de Basic (`quotes` y `clients_import`) y de Pro, dos tablas nuevas y funciones, y redefine `tenant_has_feature`;
  - el rollback (`supabase/rollbacks/20261028090000_…`) quita esos derechos de Basic, retira `pro`, restaura el resolvedor anterior y elimina las funciones. Hoy se puede usar: no hay suscripciones Pro.

### Production y Stripe Live (no autorizados)

**Requisitos:** F12 cerrado, copia v2 de menos de 2 h, E2E correcto, la incidencia S10 del alta pública cerrada (es bloqueante) y una autorización por operación.

| Paso | Qué |
| --- | --- |
| L0 | Merge de #158, con el orden fijado por la sesión de release, y despliegue |
| L1 | Aplicar `20261028090000` (dry-run, después push). Postcheck: una migración más (hoy 86, la última `20261022130000`), plan `pro`, `plan_features` y `clients_import` `held`. **SUR4 sin importación.** |
| L2 | `bootstrap-stripe-catalog.ts --plan pro --inspect`, después `--create --confirm-live` |
| L3 | Confirmar la configuración del portal por defecto sin cambio de plan. Después `tenant-billing-offer.ts portal` y `--confirm-live`, y `STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE` en Vercel Production con redespliegue. **Obligatorio antes de L7.** |
| L4 | `tenant-billing-offer.ts coupon --coupon-id gestcopy-sur4-pro-39 --redeem-by 2026-11-02T13:53:09Z --name "Gestcopy Pro · oferta SUR4"`, después `--confirm-live` |
| L5 | SQL de servicio: `set_internal_billing_activation_v1('<id SUR4>', 'ready_for_checkout', '<motivo>', '<propietario>')` |
| L6 | `tenant-billing-offer.ts grant --tenant sur4 --coupon-id gestcopy-sur4-pro-39 --anchor 2026-11-02T13:53:09Z --promo-ends-before 2027-01-02T13:53:09Z --redeem-by 2026-11-02T13:53:09Z --terms-version sur4-pro-39-v1 --reason "Oferta comercial SUR4 aprobada por el propietario el 27-28/10/2026" --authorized-by <propietario>`. Revisar `preview` (`usable_now`, `contract_deadline`, `terms`) y repetir con `--confirm-live`. |
| L7 | El Owner de SUR4 acepta y paga **antes del 02/11 a las 14:08 (hora de Madrid)**. Lo ideal, antes del 01/11. |
| L8 | Verificación de solo lectura, igual que S7, en Live |
| L9 | Recordatorio a SUR4 entre el 01/12 y el 15/12 (sección 3) |

### Vuelta atrás

**Antes de que SUR4 pague:**
- `tenant-billing-offer.ts revoke`;
- `set_internal_billing_activation_v1(…, 'deferred_until_go_live', …)`;
- invalidar el cupón en el panel de Stripe.

**Migración:** el archivo de rollback. Se niega si hay suscripciones Pro.

**Después de que SUR4 pague:** el propietario cancela o reembolsa en Stripe y el webhook sincroniza. Los datos del tenant no se tocan.
