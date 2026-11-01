# Billing Access Gate V1

Control centralizado del acceso comercial para **todos** los tenants. Sin excepciones por tenant en el código.

- **Migración:** `supabase/migrations/20261102100000_billing_access_gate_v1.sql`
- **Proxy:** `proxy.ts` + `lib/billing/access-gate.ts` (decisión pura) + `lib/billing/access-gate-server.ts`
- **Página:** `app/billing-suspended/page.tsx`
- **Pruebas:** `supabase/tests/phase64_billing_access_gate.sql`, `lib/billing/access-gate.test.ts`

## 1. Problema

Hasta ahora el acceso dependía de `tenants.active` y del rol del usuario. Ninguna pieza caducaba una prueba interna: no había cron ni comprobación de `current_period_end`. Una prueba vencida seguía operando indefinidamente, y una suscripción Stripe `unpaid` o `canceled` también.

## 2. Principios

1. `tenants.active` conserva su significado administrativo. **La puerta no lo lee ni lo escribe.**
2. **No se modifica ninguna política RLS.** El bloqueo es un trigger `BEFORE INSERT/UPDATE/DELETE` adicional.
3. **Nada se borra al suspender:** pedidos, clientes, usuarios, archivos y ajustes se conservan y siguen siendo legibles.
4. **Reactivación automática:** el estado se calcula en cada petición a partir de `subscriptions`. Cuando el webhook de Stripe registra el pago, el acceso vuelve en la siguiente petición. No hay ningún flag que recordar quitar.
5. **El Owner siempre puede ir a Facturación, Checkout y Portal.** Esas rutas están exentas y escriben con `service_role`.
6. **Despliegue en tres modos:** `off` (por defecto), `observe` y `enforce`, sin redesplegar.

## 3. Estados

Los calcula `billing_private.evaluate_tenant_billing_access(tenant, at)`.

| Estado | Acceso | Regla |
|---|---|---|
| `administrative_gate` | ✅ (no aplica) | Tenant inactivo o `pending_billing`: lo gobiernan `tenants.active` y la puerta de inactividad. Permite el onboarding de pago, que siembra el tenant antes de tener suscripción |
| `exempt` | ✅ | Exención de operador vigente (`tenant_access_exemptions`) |
| `subscription_active` | ✅ | Stripe `active`/`trialing`. Stripe es la fuente de verdad de las fechas |
| `subscription_canceling` | ✅ | Stripe activa con `cancel_at_period_end` o `cancel_at` |
| `past_due_grace` | ✅ | Stripe `past_due` y `now < current_period_start + gracia` |
| `trial_active` / `internal_active` | ✅ | Interna vigente y `now < current_period_end` (NULL = sin fin) |
| `reconciliation_pending` | ✅ | Suscripción Stripe retenida (`subscription_holds.status = 'held'`) |
| `checkout_pending` | ✅ | Checkout `creating`/`open`/`completed` iniciado **antes** del fin de la prueba; dura hasta `max(expires_at, fin de prueba) + 120 min` |
| `past_due_suspended` | ⛔ | `past_due` fuera de gracia |
| `trial_expired` / `internal_expired` | ⛔ | Interna con `current_period_end <= now`. **Sin prórroga automática** |
| `subscription_ended` | ⛔ | La última suscripción está `canceled`/`unpaid`/`paused`/`incomplete` |
| `no_subscription` | ⛔ | Nunca ha tenido suscripción |

**Distinciones exigidas:**
- **Contratación confirmada:** suscripción Stripe `active`.
- **Primer cobro diferido** (ancla futura, factura de 0 € o sin factura): Stripe la marca `active` desde el alta, así que hay acceso.
- **`past_due`:** periodo de gracia.
- **Webhook pendiente:** `checkout_pending` o `reconciliation_pending`.

**Caso SUR4:** Checkout antes de las 14:08 → conversión → Stripe `active`, con la primera factura a las 14:53. No hay suspensión. Si el webhook llegara después de las 14:53, `checkout_pending` cubre hasta 2 h tras el fin de la prueba. Esto está probado en phase64 (bloque B).

## 4. Política de gracia propuesta (pendiente de aprobación)

| Situación | Propuesta |
|---|---|
| Prueba vencida | Sin gracia ni prórroga automática. Suspensión al minuto exacto de `current_period_end` |
| Pago recurrente fallido (`past_due`) | **7 días de gracia** desde el inicio del periodo impagado. Stripe sigue reintentando (Smart Retries) |
| Tras la gracia | Suspensión. El Owner paga desde el Portal y se reactiva al llegar `invoice.paid` / `customer.subscription.updated` |
| Stripe pasa a `unpaid` o `canceled` | Suspensión. Con `unpaid`, pagar la factura reactiva. Con `canceled`, hace falta un Checkout nuevo (el Owner tiene acceso) |
| Cancelación al final del periodo | Servicio completo hasta el fin; suspensión cuando Stripe envía `deleted` |

La gracia (`past_due_grace_days`, de 0 a 30) y la ventana de checkout pendiente (`checkout_pending_minutes`) se cambian con `set_billing_access_gate_settings_v1`, con auditoría y sin migración.

**Recomendación complementaria (Stripe Dashboard, fuera de este PR):** configurar los reintentos para que el último sea ≥ 7 días y que la acción final sea «marcar como impagada» (no cancelar), para que el cliente conserve la suscripción y pueda regularizar.

## 5. Aplicación

### Base de datos (barrera dura)

