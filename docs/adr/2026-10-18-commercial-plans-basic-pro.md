# ADR — Gestcopy Basic y Pro: modelo comercial de planes

Fecha: 18 de octubre de 2026. Estado: **propuesto; pendiente de decisión del propietario** (C0 del sprint comercial, objetivo 21/10/2026).

Base: `main` `410228e`. Frente C del sprint comercial hasta el 02/11/2026.
ADR relacionados: [Pro · Acceso anticipado V1](2026-10-15-pro-early-access-v1.md) y [Migration V1: importación de clientes](2026-10-16-clients-import-v1.md).

Este documento no decide precios ni prestaciones: describe el estado verificado, fija las reglas técnicas que
cualquier opción debe cumplir y deja las decisiones del propietario en la [última sección](#decisiones-del-propietario),
con opciones cerradas. No incluye migraciones ni cambios de código, y no toca Stripe ni Supabase.

## Contexto y objetivo

Gestcopy quiere vender dos planes antes de cerrar la situación comercial de SUR4 (primer piloto):

- **Basic**, que se mantiene a **39 €/mes**;
- **Pro**, que hoy no existe: no hay plan, precio, checkout ni comparativa.

Además, presupuestos (`quotes`), importación de clientes (`clients_import`) y asistencia IA (`ai_voice_orders`) solo
existen como concesiones manuales por tenant. Ningún plan da derecho a ellas. El objetivo es darles un derecho comercial
explícito **reutilizando el catálogo actual**, sin crear un segundo sistema de permisos, y mantener las concesiones
temporales de SUR4 independientes de su suscripción.

## 1. Estado actual verificado en `main`

### 1.1 Catálogo

| Tabla | Qué guarda | Notas |
| --- | --- | --- |
| `features` | Catálogo global de códigos | `code` único. IDs fijos `31000000-0000-4000-8000-0000000000NN` |
| `plans` | Planes comerciales | `code` único; `price_monthly`, `price_yearly`, `currency`, `active`, `sort_order`, `metadata` |
| `plan_features` | Derechos de cada plan | PK `(plan_id, feature_id)`; `enabled`; `limit_value bigint` (nulo o ≥ 0) |
| `tenant_feature_overrides` | Concesión explícita por tenant | PK `(tenant_id, feature_id)`; `enabled`; `limit_value`. Sin motivo, caducidad ni historial (los añade A1). Solo se escribe con `set_tenant_feature` (`service_role` o dueño de la BD) |
| `subscriptions` | Historial de suscripciones | `status` ∈ `trialing, active, past_due, canceled, unpaid, incomplete, paused`; `provider` (`internal` o `stripe`); `livemode`. Índice único parcial `subscriptions_one_current_per_tenant_idx`: como mucho una fila `trialing/active/past_due` por tenant |
| `billing_prices` | Plan ↔ Price de Stripe | Un precio activo por `(plan, provider, intervalo, livemode)`. Admite `month` y `year` |

**Códigos de `features`:**

| ID | Código | Uso hoy |
| --- | --- | --- |
| `…001`–`…004` | `core_orders`, `core_clients`, `core_team`, `activity_log` | En los planes, pero **ninguna ruta ni RPC los comprueba** |
| `…005` | `storage_bytes` | Cuota comercial en bytes (`limit_value`) |
| `…006` | `quotes` | Presupuestos: RLS, RPC, guardas de rutas y `/api/context` |
| `…007` | — | Sin usar. Lo reservaba `voice_orders` en #90; B1 pasa #90 a `ai_voice_orders` |
| `…008` | `pro_early_access` | Programa de acceso anticipado (ADR 15/10). Solo por override |
| `…009` | `ai_voice_orders` | Reservado para «Gestcopy AI — Pedidos por voz». Presentado siempre como «En preparación» |
| `…010` | `clients_import` | Importación de clientes. Solo por override |

**Presupuestos V2.1** (en diseño) añade `quote_quantity_options`, también por override.

**Planes:**

| Plan | ID | Precio | Derechos (`plan_features`) |
| --- | --- | --- | --- |
| `mvp` | `30000000-0000-4000-8000-000000000001` | 0 € | `core_orders`, `core_clients`, `core_team` y `activity_log`, sin cuota. Legado y demostración |
| `basic` | aleatorio (`gen_random_uuid`): siempre por código | 39,00 €/mes | `core_orders`, `core_clients`, `core_team` y `activity_log`, más `storage_bytes` = 5 GiB (5.368.709.120 B) |

Ningún plan incluye `quotes`, `clients_import`, `ai_voice_orders` ni `pro_early_access`.

**Precios en Production.** Según la auditoría de SUR4 (17/10, solo lectura), solo existe el precio mensual de Basic: 3.900 céntimos en Test y en Live.

### 1.2 Resolución de derechos

**`tenant_has_feature(tenant, code)`** se define en `supabase/migrations/20260923190000_quotes_v1.sql:40`.

1. Con `authenticated`, devuelve `false` si el usuario no tiene una membership activa en el tenant.
2. Si existe un override para el tenant, devuelve su `enabled`, en ambos sentidos.
3. Si no, usa `plan_features.enabled` de la suscripción más reciente con estado **`active` o `trialing`** (línea 97).
4. Si no hay ninguna de las dos cosas, devuelve `false`.

Limitaciones:

- **Ignora `limit_value`:** solo devuelve un booleano.
- **Ignora `subscriptions.livemode`.** El propio comentario de la función avisa: «Do not use this resolver for Stripe-sensitive features until that mode is part of the rule» (línea 88).

Quién lo usa:

- en la app, `lib/quotes/guard.ts`, `app/quotes/layout.tsx`, `lib/imports/clients/http.ts`, `app/api/dashboard/route.ts`, `app/api/context/route.ts` y `lib/features/early-access-server.ts`;
- en SQL, las RPC y la RLS de presupuestos y sus archivos, las operaciones comerciales e `imports_private.assert_import_access`, que comprueban todas las RPC de importación, incluida la reversión.

**`resolve_tenant_storage_limit_bytes(tenant)`** se define en `supabase/migrations/20260921181000_tenant_file_limits_and_storage_quota_v1.sql:19`.

- Usa la suscripción más reciente con estado **`trialing`, `active` o `past_due`** (línea 45) y `storage_bytes` habilitado.
- **Ignora los overrides.**
- `NULL` significa que la cuota no se aplica: sin límite. `0` significa cero bytes.
- Solo pueden ejecutarlo `postgres` y `service_role`.
- Lo usan las subidas de archivos de pedido y de presupuesto, Ajustes → Archivos y `/api/billing/subscription`.

**Consecuencias de las reglas actuales:**

| Estado de la suscripción | `tenant_has_feature` (plan) | Cuota de almacenamiento |
| --- | --- | --- |
| `trialing`, `active` | Sí | Límite del plan |
| `past_due` | **No** | Límite del plan |
| `canceled`, `unpaid`, `incomplete`, `paused` o sin fila | No | `NULL` = **sin límite** (defecto pendiente de D2) |

Hoy la diferencia en `past_due` **no tiene efecto práctico**: el plan solo aporta códigos que nadie comprueba. En
cuanto Pro ponga `quotes`, `clients_import` o `ai_voice_orders` en un plan, un tenant Pro con un pago fallido perdería
sus presupuestos al instante (ocultos por RLS), pero conservaría su cuota.

### 1.3 Basic fijado en el código

| Lugar | Qué fija |
| --- | --- |
| `lib/billing/access.ts:14` | `BILLING_PLAN_CODES = ["basic"]`; `isBillingPlanCode` compara con el literal `"basic"` (línea 21); `BASIC_STORAGE_BYTES` (línea 31) |
| `lib/billing/checkout-parse.ts:29` | Rechaza cualquier `plan_code` que no sea `basic`. `lib/billing/billing.test.ts:385` exige que `pro` se rechace |
| `app/api/onboarding/route.ts:134` | El alta de pago siempre usa `planCode: "basic"` |
| `components/onboarding/onboarding-form.tsx:250, 266, 295` | Textos «Gestcopy Basic (39 €/mes)» |
| `components/settings/billing-settings.tsx:104, 253` | Envía `plan_code: "basic"`; botón «Contratar Gestcopy Basic» |
| `components/settings/billing-success-status.tsx:76` | «Tu suscripción Gestcopy Basic ya está sincronizada» |
| `scripts/billing/bootstrap-stripe-catalog.ts:84, 138–161` | Busca el plan `basic` y crea el Product «Gestcopy Basic» y un Price de 3.900 céntimos |
| `lib/help/catalog.ts:385` | Palabra clave de ayuda «gestcopy basic». En `lib/help/changelog.ts:452` es una entrada histórica: no se cambia |

**Ya son genéricos (no hay que cambiarlos para Pro):**

- `resolveStripePrice`, que busca por `planCode` en `billing_prices`;
- `resolvePlanFromStripePriceId`, que resuelve el plan por Price ID y no se fía de los metadatos;
- el webhook, que toma el Price del primer item (`lib/billing/webhook.ts:58`);
- `sync_billing_subscription_v1`, que actualiza `plan_id` sobre la misma `provider_subscription_id`;
- `/api/billing/subscription`, que lee el nombre y el precio del plan de la BD.

**Restricciones para cambiar de plan:**

- `prepare_billing_checkout_attempt_v2` rechaza el checkout si el tenant ya tiene una suscripción Stripe vigente en ese modo (`current_subscription_exists`, `20260922160000_stripe_live_hardening_v1.sql:290`).
- Desde #132, la ruta también lo rechaza con una suscripción interna vigente.
- Por tanto, **pasar de Basic a Pro no puede ser un segundo checkout**: tiene que ser un cambio de precio de la misma suscripción.
- El Portal se abre sin `configuration` (`lib/billing/checkout.ts:263`). Que permita cambiar de plan depende de la configuración del Dashboard de Stripe, que no está en el repositorio.

### 1.4 Pruebas que fijan las reglas actuales

Cualquier cambio en estas pruebas debe ser intencionado y figurar en la PR:

| Prueba | Qué exige | Cuándo cambia |
| --- | --- | --- |
| `supabase/tests/phase33_quotes_v1.sql:57–66` | `quotes` no está en `mvp` ni en `basic` | Solo si Basic incluye presupuestos |
| `supabase/tests/phase47_pro_early_access.sql:95–101` | Ningún plan tiene `pro_early_access` ni `ai_voice_orders` | Si Pro incluye IA: se divide la aserción (el programa, nunca; la IA, solo en `pro`) |
| `supabase/tests/phase47_pro_early_access.sql:173–177` | Control: el plan concede `core_orders` solo en `active/trialing` | Si se unifican las reglas de estado (§3, R3) |
| `supabase/tests/phase23_billing_foundation.sql:47–49` | Existe exactamente un plan `basic` | No cambia |
| `lib/billing/billing.test.ts:385` | `parseCheckoutRequest` rechaza `pro` | En C2 |
| `lib/features/early-access-guards.test.ts:72–77` | **Solo una migración** contiene la cadena `pro_early_access`, también en comentarios | Nunca. C1 no puede nombrarla (ver R2) |

### 1.5 SUR4

Fuente: Production, consultada solo con SELECT el 17 y 18/10. Detalle en las notas del sprint.

- **Suscripción:** Basic, `provider = internal`, `trialing` hasta el **02/11/2026 a las 13:53:09 UTC** (14:53 en Madrid), `livemode = false`. No existe en Stripe y nada la corta automáticamente.
- **Overrides:**
  - `quotes = true`, desde el 23/09;
  - `clients_import`: ninguno (A3 prevé concederlo con `review_at` el 02/11 a las 13:53 UTC);
  - `pro_early_access`: ninguno.
- **Uso:**
  - 83 clientes, 27 presupuestos y unos 84 pedidos;
  - unos 1,02 GiB de 5 GiB;
  - 7 miembros activos.

## 2. Propuesta comercial (opciones, sin decidir)

### 2.1 Basic

Basic **se mantiene en 39 €/mes** con lo que incluye hoy: pedidos, clientes, equipo, actividad y 5 GiB. Quedan abiertas
dos preguntas:

| Prestación | Opción | Efecto |
| --- | --- | --- |
| **Presupuestos** (`quotes`) | **BQ-1.** No incluidos: exclusivos de Pro | Primera razón para pasar a Pro. SUR4 tendría que contratar Pro o mantener una excepción documentada (§3, R6) |
| | **BQ-2.** Incluidos en Basic | Pro se diferencia solo por la importación, la IA y el almacenamiento. SUR4 queda cubierta por el plan, y su override pasa a ser redundante |
| **Importación de clientes** (`clients_import`) | **BI-1.** Incluida sin límite comercial (solo el técnico: 10.000 filas por lote) | La importación reduce el coste de cambio para captar copisterías; no se cobra por ella |
| | **BI-2.** Incluida con un límite de filas (§2.3) | Necesita el resolver de límites y textos de «mejora a Pro» |
| | **BI-3.** No incluida: exclusiva de Pro | Una copistería que viene de otro programa tendría que contratar Pro para migrar |

**Atención.** Si se añade algo a Basic, se activa en el mismo momento para **todos** los tenants con una suscripción Basic vigente, SUR4 incluida:

- con BQ-2 no cambia nada para SUR4, que ya tiene presupuestos por override;
- con BI-1 o BI-2, SUR4 tendría la importación **sin pasar por la activación controlada de A3**.

El preflight de C1 debe listar qué tenants cambian.

### 2.2 Alternativas para Pro

Pro incluye siempre todo lo de Basic. Las tres alternativas son paquetes completos. Los precios son propuestas para que
el propietario elija o fije otro, con el mismo criterio fiscal que Basic.

| | **P1 · Pro esencial** | **P2 · Pro completo** | **P3 · Pro en dos tiempos** |
| --- | --- | --- | --- |
| Precio mensual | **59 €** | **79 €** | **59 €** al lanzar, **79 €** cuando la IA esté disponible |
| Presupuestos | Sí | Sí | Sí |
| Importación de clientes | Sí, sin límite comercial | Sí, sin límite comercial | Sí, sin límite comercial |
| Asistencia IA (`ai_voice_orders`) | No incluida en el lanzamiento; se decide más adelante | Incluida como derecho. Se muestra «En preparación» hasta que B supere sus gates | No en el lanzamiento; se incluye al subir el precio |
| Almacenamiento | 20 GiB | 50 GiB | 20 GiB y después 50 GiB |
| Presupuestos con opciones (V2.1, cuando exista) | Incluido | Incluido | Incluido |
| Ventaja | Se puede vender ya, sin depender de la IA | Precio estable, sin una segunda subida | Precio de entrada bajo y valor añadido después |
| Riesgo | La IA necesita después su propia decisión de precio | Se cobra por una IA que aún no está disponible: hace falta una comunicación muy clara | Gestionar dos Prices en Stripe y decidir si los primeros clientes conservan 59 € |

**Notas para decidir:**

- **El almacenamiento no es el coste relevante.** R2 cuesta del orden de 0,015 USD por GB al mes según su tarifa pública (verificar antes de publicar): 50 GiB cuestan menos de 1 € al mes. El límite es una forma de diferenciar, no de cubrir costes.
- **La IA es el único coste variable real.** Su control está en el presupuesto técnico de #90 (`ai_usage_limits`: interruptor de plataforma y límites por tenant y por usuario), no en el plan (ver R4).
- **No se proponen add-ons** (IA como suplemento aparte). Exigirían una segunda línea en la suscripción, y el webhook solo lee el primer item. Sería otro cambio de facturación.
- **Precio anual.** `billing_prices` admite `year`, pero la app solo acepta `month` (`BILLING_INTERVALS`). Se propone solo mensual en el lanzamiento; ver la decisión D9.

### 2.3 Límite de importación (solo con BI-2 o si Pro lo tuviera)

Si se limita, el valor va en `plan_features.limit_value` de `clients_import`. El override del tenant lo puede sustituir.
Hay dos formas de medirlo:

| Unidad | Cómo se aplica | Valoración |
| --- | --- | --- |
| **Filas por lote** | En `client_import_stage_rows`, junto al límite técnico de 10.000 | Sencillo, pero se elude dividiendo el archivo |
| **Clientes creados por importación en total, por tenant** | Suma de los contadores de los lotes confirmados y no revertidos. Los resúmenes se conservan indefinidamente | Tiene sentido comercial; algo más de SQL |

**Recomendación técnica:** no poner límite comercial (BI-1). Si se pone, contar el total por tenant. Ejemplo para Basic: 500 clientes importados.

## 3. Reglas (obligatorias para C1 y C2, sea cual sea la opción)

### R1. Un solo sistema de derechos

**Fuente de verdad:**

- `features` + `plan_features` + `tenant_feature_overrides`;
- resueltos por `tenant_has_feature`;
- y, para límites, por un resolver con la misma precedencia (override > plan).

**Qué no se crea:**

- ni tablas de derechos nuevas;
- ni `if (plan === "pro")` en la app, ni comprobaciones por código de plan fuera de facturación;
- ni variables de entorno por cliente.

**Comprobaciones:**

- La app y la BD comprueban **prestaciones**, no planes.
- El código de plan solo aparece en facturación: checkout, Portal, comparativa y webhook.
- La comparativa de la interfaz se genera a partir de `plans` y `plan_features`, sin listas copiadas a mano.

### R2. `pro_early_access` nunca está en un plan

- El programa es una concesión por tenant, independiente de la suscripción (ADR del 15/10). Pro de pago **no es** el programa: contratar Pro no concede la etiqueta «Pro · Acceso anticipado», y el programa no concede Pro.
- **La migración C1 no puede contener la cadena `pro_early_access`, ni en comentarios:** `early-access-guards.test.ts` exige que solo la migración `20261015200000` la nombre.
- Si C1 necesita una guarda que lo compruebe:
  - irá en su suite SQL de `supabase/tests/`, que no está sujeta a esa prueba;
  - o usará el ID fijo `31000000-0000-4000-8000-000000000008`.
- `phase47` mantiene la aserción de que ningún plan lo incluye.

### R3. Reglas de estado

Hay que elegir una opción (decisión D10):

| Opción | Prestaciones del plan | Cuota | Consecuencia |
| --- | --- | --- | --- |
| **S-A. Unificar con `past_due`** | `trialing`, `active`, `past_due` | Igual | Mientras Stripe reintenta el cobro, el cliente conserva presupuestos, importación e IA. El corte llega cuando Stripe marca `canceled` o `unpaid`. Requiere `create or replace` de `tenant_has_feature` y un cambio intencionado de `phase47:173–177` |
| **S-B. Mantener y documentar** | `trialing`, `active` | `trialing`, `active`, `past_due` | Sin cambio en BD. Un pago fallido oculta los presupuestos al instante pero conserva la cuota. Hay que explicarlo en la ayuda y en Facturación |
| ~~S-C. Unificar sin `past_due`~~ | `trialing`, `active` | Igual | Descartada: en `past_due` la cuota pasaría a `NULL`, es decir, sin límite |

**Recomendación técnica:** S-A, porque los datos no desaparecen por un fallo de cobro transitorio y la regla es una sola.

**Fuera de este ADR:**

- **Tenant cancelado sin cuota.** Que un tenant cancelado quede sin límite de almacenamiento (`NULL`) es un defecto de D2, que se decide allí.
- **`livemode` (decisión técnica T1).** El resolver no lo mira. Con prestaciones de pago en los planes, una suscripción Stripe **Test** vigente en la BD de Production concedería Pro.
  - Hoy no puede entrar ninguna: el webhook rechaza eventos de otro modo y la sincronización no mueve filas entre Test y Live.
  - Quedan filas históricas de Test del 21–22/09.
  - **Propuesta:** el preflight de C1 demuestra que en Production no hay ninguna fila `provider = 'stripe' and livemode = false` vigente, y el comentario del resolver se actualiza con esa justificación.
  - **Alternativa más fuerte:** un marcador de modo esperado por BD (`provider = 'internal' or livemode = esperado`). Exige un dato por entorno, porque Staging es Test y Production es Live.

### R4. Límites

- **Prestaciones booleanas** (`quotes`, `ai_voice_orders`): `limit_value` queda nulo.
- **`storage_bytes`:** sigue con su resolver actual.
- **Límite de importación, si se decide:** nuevo resolver `resolve_tenant_feature_limit(tenant, code)`.
  - Precedencia: el override habilitado y su `limit_value`; si no, el `limit_value` del plan vigente, con las mismas reglas de estado que R3.
  - `NULL` significa sin límite comercial y no anula los límites técnicos.
  - Las RPC de importación lo comprueban con un error propio (`clients_import_limit`).
  - Es un resolver de límites, no un segundo sistema de permisos.
- **IA:** el derecho comercial es el booleano del plan. El consumo lo limitan `ai_usage_limits` de #90, que nunca conceden acceso, solo lo restringen.
  - Si el propietario quiere publicar un número («N pedidos asistidos al mes»), se fija como límite por tenant en `ai_usage_limits` desde el operador.
  - Lo que se publique no puede superar lo que permite ese presupuesto técnico.
- **Almacenamiento con override (decisión D11).** Hoy no se puede dar más espacio a un piloto. Si se quiere, `resolve_tenant_storage_limit_bytes` pasaría a respetar `limit_value` del override.

### R5. Conciliación de los overrides de pilotos al pasar a un plan

**Por qué hace falta.** El override gana siempre, en los dos sentidos. Si `quotes = true` sigue después de contratar un
plan con presupuestos, no se nota mientras dure el plan. Pero **anula los cambios a la baja**: con un plan inferior o una
cancelación, el tenant conservaría los presupuestos.

**Propuesta** (decisión D12, opción **PC-A**):

1. **Cuándo.** Solo después de que la suscripción del plan esté vigente y verificada. Nunca antes ni de forma automática: ni en el webhook ni en un trigger. Es coherente con «sin revocación automática» de A1.
2. **Cómo.** Es una operación de operador con preflight, postcheck y vuelta atrás, como las de SUR4. Queda registrada con el motivo en la tabla de eventos de A1.
3. **Por cada override del tenant:**

| Override | Plan contratado | Acción |
| --- | --- | --- |
| `true` | Incluye la prestación con el mismo límite o mayor | **Retirar** (restaurar la ausencia de fila) con motivo «incluido en el plan X» |
| `true` | No la incluye | Mantener como **excepción documentada**, con motivo y `review_at` (decisión D13 para SUR4), o retirar si el piloto ha terminado |
| `false` | Cualquiera | Mantener solo si es un apagado intencionado y documentado; si no, retirar |
| `pro_early_access` | Cualquiera | No se concilia con el plan: es un programa (R2) |

4. **Dependencia.** Hoy no hay operación para **retirar** un override y volver a la ausencia: `set_tenant_feature` solo hace *upsert*, y la `set_tenant_feature_v2` prevista en A1 también. Hace falta `clear_tenant_feature_override(slug, code, reason)`, solo para `service_role` y con su evento. Debe ir en A1 si aún no se ha integrado, o en C1.

**Alternativa PC-B.** Mantener los overrides redundantes con un `review_at`. Es menos trabajo, pero los cambios a la baja no funcionan hasta que alguien los revise.

### R6. Las concesiones temporales de SUR4 no dependen de su suscripción

- Las concesiones de SUR4 son overrides con motivo y `review_at` (A1):
  - `quotes`;
  - `clients_import` (A3);
  - y, si llega, un piloto de IA.
- **Independencia en los dos sentidos:**
  - prorrogar, convertir o cancelar la fila interna (B″, C o D) no toca los overrides;
  - conceder o retirar un override no toca la suscripción.
- **Qué no hace C1:**
  - no concede ni retira nada a ningún tenant;
  - no menciona a SUR4.
- Las guardas actuales ya prohíben `"sur4"` y `slug ===` en la superficie Pro.
- **`review_at` es una fecha de revisión, no de corte.** Que `clients_import` venza el 02/11 a las 13:53 UTC, a la vez que la prueba, no revoca nada.
- **Paso a un plan:**
  - Cuando SUR4 pase a Basic o Pro (Stripe o contrato fuera de la app), se aplica R5 en una operación aparte y autorizada.
  - Si el plan no incluye algo que SUR4 ya usa (p. ej. Basic con BQ-1 y sus 27 presupuestos), el override queda como excepción documentada o SUR4 contrata Pro (decisión D13).
  - **Nunca se retira sin decisión expresa.**
- **SUR4 con contrato Pro fuera de la app (opción C del 02/11):**
  - la vía limpia es una fila `internal` en el plan `pro`, con el mismo patrón auditado que las prórrogas, cuando exista C1;
  - no se resuelve con overrides que imiten Pro.

### R7. Cambio a un plan inferior y cancelación: los datos se conservan

| Prestación que se pierde | Comportamiento actual | Regla |
| --- | --- | --- |
| Presupuestos | RLS y guarda los ocultan (404). No se borran | Se conservan y vuelven al reactivar. La interfaz avisa antes de bajar de plan |
| Almacenamiento por encima del nuevo límite | Se rechazan las subidas nuevas | No se borra nada. El aviso de cuota ya existe |
| Importación | `assert_import_access` bloquea también confirmar y revertir lotes abiertos | Bajar de plan solo sin lotes abiertos, o permitir revertir sin la prestación (decisión técnica T2) |
| IA | Según el diseño de B (borradores y registro de uso) | El registro de uso se conserva |

**Momento del cambio:**

- **Subir de plan:** inmediato, con prorrateo de Stripe.
- **Bajar de plan:** al final del periodo (decisión D14).

## 4. Plan de implementación posterior

**Orden de migraciones acordado:** #128 (`20261016130000`) → A1 → B1 (`20261018150000`, phase53) → **C1** → D1.

- C1 lleva un timestamp posterior a `20261018150000` y la siguiente suite SQL libre (phase55 o posterior: phase52 está en `main`, phase53 es de B1 y phase54 queda para A1).
- Si algo se adelanta, se renumera antes de aplicarla. Nunca se usa `--include-all`.

### C1 — Migración aditiva (después de C0 y B1)

1. **Plan `pro`:**
   - fila en `plans`: `code = 'pro'`, «Gestcopy Pro», `price_monthly` decidido, `EUR`, `active = true`, `sort_order = 20`;
   - ID fijo `30000000-0000-4000-8000-000000000003`, para que local, Staging y Production coincidan; Basic se sigue resolviendo por código.
2. **`plan_features` de `pro`:** `core_orders`, `core_clients`, `core_team` y `activity_log`, `storage_bytes` con el límite decidido, `quotes`, `clients_import` (con límite si se decide) y `ai_voice_orders` solo con P2 o P3 (y tras B1, que trae el interruptor de apagado).
3. **Basic:** las filas nuevas que decidan D1 y D2. `mvp` no cambia.
4. **Según las decisiones:**
   - `tenant_has_feature` con S-A;
   - `resolve_tenant_feature_limit` y su comprobación en la importación, si hay límite;
   - override de almacenamiento si D11 = sí;
   - `clear_tenant_feature_override` si no lo trae A1.
5. **Lo que C1 no hace:**
   - no menciona `pro_early_access` (R2);
   - no inserta overrides;
   - no toca `subscriptions` ni `billing_prices`.
6. **Pruebas:** nueva suite `phaseNN_commercial_plans.sql` en el Release Gate:
   - Pro resuelve sus prestaciones en los estados decididos y Basic no resuelve las exclusivas de Pro;
   - el override `true`/`false` gana sobre los dos planes;
   - una suscripción cancelada no da nada;
   - límites y aislamiento entre tenants;
   - ningún plan tiene el programa (por ID o en la suite).
   - Cambios intencionados en `phase33` (si BQ-2) y `phase47` (IA en Pro y regla de estado).
7. **Vuelta atrás:** `supabase/rollbacks/`. Retira las filas de `plan_features` añadidas y el plan `pro` solo si no lo referencian `subscriptions` ni `billing_prices` (ninguna de las dos FK borra en cascada).
8. **Gate:**
   - SQL desde cero y suites de `main` sobre la migración;
   - preflight de Production: lista de tenants afectados (§2.1) y comprobación de `livemode` (R3, T1);
   - después Staging y Production, cada uno con autorización.

### C2 — App (después de C1)

| Pieza | Cambio |
| --- | --- |
| `lib/billing/access.ts` | `BILLING_PLAN_CODES = ["basic", "pro"]`; `isBillingPlanCode` basado en la lista. La cuota se lee de la BD, sin constantes por plan |
| `lib/billing/checkout-parse.ts` y `billing.test.ts:385` | Acepta `pro`. Cambio intencionado de la prueba |
| Onboarding (`app/api/onboarding/route.ts`, `onboarding-form.tsx`) | Según D15: selector Basic/Pro, o alta solo en Basic y mejora desde Ajustes. Textos sin precios fijos en el código |
| Ajustes → Facturación (`billing-settings.tsx`, `billing-success-status.tsx`) | Comparativa generada desde `plans` y `plan_features`; botones «Contratar Basic» y «Contratar Pro»; cambio de plan según D14 (Portal con configuración explícita o ruta propia con `subscriptions.update`); nunca un segundo checkout |
| Webhook | Ya resuelve el plan por Price. Falta una prueba de `customer.subscription.updated` con cambio de Price que actualice `plan_id` |
| `scripts/billing/bootstrap-stripe-catalog.ts` | Parámetro `--plan basic\|pro`; importe tomado de `plans.price_monthly`, no de 3.900 fijo |
| Presupuestos, importación e IA | Estado «Disponible en Pro» para Basic en lugar de ocultarlo, si el propietario quiere mostrar la mejora. Si no, sin cambios |
| Ayuda | Entrada de planes y comparativa |
| `billing_prices` de Pro | No va en ninguna migración. Lo crea el script de catálogo: en Test cuando exista Stripe Test en Staging (D3) y en Live solo tras los gates de Live (#35) |

### Dependencias con el frente D y otros

| Depende de | Por qué |
| --- | --- |
| **D1** (protección del webhook para filas internas) | Antes de cualquier checkout de Pro en un tenant con fila interna vigente, como SUR4 |
| **D2** (bloqueo al volver a contratar y cuota de un tenant cancelado) | Bajar de plan, cancelar y volver a contratar usan las mismas rutas |
| **D3** (Stripe Test en Staging) | Para crear el Price Test de Pro y probar el cambio de plan |
| **D4** (E2E con Stripe Test) | Recorrido Basic → Pro → Basic después de C2 |
| **Live** (#35, cuenta, decisión fiscal, plan de Vercel) | Vender Pro desde la app. **Es poco probable antes del 02/11**: para SUR4, Pro solo es viable ese día por contrato fuera de la app (R6) |
| **A1** | Motivo y `review_at` de los overrides y la operación para retirarlos (R5) |
| **B** (G1, G2 legal #82, G5) | La IA en Pro es un derecho; su disponibilidad la decide B. Hasta entonces, «En preparación» |
| **E** (Presupuestos V2.1) | Si `quote_quantity_options` va con `quotes` en los dos planes o solo en Pro |

**Calendario orientativo:**

- C0, el 21/10;
- C1 y C2, en la semana del 26/10;
- Pro en Test, en Staging tras D3;
- Pro en Live, tras sus gates.

## 5. Alternativas descartadas

- **Un sistema de derechos nuevo** (tablas de *entitlements* o grants por plan) en paralelo a `plan_features`. Sería una segunda autoridad sin necesidad demostrada.
- **Vender Pro solo con overrides** («Pro» = un conjunto de overrides). No tiene precio, ni facturación, ni cambio de plan. Mezcla concesiones temporales con derechos contratados y rompe R5 y R6.
- **Pro como add-on de Basic** (segunda línea en la suscripción). El webhook y el modelo de una sola suscripción vigente no lo contemplan.
- **Poner `pro_early_access` en el plan Pro.** Lo prohíben el ADR del 15/10 y sus guardas.

## Decisiones del propietario

Cada decisión es cerrada: se elige una opción. «Recomendación técnica» es solo una ayuda; la decisión es del propietario.

### Comerciales

| # | Decisión | Opciones | Recomendación técnica | Bloquea |
| --- | --- | --- | --- | --- |
| D1 | ¿Basic incluye presupuestos? | BQ-1 no (solo Pro) · BQ-2 sí | — | C1, D13 |
| D2 | ¿Basic incluye la importación de clientes? | BI-1 sí, sin límite · BI-2 sí, con límite · BI-3 no | BI-1 | C1 |
| D3 | Paquete Pro | P1 Pro esencial · P2 Pro completo · P3 Pro en dos tiempos · otro | — | C1 |
| D4 | Precio mensual de Pro (mismo criterio fiscal que Basic) | 59 € · 79 € · otro: ___ € | — | C1, Stripe |
| D5 | Almacenamiento de Pro | 20 GiB · 50 GiB · 100 GiB | — | C1 |
| D6 | Límite de importación (solo con BI-2) y unidad | ___ clientes en total por tenant · ___ filas por lote | Total por tenant | C1 |
| D7 | IA en Pro | Incluida como derecho desde el lanzamiento («En preparación») · Incluida cuando B supere sus gates · Fuera de Pro por ahora | — | C1, comunicación |
| D8 | ¿Se publica un límite de uso de IA? | No («uso razonable», solo presupuesto técnico) · Sí: ___ al mes | No, hasta tener datos de coste | B, C2 |
| D9 | Precio anual | Solo mensual en el lanzamiento · Anual a ___ € | Solo mensual | C2 |
| D13 | SUR4 si su plan no incluye algo que ya usa | Contrata Pro · Basic con excepción documentada (override con motivo y `review_at`) · Basic, que lo incluye (BQ-2) | — | R5, R6 |
| D14 | Cambio de plan | Subir de plan inmediato con prorrateo y bajar al final del periodo · Todo al final del periodo. Vía: Portal de Stripe configurado · Ruta propia | Inmediato al subir y al final del periodo al bajar, por Portal | C2, D3 |
| D15 | Alta de nuevos clientes | Selector Basic/Pro en el onboarding · Alta solo Basic y mejora desde Ajustes | Selector, si Pro se vende a altas nuevas | C2 |
| D16 | Programa «Pro · Acceso anticipado» cuando exista Pro de pago | Se mantiene como beta para pilotos · Se retira · Se renombra (p. ej. «Acceso anticipado») para no confundirlo con el plan | Renombrar | C2 |
| D17 | ¿Las prestaciones de Pro se muestran a Basic como mejora? | Sí, «Disponible en Pro» · No, ocultas como hoy | — | C2 |

### De reglas (el propietario valida la propuesta técnica)

| # | Decisión | Opciones | Recomendación técnica | Bloquea |
| --- | --- | --- | --- | --- |
| D10 | Reglas de estado (R3) | S-A unificar con `past_due` · S-B mantener y documentar | S-A | C1 |
| D11 | ¿La cuota de almacenamiento admite override por tenant? | Sí · No | No por ahora | C1 |
| D12 | Conciliación de overrides de pilotos (R5) | PC-A retirar los redundantes tras verificar el plan · PC-B mantener con `review_at` | PC-A | A1/C1, SUR4 |
| T1 | `livemode` en el resolver (R3) | Preflight y comentario · Marcador de modo por BD | Preflight y comentario | C1 |
| T2 | Lotes de importación abiertos al bajar de plan (R7) | Bajar de plan solo sin lotes abiertos · Permitir revertir sin la prestación | Bajar solo sin lotes abiertos | C2 |

Con D1–D7, D10 y D12 respondidas, C1 puede empezar. El resto bloquea C2 o la operación de SUR4, no la migración.
