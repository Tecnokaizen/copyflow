# Facturación D1/D2 · webhook, suscripciones internas y capacidad

**Estado:** aprobado por el propietario el 18/10/2026. Opciones:

- **D1:** B + C.
- **D2.1:** estado `settled`.
- **D2.2:** S2, «0 + explicit internal».
- **D2.3:** suites de facturación en el Release Gate.

**Pendiente:** no hay despliegue en Production hasta superar las verificaciones.

**Migraciones, en orden, tras #90 (`20261018150000`):**

| Migración | PR | Contenido |
| --- | --- | --- |
| `20261018160000_billing_checkout_attempt_settled_v1` | D2 | Volver a contratar tras cancelar |
| `20261018161000_billing_storage_capacity_explicit_v1` | D2 | Capacidad explícita y concesiones internas auditadas |
| `20261018170000_billing_internal_subscription_webhook_guard_v1` | D1 | Retención, conciliación y conversión |

Cada una tiene su vuelta atrás en `supabase/rollbacks/`. Ninguna toca filas de suscripciones al aplicarse.

## Problema

`sync_billing_subscription_v1` cancelaba **cualquier** fila vigente del tenant cuando llegaba una suscripción de Stripe vigente, incluidas las internas (SUR4 y demo). #132 solo frena las sesiones nuevas. Al webhook siguen llegando:

- sesiones abiertas antes de crear o reactivar la fila interna;
- suscripciones creadas en Stripe fuera de la app.

## Diseño aprobado

### D1 · B, retención con aviso

1. **Retención.** Si la fila no Stripe vigente (internal, `mvp` o NULL) no está marcada `ready_for_checkout`:
   - la sync no escribe la suscripción;
   - registra una retención en `billing_private.subscription_holds`: ids de Stripe, modo, estado, eventos e historial;
   - el webhook marca el evento como `failed` sin reintento (`internal_subscription_current`) y avisa.
2. **Ningún cobro nuevo con una retención pendiente.**
   - `prepare_billing_checkout_attempt_v2` responde `subscription_pending_reconciliation` (409) en cualquier modo.
   - `grant_internal_subscription_v1` también la rechaza.
3. **Recuperación idempotente y trazada.**
   - `requeue_billing_subscription_hold_v1(hold, motivo, quién)`:
     - exige que la fila interna esté cerrada o marcada `ready_for_checkout`;
     - deja reintentables los eventos retenidos para un «Resend» en Stripe;
     - es idempotente: `events_marked = 0` la segunda vez.
   - La siguiente sync que registra la suscripción concilia la retención (`reconciled`).
   - `resolve_billing_subscription_hold_v1(hold, motivo, quién)` la descarta (`dismissed`) después de verificar en Stripe que se canceló o reembolsó. Es idempotente.
   - Un evento vigente posterior la reabre.
4. **Aviso operativo.**
   - Log estructurado `[billing.reconciliation]` con ids, sin datos personales.
   - Si `BILLING_ALERT_EMAIL` está configurado, un correo con Resend la **primera** vez de cada retención. El aviso nunca hace fallar el webhook.
5. **`list_billing_reconciliation_v1()`** (solo `service_role`) lista lo que requiere a un operador:
   - retenciones pendientes;
   - checkouts pagados sin suscripción registrada pasados 15 minutos (el caso de D2.1 que sigue bloqueado a propósito);
   - concesiones internas hechas por SQL directo en los últimos 30 días.

### D1 · C, reconversión solo si `ready_for_checkout`

- **`set_internal_billing_activation_v1(tenant, valor, motivo, quién)`**:
  - admite `ready_for_checkout`, `deferred_until_go_live` e `internal_pilot`;
  - trabaja bajo el lock del tenant;
  - deja historial en `metadata` y queda auditada (`activation_rpc`).
- **Con la fila marcada:**
  - la guarda de #132 y `prepare` dejan pasar el checkout;
  - Facturación muestra «Activar facturación con Stripe»; la API solo expone un booleano;
  - la sync cierra la fila como `converted_to_stripe`, auditada (`stripe_conversion`).

### D2.1 · `settled`

- Un intento `completed` deja de bloquear cuando todas las filas Stripe del tenant y modo creadas desde la reserva están `canceled`.
- Un `completed` sin suscripción registrada sigue bloqueado, porque Stripe ya cobró. Aparece en `list_billing_reconciliation_v1()`.

### D2.2 · S2, capacidad explícita

**`resolve_tenant_storage_capacity_v1` resuelve en este orden:**

1. plan vigente;
2. última capacidad contratada (una cancelación la conserva);
3. 0: `no_subscription` o `no_contracted_capacity`.

**Reglas:**

