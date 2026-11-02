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

**Caso SUR4 (estado comercial L6e, desde el 02/11/2026 21:57Z):**
- La prueba interna terminó el 02/11/2026 a las 13:53Z, pero la fila sigue `trialing`, con `metadata.billing_activation = ready_for_checkout`.
- Tiene una oferta Pro activa **sin ancla** (`billing_cycle_anchor` null): 40 € de descuento en cada una de las 2 primeras cuotas.
- **Fecha límite para contratar: 16/11/2026 a las 20:00 Madrid** (19:00Z, que es `redeem_by` − 45 min).
- En Checkout hay un **cobro inmediato de 39 €**. La segunda cuota, un mes después, es también de 39 €. Las renovaciones posteriores son de 79 € al mes.
- Al pagar, el webhook convierte la fila interna (`converted_to_stripe`) y la suscripción Stripe queda `active` (L7).

**Riesgo `trial_expired` pese a `ready_for_checkout`.** Con `observe`/`enforce`, la puerta evalúa hoy a SUR4 como **`trial_expired`**, porque `current_period_end` ya pasó. Ni `ready_for_checkout` ni la oferta usable cuentan. `checkout_pending` no lo cubre, porque solo protege Checkouts iniciados **antes** del fin de la prueba, y SUR4 contratará después. En `enforce`, SUR4 quedaría suspendido durante su propia ventana de contratación. El Owner seguiría pudiendo ir a Facturación y pagar, pero el resto del equipo no podría escribir. phase64 (bloque B) solo prueba el escenario anterior (Checkout antes del fin de la prueba, con ancla). El estado L6e está en phase65 (§6).

## 4. Política de gracia — APROBADA por el propietario (01/11/2026)

Aprobada solo como política y para incorporarla al diseño y a las pruebas de #179. **No autoriza** fusionar, aplicar migraciones, desplegar ni activar `observe`/`enforce`.

| Condición aprobada | Implementación | Prueba (phase64) |
|---|---|---|
| 1. 7 días desde el inicio del periodo **efectivamente** impagado | `subscription_status_events` guarda `period_start` al entrar en `past_due`. La gracia se cuenta desde ahí, aunque Stripe renueve el periodo sin cobrar | `past_due entry logged…`, `period roll-forward does not restart grace` |
| 2. Durante la gracia, acceso operativo y regularización | `past_due_grace` = acceso; Portal y Checkout exentos | `past_due within grace`, `grace day 6…` |
| 3. Después, suspensión sin borrar datos | `past_due_suspended`; el trigger solo bloquea escrituras, no borra | `suspended after 7 days`, `suspended tenant keeps and reads its data` |
| 4. Owner con Facturación, Checkout, Portal y recuperación | Rutas exentas en el proxy; escrituras de facturación con `service_role` | Unitarias `keeps billing, Checkout, Portal and auth open…` |
| 5. Reactivación automática al confirmar Stripe | El estado se recalcula desde `subscriptions`; el webhook pone `active` | `Stripe payment reactivates`, `reactivated tenant writes` |
| 6. Registrar y auditar transiciones | `billing_private.subscription_status_events` (alta y cada cambio de estado, con rol), historial de ajustes y de exenciones | `insert, past_due and active transitions audited`, `settings changes audited`, `exemption audited` |
| 7. Exenciones explícitas y auditadas | `set_tenant_billing_access_exemption_v1` (autorizante y motivo obligatorios, caducidad opcional). Retirada lógica y evidencia permanente en `tenant_access_exemption_events` (solo inserción) | Bloque de exenciones: concesión, modificación, retirada, retirada repetida, nueva concesión, caducidad, evidencia inmutable, retirada inmediata bajo `enforce` |
| 8. Prueba interna vencida ≠ pago Stripe fallido | Estados distintos (`trial_expired` frente a `past_due_*`); las internas nunca tienen gracia | `internal trial expiry is not a payment failure` |

Resto de la política:
- **Prueba vencida:** sin gracia ni prórroga.
- **`unpaid`/`canceled`:** suspensión. Con `unpaid`, pagar reactiva; con `canceled`, hace falta un Checkout nuevo.
- **Cancelación al final del periodo:** servicio completo hasta el fin.

