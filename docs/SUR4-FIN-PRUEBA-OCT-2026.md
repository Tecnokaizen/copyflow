# SUR4 — Gate operativo y fin de la prueba interna — 16/10/2026

Preparación del fin de la prueba de SUR4. **Nada de lo que hay aquí se ha ejecutado.** Los bloques SQL son borradores para revisar y requieren autorización expresa. Datos obtenidos con consultas de solo lectura, sin datos personales.

Complementa [SUR4-LAUNCH-AUDIT-OCT-2026.md](SUR4-LAUNCH-AUDIT-OCT-2026.md) y el checklist de #35.

## 1. Suscripción actual

| Campo | Valor |
| --- | --- |
| Proveedor y estado | `internal`, `trialing` (en Facturación: «En prueba») |
| Plan | Basic (`livemode = false`, sin Stripe) |
| Periodo | 26/09/2026 13:53 UTC → **19/10/2026 13:53 UTC** (15:53 en Madrid) |
| Gracia comercial | 15 días iniciales más una prórroga de 8 días aplicada el 08/10 (23 en total) |
| `billing_activation` | `deferred_until_go_live` |

Corrección a la auditoría: el vencimiento es el **19/10**, no «hacia el 20/10».

## 2. Qué pasa al vencer si no se hace nada

**No cambia:**

- **Acceso:** sigue igual. El acceso depende de `tenants.active`, no de la suscripción, y ninguna función de la base de datos ni de la app compara `current_period_end` con la fecha actual.
- **Presupuestos:** siguen activos, porque van por override del tenant.
- **Cuota de 5 GiB:** sigue aplicándose mientras la suscripción esté en `trialing`.

**Cambia en Facturación:**

- Muestra «En prueba» con un periodo ya pasado (26/09 → 19/10).
- No ofrece «Contratar»: una suscripción interna vigente oculta el botón de checkout.

**Conclusión:** el problema no es técnico. SUR4 queda sin condición comercial registrada y con una pantalla de Facturación incoherente.

## 3. Gate operativo de SUR4 (#35)

| Bloque | Estado | Pendiente |
| --- | --- | --- |
| Datos reales | Cartera de clientes y catálogos con valores activos | Que Tamara confirme que pedido, cliente y servicio reales funcionan juntos (sesión de solo lectura, §4) |
| Limpieza de datos de prueba | Sin hacer | Inventario y confirmación expresa antes de borrar o archivar (§6) |
| Configuración del tenant | Activo y `ready`; estados, tiendas, canales, contextos y tipos de cliente configurados | Revisar marca, logo y pedido rápido con Tamara |
| Facturación | Prueba interna hasta el 19/10 | **Decisión: §5** |
| Kiosk | `KIOSK_SIGNING_SECRET` solo en Preview, como pide #35 | — |
| Accesos | 1 owner, 2 admin y 4 staff activos; 6 invitaciones aceptadas | Desactivar accesos de prueba cuando se autorice. **SMTP de Auth** para recuperar contraseñas (POST-SPRINT-OPS, §2.1) |
| Dominio y Production | `sur4.app.gestcopy.com` responde 200, con SSL, despliegue en verde y E2E de Staging en verde | — |
| Entrega | Ayuda en la app con guías y Novedades | Documento «qué incluye Basic» |
| Comercial | Propuesta de #35: 450 € de implantación y 39 €/mes Basic | **Decisión del propietario** |

## 4. Sesión de solo lectura con Tamara (sin modificar datos)

Con su sesión y mirando sin guardar nada:

1. **Acceso:** entrar en `sur4.app.gestcopy.com` y cerrar sesión.
2. **Pedidos:** listado, filtros y una ficha (archivos, cobros, historial).
3. **Clientes:** listado y una ficha (la dirección aparece vacía y es opcional).
4. **Presupuestos:** listado, una ficha y descarga del PDF de una versión existente.
5. **Archivos y cobros:**
   - descargar un archivo de un pedido;
   - ver el panel de cobros (los antiguos aparecen como «Sin especificar (histórico)»).