- Trigger `trg_billing_access_gate` en 35 tablas operativas: pedidos, archivos, notas, pagos, clientes, presupuestos, catálogos, equipo, invitaciones, membresías, ajustes, dominios, importaciones, uso de IA y `tenants`.
- Solo actúa con JWT de usuario (`auth.role()` = `authenticated` o `anon`). Eso incluye las RPC `SECURITY DEFINER` que llaman los usuarios y el kiosko anónimo.
- `service_role` (webhook, facturación, soporte) y las sesiones sin JWT (migraciones, cron) pasan.
- No actúa en el `INSERT` de `tenants` (alta por RPC controlada).
- Error **`PT402 billing_suspended`**. PostgREST lo devuelve como HTTP 402; el `detail` lleva el estado.
- Caché de una evaluación por tenant y transacción.
- **No bloquea:** `activity_log`, contadores, tablas de facturación, `subscriptions`, `files_private.storage_deletions` (la limpieza en R2 continúa) ni las lecturas.

### Proxy (experiencia de usuario)

Solo en hosts de tenant y solo si `BILLING_ACCESS_GATE_PROXY=on`:
- **Navegación:** redirige a `/billing-suspended`. El Owner ve «Ir a Facturación»; el resto, que solo el propietario puede regularizar.
- **API POST/PUT/PATCH/DELETE:** responde 402 `{code: "billing_suspended", state}`.
- **API GET:** pasa (los datos siguen siendo consultables).
- **Exentas:** `/auth/*`, `/settings/billing*`, `/api/billing/*`, `/api/webhooks/*`, `/api/internal/*`, `/api/kiosk/*`, `/kiosk`, `/ayuda*`, `/invitations/*`, `/tenant-inactive`, `/billing-suspended`.
- **Si falla la lectura, deja pasar** (igual que la puerta de inactividad). El trigger sigue protegiendo las escrituras.

## 6. Despliegue propuesto (cada paso requiere GO)

**No desplegar nada de esto antes de que SUR4 quede convertido (L7) el 02/11.**

| Fase | Acción | Efecto |
|---|---|---|
| D0 | Merge + deploy con `BILLING_ACCESS_GATE_PROXY` sin definir | Ninguno |
| D1 | Migración en Staging → phase64 + E2E en Staging | Ninguno en Production |
| D2 | Migración en Production (modo `off`) | Ninguno: el trigger evalúa y permite |
| D3 | **Decidir los tenants actuales** (ver §7) y crear exenciones si procede | — |
| D4 | `BILLING_ACCESS_GATE_PROXY=on` + modo `observe` ≥ 48 h | Solo logs `[billing.access-gate] observe` |
| D5 | Modo `enforce` | Suspensión real |

**Rollback inmediato:** modo `off` con `set_billing_access_gate_settings_v1`, efectivo en la siguiente transacción. Si hace falta, además `BILLING_ACCESS_GATE_PROXY` sin definir.

## 7. Situación actual en Production (lectura, 01/11 21:10Z)

| Tenant | Estado calculado | Decisión necesaria antes de D5 |
|---|---|---|
| sur4 | `trial_active` hasta 02/11 13:53Z → `subscription_active` tras L7 | Ninguna si L7 se completa |
| demo | `internal_active` (mvp hasta 2027-09-05) | Ninguna |
| billing-sandbox | `subscription_ended` (Stripe live cancelada) | ¿Exención o suspendido? |
| copisteria-caprichos | `no_subscription` | ¿Exención, prueba interna o suspendido? |
| prueba-final | `no_subscription` | Ídem |
| tenant-prueba | `no_subscription` | Ídem |

## 8. Medida transitoria hasta el modo `enforce`

Esta puerta no estará validada en Production antes del 02/11. Hasta entonces:
- Si SUR4 contrata, no hace falta nada.
- Si SUR4 **no** contrata, seguirá operando tras las 14:53, igual que hoy. **No se recomienda usar `tenants.active = false`** como interruptor comercial: rompe la separación y bloquea también al Owner fuera de Facturación. Lo seguro es que el propietario decida comercialmente (nueva oferta según D1) y, si exige cortar, adelantar D2–D5 solo con GO explícito.

## 9. Procedimiento de soporte

Todo con clave `service_role`, desde el SQL editor o un script de operador:

```sql
-- Diagnóstico
select public.resolve_tenant_billing_access_v1('<tenant_id>');
-- Exención temporal (p. ej. 72 h para un cliente que paga por transferencia)
select public.set_tenant_billing_access_exemption_v1('<tenant_id>', true, now() + interval '72 hours', '<operador>', '<motivo>');
-- Quitar exención
select public.set_tenant_billing_access_exemption_v1('<tenant_id>', false, null, '<operador>', '<motivo>');
-- Cambiar modo o gracia
select public.set_billing_access_gate_settings_v1('observe', 7, 120, '<operador>', '<motivo>');
```

| Síntoma | Causa probable | Acción |
|---|---|---|
| El cliente pagó y sigue suspendido | Webhook fallido o retenido | Revisar `billing_webhook_events` y `subscription_holds`; reenviar el evento desde Stripe. Exención corta mientras se concilia |
| `past_due` justo al cobrar | Tarjeta caducada | El Owner actualiza el método de pago en el Portal; Stripe reintenta |
| Prueba vencida sin intención de pagar | — | Nada que hacer. Los datos se conservan; exportación bajo petición |

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Suspender a un cliente que ya pagó (webhook perdido) | `checkout_pending` / `reconciliation_pending`, fase `observe`, rollback a `off` en segundos |
| Latencia: una RPC más por petición en hosts de tenant | Solo con el proxy activado; función `STABLE` con índices existentes |
| Escrituras hechas con `service_role` desde rutas API | El proxy bloquea las mutaciones API; el trigger cubre el resto |
| Kiosko anónimo | Bloqueado por el trigger (`anon`) |
| Tenants sin suscripción (3) y sandbox cancelado | Decidir en D3 antes de `enforce` |
| Caché por transacción | Cada petición es una transacción nueva; la reactivación se ve en la siguiente |