- **Nunca NULL y nunca ilimitada.** `resolve_tenant_storage_limit_bytes` mantiene la firma.
- **Capacidad ≠ permisos de escritura.** Los roles siguen en las RPC de subida. Un staff con capacidad 0 recibe `storage_quota_exceeded`; un viewer recibe `tenant access denied` (phase22).
- **Derechos internos legítimos.** El plan `mvp` (demo) pasa de «ilimitado implícito» a una capacidad explícita igual a la de Basic (5 GiB). No se toca ninguna suscripción.
- **Concesiones internas:**
  - se hacen solo con `grant_internal_subscription_v1`, que exige motivo y autorizador, toma el lock del tenant y rechaza si hay checkout pagable, retención o suscripción vigente;
  - todo cambio en una fila no Stripe queda en `billing_private.internal_subscription_audit`;
  - los roles de la API no pueden conceder ni reactivar fuera de la RPC;
  - el SQL directo como `postgres` sigue siendo posible (fixtures y operaciones), pero queda auditado como `direct` y aparece en la lista de conciliación.
- **`create_internal_organization_v1` no cambia:** crea organizaciones sin suscripción, con capacidad 0 hasta una concesión.

## Requisitos de integración del 18/10

| # | Requisito | Cómo se cumple | Evidencia |
| --- | --- | --- | --- |
| 1 | Ningún checkout incompatible con una interna protegida | Guarda de #132 y comprobación de `prepare` bajo el lock, en los dos modos y flujos. Una sesión abierta no se reutiliza | phase57 E, integración TS |
| 2 | Lock transaccional compartido | Clave 31 en `prepare`, `sync` (antes 4242), la concesión, la activación y las RPC de retención | phase57 F (`pg_locks`), `phase57_billing_lock_concurrency.sh` (dos sesiones y una carrera concesión–checkout) |
| 3 | Recuperación idempotente, trazabilidad y avisos | Requeue y descarte idempotentes, con motivo y quién. Historial en la retención; ids de evento; log y correo | phase57 A, G, H, I y J; tests TS |
| 4 | Capacidad ≠ escritura; ningún NULL ilimitado | S2 | phase56 A (incluida una mutación), phase22 |
| 5 | Derechos internos legítimos | Sin cancelaciones por la sync; `mvp` con capacidad explícita; SUR4 sigue en 5 GiB | phase57 A y L, phase56 |
| 6 | Sin cobros nuevos con un Stripe pendiente | `subscription_pending_reconciliation` también tras cerrar la fila interna; `completed` sin registro sigue en `checkout_processing` | phase57 G e I, phase55 C |
| 7 | Plan de SUR4 y documentación | `SUR4-FIN-PRUEBA-OCT-2026.md` §5 D, este documento, `RELEASE-GATE-V1.md`, `E2E-STAGING-V0.md` | — |
| 8 | Colisiones | Renumerado tras #90: migraciones `…160000`, `…161000`, `…170000`; tests phase55–57 (#90 usa phase53) | Guarda de migraciones |
| 9 | Pruebas desde una base limpia | `db reset` y todas las suites del Release Gate y de `kiosk-supabase.yml` | Ver la PR |

## Efectos en Stripe

- **Retención:** el cliente ya pagó y la suscripción de Stripe sigue activa y renovándose hasta que alguien la adopte o la cancele y reembolse. Stripe no reintenta el evento.
- **Ninguna RPC actúa sobre Stripe.**

## Lock compartido (clave `hashtextextended(tenant_id, 31)`)

| Pieza | Antes | Ahora |
| --- | --- | --- |
| Guarda de #132 (TS) | Sin lock | Comprobación rápida; la autoritativa está en `prepare` |
| `prepare_billing_checkout_attempt_v2` | 31 | 31 + interna protegida + retención pendiente |
| `sync_billing_subscription_v1` | 4242 | **31** |
| `grant_internal_subscription_v1` | — | 31 |
| `set_internal_billing_activation_v1` | — | 31 |
| Requeue y descarte de retenciones | — | 31 (+ 23 por evento, como `claim`) |

- **Sin interbloqueos nuevos.** Ya existía una inversión entre `attach_billing_checkout_session_v2` (fila → 31) y `prepare` (31 → fila); no cambia.

## Antes de desplegar en Production

1. **Revisión** de las dos PR y Release Gate en verde.
2. **Staging:**
   - aplicar las migraciones en orden;
   - ejecutar el seed E2E con `E2E_CAPACITY_AUTHORIZED_BY`, que concede Basic interna al tenant `e2e`;
   - E2E completo;
   - con Stripe Test (D3), probar la retención → `requeue` → «Resend», la conversión C y cancelar y volver a contratar.
3. **Production (auditoría de solo lectura del 18/10):**

   | Tenant | Archivos | Capacidad hoy | Con S2 |
   | --- | --- | --- | --- |
   | `sur4` | 265 | 5 GiB | 5 GiB (plan vigente) |
   | `demo` | 12 (~3 MB) | ilimitada | 5 GiB (`mvp` explícito) |
   | `billing-sandbox` | 0 | ilimitada | 5 GiB (última contratada) |
   | `tenant-prueba` | 0 | ilimitada | **0** |
   | `copisteria-caprichos` | 0 | ilimitada | **0** |
   | `prueba-final` | 0 | ilimitada | **0** |

   - Los tres últimos no tienen ninguna suscripción y no guardan archivos.
   - No se modifica nada sin autorización. Si alguno debe poder subir archivos, se usa `grant_internal_subscription_v1` con motivo y autorizador.
4. **Opcional:** configurar `BILLING_ALERT_EMAIL` en Vercel Production.