6. **Interfaz:** cabecera con el logo en móvil y escritorio, modo claro y oscuro.
7. **Roles:** repetir lo esencial con una cuenta admin y otra staff para confirmar lo que ve cada rol.
8. **Facturación:** ver Ajustes → Facturación y explicarle lo que mostrará después del 19/10 según la opción elegida.

## 5. Opciones para el fin de la prueba

Los borradores B, la vuelta atrás de B, C y D1 se han probado el 16/10 en una transacción desechable (con `rollback`) sobre la base local, con una fila idéntica a la de Production:

- B prorroga la prueba y, si se lanza por segunda vez, se niega (`sur4_grace_refused: 0 filas`);
- la vuelta atrás deja `metadata` y la fecha exactamente como estaban;
- C pasa la fila a `active`;
- D1 la cierra.

| Opción | Qué supone | Cuándo encaja |
| --- | --- | --- |
| A. No hacer nada | Facturación muestra un periodo vencido | No se recomienda |
| **B. Prorrogar la prueba** (recomendada a corto plazo) | Nueva fecha fija y la gracia queda registrada en `metadata` | Mientras se decide el acuerdo y se prepara Stripe Live |
| C. Piloto activo interno | Estado `active` con periodo acordado y cobro fuera de la app | Hay acuerdo comercial firmado pero Live no está listo |
| D. Stripe Live (#35) | Suscripción real con cobro en la app | Cuenta Live, catálogo, webhook y prueba controlada listos |

### B. Prorrogar la prueba (borrador)

Antes de ejecutar, sustituir `v_new_end` por la fecha acordada (UTC). El bloque se niega a actuar si la fila no está exactamente en el estado leído el 16/10, y guarda el historial de la gracia.

```sql
-- BORRADOR B. NO EJECUTAR SIN AUTORIZACIÓN EXPRESA. Production, rol postgres.
begin;

do $$
declare
  v_expected_end constant timestamptz := timestamptz '2026-10-19 13:53:09.342441+00';
  v_new_end      constant timestamptz := timestamptz '2026-11-02 13:53:09.342441+00'; -- fecha acordada
  v_rows integer;
begin
  if v_new_end <= v_expected_end then
    raise exception 'sur4_grace_refused: la nueva fecha debe ser posterior';
  end if;

  update public.subscriptions s
  set current_period_end = v_new_end,
      metadata = s.metadata || jsonb_build_object(
        'commercial_grace_history',
          coalesce(s.metadata -> 'commercial_grace_history', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
               'ends_at', s.metadata -> 'commercial_grace_ends_at',
               'extended_at', s.metadata -> 'commercial_grace_extended_at',
               'extension_days', s.metadata -> 'commercial_grace_extension_days')),
        'commercial_grace_ends_at', to_jsonb(v_new_end),
        'commercial_grace_days',
          round(extract(epoch from v_new_end - s.current_period_start) / 86400)::int,
        'commercial_grace_extension_days',
          round(extract(epoch from v_new_end - v_expected_end) / 86400)::int,
        'commercial_grace_extended_at', to_jsonb(pg_catalog.now()))
  from public.tenants t
  where t.id = s.tenant_id
    and t.slug = 'sur4'
    and s.provider = 'internal'
    and s.status = 'trialing'
    and s.current_period_end = v_expected_end;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'sur4_grace_refused: % filas afectadas', v_rows;
  end if;
end $$;

-- Comprobación antes de confirmar: una fila, trialing y la nueva fecha.
select s.status, s.current_period_start, s.current_period_end, s.metadata - 'billing_activation' as grace
from public.subscriptions s join public.tenants t on t.id = s.tenant_id
where t.slug = 'sur4' and s.status in ('trialing', 'active', 'past_due');

commit; -- o rollback si la comprobación no es la esperada
```

Vuelta atrás: restaura los valores leídos el 16/10, solo si la fila sigue con la fecha nueva.

```sql
-- BORRADOR. Vuelta atrás de B.
update public.subscriptions s
set current_period_end = timestamptz '2026-10-19 13:53:09.342441+00',
    metadata = (s.metadata - 'commercial_grace_history') || jsonb_build_object(
      'commercial_grace_ends_at', '2026-10-19T13:53:09.342441+00:00',
      'commercial_grace_days', 23,
      'commercial_grace_extension_days', 8,
      'commercial_grace_extended_at', '2026-10-08T20:49:55.832258+00:00')
from public.tenants t
where t.id = s.tenant_id and t.slug = 'sur4'
  and s.provider = 'internal' and s.status = 'trialing'
  and s.current_period_end = timestamptz '2026-11-02 13:53:09.342441+00'; -- la fecha aplicada en B
```

### C. Piloto activo interno (borrador)

Facturación mostrará «Activa» con el periodo acordado. Sigue sin haber checkout, porque la suscripción interna está vigente. Al terminar cada periodo hay que actualizar el periodo a mano o pasar a D.

```sql
-- BORRADOR C. NO EJECUTAR SIN AUTORIZACIÓN EXPRESA.
begin;

do $$
declare
  v_expected_end constant timestamptz := timestamptz '2026-10-19 13:53:09.342441+00';
  v_start        constant timestamptz := timestamptz '2026-10-19 13:53:09.342441+00'; -- inicio acordado
  v_end          constant timestamptz := timestamptz '2026-11-19 13:53:09.342441+00'; -- fin acordado
  v_rows integer;
begin
  update public.subscriptions s
  set status = 'active',
      current_period_start = v_start,
      current_period_end = v_end,
      metadata = s.metadata || jsonb_build_object(
        'billing_activation', 'internal_pilot',
        'previous_billing_activation', s.metadata -> 'billing_activation',
        'pilot_started_at', to_jsonb(v_start),
        'pilot_terms_ref', '#35')
  from public.tenants t
  where t.id = s.tenant_id and t.slug = 'sur4'
    and s.provider = 'internal' and s.status = 'trialing'
    and s.current_period_end = v_expected_end;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'sur4_pilot_refused: % filas afectadas', v_rows;
  end if;
end $$;

commit; -- tras comprobar la fila como en B
```

**Vuelta atrás de C:**

- `status = 'trialing'`;
- el periodo vuelve a 26/09 → 19/10;
- `billing_activation = 'deferred_until_go_live'`;
- se quitan las claves `pilot_*` y `previous_billing_activation`.

### D. Stripe Live (#35)

**Requisitos (propietario):**

1. **Cuenta y entorno Live:**
   - Cuenta Stripe Live definitiva, con datos fiscales (fuera de este documento).
   - Variables Live en Vercel Production: `STRIPE_MODE=live`, la clave secreta Live y el secreto del webhook Live. Después, redesplegar.
2. **Catálogo y webhook:**
   - Catálogo Live: `npm run billing:bootstrap-catalog -- --confirm-live`. El script se niega a crear objetos Live sin ese flag.
   - Webhook Live apuntando a Production.
3. **Prueba controlada:**
   - Recorrido checkout → webhook → suscripción en un tenant de verificación, no en SUR4.
   - En Live supone un cobro real, que después se reembolsa.

**Paso de SUR4 (actualizado el 18/10/2026: D1 B + C y S2 aprobados).**

Desde la migración `20261018170000`, el webhook ya no cancela una suscripción interna vigente:

- Si no está marcada, el pago se **retiene** para conciliarlo.
- Si está marcada `ready_for_checkout`, la **convierte**.

El antiguo borrador manual D1 (cerrar la fila antes del checkout) queda **retirado**. Dejaba a SUR4 sin suscripción vigente entre el cierre y el webhook. Con S2 ya no supone almacenamiento ilimitado: conserva la última capacidad contratada.

Pasos, solo con Stripe Live verificado y Tamara lista para contratar:

1. **Comprobación previa (solo lectura).**
   - `select public.list_billing_reconciliation_v1();` no debe tener entradas de `sur4`.
   - SUR4 no debe tener checkout attempts abiertos.
2. **Marcar la fila interna**, con la RPC auditada: toma el lock del tenant y registra el motivo y quién autoriza.

   ```sql
   select public.set_internal_billing_activation_v1(
     (select id from public.tenants where slug = 'sur4'),
     'ready_for_checkout',
     'Paso de SUR4 a Stripe Basic acordado con Tamara (#35)',
     '<propietario>'
   );
   ```

3. **Tamara pulsa «Activar facturación con Stripe»** en Ajustes → Facturación y completa el pago.
4. **El webhook convierte la fila interna.**
   - La fila interna queda `canceled` con `billing_activation = converted_to_stripe`.
   - La suscripción de Stripe pasa a ser la vigente.
   - El servicio no se interrumpe y la capacidad sigue en 5 GiB.
   - Todo queda en `billing_private.internal_subscription_audit` (`via = stripe_conversion`).
5. **Si Tamara no paga**, se vuelve a proteger la fila sin tocar su estado:

   ```sql
   select public.set_internal_billing_activation_v1(
     (select id from public.tenants where slug = 'sur4'),
     'deferred_until_go_live', 'Checkout no completado; se mantiene la prueba', '<propietario>'
   );
   ```

   Si la respuesta indica `open_checkout_attempts > 0`, cualquier pago tardío de esa sesión quedará retenido (paso 6).
6. **Si un pago queda retenido** (sesión antigua o suscripción creada fuera de la app), la app bloquea nuevos checkouts con `subscription_pending_reconciliation`.
   - El aviso llega al log `[billing.reconciliation]` y, si está configurado, a `BILLING_ALERT_EMAIL`.
   - Para **adoptarlo**:
     1. marcar `ready_for_checkout` (paso 2);
     2. ejecutar `select public.requeue_billing_subscription_hold_v1('<hold_id>', '<motivo>', '<propietario>');`;
     3. hacer «Resend» de esos eventos en Stripe.
   - Para **descartarlo**: reembolsar y cancelar en Stripe y después ejecutar `select public.resolve_billing_subscription_hold_v1('<hold_id>', '<motivo>', '<propietario>');`.

Las prórrogas B siguen siendo válidas. Desde S2 quedan registradas en la auditoría como `update`, con `via = direct`.

**Qué conserva el paso a Stripe.** La conversión solo cambia filas de `subscriptions`:

- La fila interna pasa a `canceled` y conserva su historial: metadatos, `internal_closed_at` e id de Stripe.
- Se crea la fila Stripe vigente.

No cambian:

- el tenant (id, slug, `active`);
- usuarios y memberships;
- pedidos, clientes, presupuestos y cobros;
- archivos (R2 y metadatos);
- ajustes y overrides (`quotes`);
- la capacidad de 5 GiB, de Basic interna a Basic Stripe.

El historial de suscripciones queda completo: la `mvp` cancelada, la interna convertida y la de Stripe. Todo cambio en la fila interna queda en `billing_private.internal_subscription_audit`.

**Mientras no se decida el paso:**

- No se marca `ready_for_checkout`.
- No se inicia ningún checkout en `sur4`.
- Su fila interna está protegida: un pago de Stripe queda retenido, sin cancelarla.

## 6. Tenant de verificación y tenants de prueba en Production

Production tiene seis tenants activos: `sur4`, `demo` (interna, `active`) y cuatro sin suscripción:

- `tenant-prueba`;
- `copisteria-caprichos`;
- `prueba-final`;
- `billing-sandbox`.

**Tenant de verificación:**

- Reutilizar `billing-sandbox` o `prueba-final` evita crear otro.
- Sirve para ejercitar con datos sintéticos la infraestructura real que Staging no cubre:
  - Resend: invitación a un buzón del propietario;
  - SMTP de Auth: recuperación de contraseña;
  - R2 de Production: subir y descargar;
  - PDF y cobros con justificante.
- Requiere un usuario controlado por el propietario. No se usan cuentas de SUR4.

**Limpieza:** hay que decidir qué tenants de prueba se desactivan o se conservan, en especial si `copisteria-caprichos` es un cliente potencial real. No se borra nada sin inventario y confirmación expresa (#35, §2).

## 7. Decisiones pendientes

1. Opción de fin de prueba (B, C o D) y fecha, **antes del 19/10 a las 13:53 UTC**.
2. Condiciones comerciales de SUR4 (#35).
3. Tenant de verificación: cuál y con qué usuario.
4. Tenants de prueba en Production: conservar o desactivar.
5. Para D: resuelto el 18/10 (D1 B + C, «Activar facturación» incluido); queda solo verificar Stripe Live.
