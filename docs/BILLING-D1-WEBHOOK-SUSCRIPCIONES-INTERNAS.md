# D1 · Webhook de Stripe frente a suscripciones internas vigentes

**Estado:** borrador para decisión del propietario (18/10/2026). Rama local
`claude/bold-gates-bfcfc6-d1-webhook-guard`, sin publicar.

## Problema

`sync_billing_subscription_v1` aplica la regla «una vigente»: cuando llega una
suscripción de Stripe vigente (`trialing`, `active`, `past_due`) cancela
**cualquier** otra fila vigente del tenant, también las internas (SUR4:
`internal`, `trialing`; demo: `internal`, `mvp`). #132 solo impide crear o
reutilizar sesiones de checkout nuevas. Siguen llegando al webhook:

1. sesiones abiertas antes de crear o reactivar una fila interna (vida de una
   sesión: 23 h 30 min + 2 min);
2. suscripciones creadas en Stripe fuera de la app (Dashboard o API) con
   `metadata.tenant_id`;
3. la carrera entre la guarda de #132 (sin lock) y `prepare`.

## Opciones

| | A. Rechazar | B. Retener con aviso | C. Reconvertir solo si `ready_for_checkout` |
| --- | --- | --- | --- |
| Fila interna | Intacta | Intacta | Se cancela como `converted_to_stripe` solo si un operador la marcó; si no, B |
| Suscripción de Stripe en local | No se registra | No se registra; el evento queda guardado | Se registra como vigente |
| Webhook | A1: 500, Stripe reintenta. A2: 200, final | 200, `failed` sin reintento (`internal_subscription_current`) y aviso en el log | Normal |
| Stripe | El cliente ya pagó; la suscripción sigue activa y renovándose | Igual que A2 | Correcto |
| Recuperación | A1: se arregla sola si se cierra la fila interna antes de que acaben los reintentos (hasta 3 días en Live). A2: sin camino | Cerrar la fila interna → `requeue_billing_webhook_event_v1(evento)` → «Resend» en Stripe. O esperar al siguiente evento de esa suscripción | No hace falta |
| Riesgo | A1: Stripe puede avisar y llegar a desactivar el endpoint si falla de forma continuada, y eso afectaría a todos los tenants | Cobro sin registro local hasta que actúe un operador | Que alguien marque `ready_for_checkout` sin querer |

En A y B el cobro ocurre en Stripe igualmente: ninguna opción reembolsa ni
cancela en Stripe por sí sola. Eso queda en manos del propietario.

## Recomendación

**B + C.** B cierra el riesgo para todas las filas internas y C da a SUR4 un
paso a Stripe sin el hueco del borrador manual D1 (cerrar la fila antes del
checkout deja el tenant sin cuota hasta que llega el webhook).

Si antes del 02/11 se quiere el cambio mínimo, basta con **B** (commit
`ce54c47`): C va en un commit aparte (`cd1dea9`) y se puede descartar. **A** no
se recomienda: A1 arriesga el endpoint y A2 es B sin rastro ni recuperación.

## Lock compartido

| Pieza | Antes | Con D1 |
| --- | --- | --- |
| Guarda de #132 (TypeScript) | Sin lock | Igual, como comprobación rápida. La comprobación autoritativa pasa a `prepare` |
| `prepare_billing_checkout_attempt_v2` | Clave 31; solo mira filas Stripe | Clave 31; rechaza `internal_subscription_current` bajo el lock (C: salvo `ready_for_checkout`) |
| `sync_billing_subscription_v1` | Clave 4242 | **Clave 31**, la misma que `prepare` |
| SQL manual sobre filas internas | Sin lock | Debe tomar antes `pg_advisory_xact_lock(hashtextextended(tenant_id::text, 31))` (regla operativa; no se puede forzar sin una RPC) |

Sin interbloqueos nuevos: `sync` solo toma la clave 31 y filas de
`subscriptions`, y ningún camino toma filas de `subscriptions` antes de la
clave 31. Ya existía una inversión de orden entre
`attach_billing_checkout_session_v2` (fila del intento → clave 31) y
`prepare` (clave 31 → fila del intento); D1 no la cambia.

## Qué cambia

- **Migración** `20261018130000_billing_internal_subscription_webhook_guard_v1.sql`:
  `sync` y `prepare` con la misma firma, y la nueva
  `requeue_billing_webhook_event_v1(text)`, solo `service_role`. No modifica
  filas al aplicarse. Vuelta atrás en `supabase/rollbacks/`.
- **App:** `webhook.ts` trata `held` antes de activar el tenant y registra solo
  ids. `internal_subscription_current` pasa a ser un error determinista. El
  nuevo resultado de `prepare` se traduce a 409. C: la guarda lee `metadata`.
- **Tests:** cambio intencionado de `phase23` (y de `phase24`, que fijaba lo
  mismo): ahora la sync se retiene y solo se aplica tras cerrar la fila
  interna. `phase54` nuevo, en el Release Gate.

## Efecto sobre el plan de SUR4 (`SUR4-FIN-PRUEBA-OCT-2026.md` §D1)

- El borrador manual (cerrar la fila → checkout → webhook) sigue funcionando
  con B y con C. Deja de ser cierto que «además cancela cualquier otra
  vigente».
- Con C, el paso recomendado sería:
  1. marcar la fila con `billing_activation = 'ready_for_checkout'`;
  2. Tamara hace el checkout;
  3. el webhook convierte la fila.
  
  Si no paga, se vuelve a marcar `deferred_until_go_live`, sin tocar el
  estado.
- La interfaz de Facturación sigue ocultando «Contratar» con una fila interna
  vigente. Mostrar «Activar facturación» para `ready_for_checkout` es otra PR
  pequeña.

## Antes de publicar

- Decisión: A, B o B + C.
- Renumerar la migración y `phase54` si entra antes algo posterior (orden
  global: #128 → A1 → B1 → C1 → D1). Nunca `--include-all`.
- Probar en Staging con Stripe Test (D3) el ciclo retención → `requeue` →
  «Resend», y la conversión C.