Los valores (`past_due_grace_days` = 7, `checkout_pending_minutes` = 120) se cambian con `set_billing_access_gate_settings_v1`, con auditoría.

**Recomendación complementaria (Stripe Dashboard, fuera de este PR):** configurar los reintentos para que el último sea ≥ 7 días y que la acción final sea «marcar como impagada».

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

**Condición obligatoria antes de activar `enforce` (D5).** Para SUR4 debe cumplirse una de estas dos:
1. **L7 verificada:** la suscripción Stripe Pro está `active`, la fila interna está cerrada como `converted_to_stripe` y la oferta está canjeada (`redeemed`). Las tres cosas comprobadas por lectura en Production.
2. **Exención temporal auditada y comprobada:** registrada con `set_tenant_billing_access_exemption_v1`, con autorizante, motivo y caducidad, y confirmada después con `resolve_tenant_billing_access_v1` (estado `exempt`). Ver la propuesta en §8.

Sin una de las dos, D5 no se ejecuta. `observe` (D4) puede activarse, pero cualquier entrada `trial_expired` de SUR4 en los logs es esperada y no es un fallo de la puerta.

**Dependencia de pruebas.** Antes de cada paso deben estar en verde, en el Release Gate y sobre la misma base:
- **phase64** (`phase64_billing_access_gate.sql`): la propia puerta.
- **phase65** (`phase65_offer_contracting_path.sql`, PR #180): el camino de contratación de SUR4 en el estado L6e, es decir, Checkout permitido, conversión `converted_to_stripe`, canje de la oferta y ningún segundo Checkout. Lo exige la regla del propietario (02/11) para todo cambio en Checkout, onboarding, planes, derechos o esta puerta.
- phase64, bloque B2: el fixture L6e de phase65 comprueba `trial_expired` sin exención (sin aplicarse mientras el modo es `off`), `exempt` con exención, `trial_expired` de nuevo tras retirarla y `subscription_active` tras la conversión.

**Auditoría de exenciones (bloqueador corregido en un commit de código independiente).** Antes, retirar una exención hacía `delete` de la fila y se perdía su historial. Ahora:
- **Evidencia permanente:** cada concesión (`granted`), modificación de una exención vigente (`modified`) y retirada (`revoked`) añade una fila a `billing_private.tenant_access_exemption_events` con tenant, acción, autorizante, motivo, caducidad nueva y anterior, y fecha. La tabla es solo de inserción: un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`. No tiene clave foránea, así que la evidencia sobrevive a la fila de la exención y al propio tenant. Tiene RLS y ningún rol de API tiene permisos sobre ella. La fila de `tenant_access_exemptions` conserva además su `history`.
- **La retirada deja de dar acceso al momento:** retirar ya no borra. Rellena `revoked_at`, `revoked_by` y `revoke_reason` (los tres o ninguno, por restricción) y el evaluador solo tiene en cuenta exenciones con `revoked_at` nulo y sin caducar. La RPC toma el bloqueo de facturación del tenant (clave 31) y vacía la decisión cacheada de la puerta para ese tenant, así que la retirada se aplica ya en la misma transacción. Las siguientes transacciones siempre reevalúan.
- **Retirada repetida:** devuelve `unchanged` y no añade evidencia. Una concesión posterior es un `granted` nuevo, que limpia los campos de retirada y mantiene todo el rastro.
- **Permisos sin cambios:** la RPC sigue siendo solo `service_role`, y las tablas no son accesibles para `anon`, `authenticated` ni `service_role`.
- Probado en phase64 (bloque de exenciones, bloque B2 con la forma L6e y bloque C bajo `enforce`).

| Fase | Acción | Efecto |
|---|---|---|
| D0 | Merge + deploy con `BILLING_ACCESS_GATE_PROXY` sin definir | Ninguno |
| D1 | Migración en Staging → phase64 + phase65 + E2E en Staging | Ninguno en Production |
| D2 | Migración en Production (modo `off`) | Ninguno: el trigger evalúa y permite |
| D3 | **Propuesta al propietario para SUR4 (§8) y los 4 tenants sin suscripción vigente** (ver §7). Exenciones solo con GO | — |
| D4 | `BILLING_ACCESS_GATE_PROXY=on` + modo `observe` ≥ 48 h | Solo logs `[billing.access-gate] observe` |
| D5 | Modo `enforce`, **solo con la condición obligatoria cumplida** | Suspensión real |

**Rollback inmediato:** modo `off` con `set_billing_access_gate_settings_v1`, efectivo en la siguiente transacción. Si hace falta, además `BILLING_ACCESS_GATE_PROXY` sin definir.

## 7. Situación actual en Production (lectura, 01/11 21:10Z; fila sur4 actualizada con L6e del 02/11, sin lectura nueva)

| Tenant | Estado calculado | Decisión necesaria antes de D5 |
|---|---|---|
| sur4 | `trial_expired` desde 02/11 13:53Z (interna `trialing` + `ready_for_checkout`, oferta Pro sin ancla vigente hasta 16/11 20:00 Madrid) → `subscription_active` tras L7 | L7 verificada o exención temporal auditada y comprobada (§6, §8) |
| demo | `internal_active` (mvp hasta 2027-09-05) | Ninguna |
| billing-sandbox | `subscription_ended` (Stripe live cancelada) | ¿Exención o suspendido? |
| copisteria-caprichos | `no_subscription` | ¿Exención, prueba interna o suspendido? |
| prueba-final | `no_subscription` | Ídem |
| tenant-prueba | `no_subscription` | Ídem |

Antes de D3 hay que repetir la lectura completa en Production. Esta tabla no la sustituye.

## 8. Medida transitoria hasta el modo `enforce`

La puerta sigue en `off` y no estará validada en Production antes del 16/11. Hasta entonces SUR4 opera igual que hoy y no hace falta nada:
- **Si SUR4 contrata antes del 16/11 a las 20:00 Madrid:** se verifica L7 (§6) y SUR4 queda `subscription_active`. No hace falta exención.
- **Si la puerta tuviera que pasar de `off` antes de L7:** se aplica la exención propuesta abajo, solo con aprobación expresa.

**Propuesta de exención para SUR4 (pendiente de aprobación expresa y de conciliación):**
- Hasta el **17/11/2026 a las 00:00 Madrid** (`2026-11-16T23:00:00Z`): cubre la fecha límite de la oferta más un margen para que llegue el webhook.
- Antes de registrarla hacen falta dos cosas: la aprobación expresa del propietario y la conciliación del estado de facturación de SUR4 (suscripciones, intentos de Checkout, holds y oferta). El bloqueador de auditoría está corregido en código (§6), pero solo aplica una vez desplegada la migración con GO.
- Llamada prevista, solo tras esas tres condiciones: `set_tenant_billing_access_exemption_v1('<tenant_id de sur4>', true, '2026-11-16T23:00:00Z', '<propietario>', 'Ventana de contratación oferta Pro L6e')`, seguida de `resolve_tenant_billing_access_v1` para confirmar `exempt`.
- **Su vencimiento no constituye autorización automática de suspensión.** Si al vencer no hay L7, la decisión de suspender, prorrogar o hacer una nueva oferta es del propietario, con GO expreso. Mientras tanto, el modo de la puerta no cambia por el vencimiento.

**No se recomienda usar `tenants.active = false`** como interruptor comercial: rompe la separación y bloquea también al Owner fuera de Facturación.

## 9. Procedimiento de soporte

Todo con clave `service_role`, desde el SQL editor o un script de operador:

```sql
-- Diagnóstico
select public.resolve_tenant_billing_access_v1('<tenant_id>');
-- Exención temporal (p. ej. 72 h para un cliente que paga por transferencia)
select public.set_tenant_billing_access_exemption_v1('<tenant_id>', true, now() + interval '72 hours', '<operador>', '<motivo>');
-- Retirar exención (lógica: conserva la fila, el historial y el evento; deja de dar acceso al momento)
select public.set_tenant_billing_access_exemption_v1('<tenant_id>', false, null, '<operador>', '<motivo>');
-- Evidencia de exenciones de un tenant
select * from billing_private.tenant_access_exemption_events where tenant_id = '<tenant_id>' order by id;
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
