# Cierre Stripe Pro SUR4 — acta y autorizaciones

Fecha: 31/10/2026, Europe/Madrid. Alcance exclusivo: checkout. Un único proyecto Vercel, un único Supabase de producción, todos los tenants con tenant_id + memberships + RLS. Staging es un entorno de validación compartido, nunca infraestructura por tenant.

## Lo cerrado y lo que sigue abierto

- F12 PASS: conservar acta, no repetir.
- Migración 20261028090000 en Production: aplicada; NO db push, repair ni rollback.
- #158: actualización con main e148ec3 conservando los 34 commits de documentación. Conflicto único en internal-subscription-webhook.test.ts: versión de main íntegra, con las protecciones #163. Workflow y migraciones idénticos a main.
- #161: los tres commits existen; su integración actualizada debe superar CI. S10 no se cierra por pruebas unitarias: falta evidencia de correo real, otro navegador y onboarding Basic con Stripe Test.
- #177: retornos configurados por entorno, cinco URLs, 503 antes de escrituras, sin fallback de Preview a Production. E2E remoto pendiente.
- Producción leída en Vercel: e148ec3, dpl_XmdzdmYpDFvUauyeSceXN98QKj3r, Ready/Current, app.gestcopy.com. Esta sesión no lo ha desplegado.
- Auditoría 31/10 ~20:35: 2 billing_prices Basic, 0 Pro, 0 ofertas. No atribuir esos recuentos a una lectura nueva hasta comprobarlos.
- Stripe Gestcopy acct_1UIZG0Lp1xesIawY: lectura directa pendiente de acceso; el navegador inicialmente solo tiene Mailerfind. Sin clave Live disponible. Nunca ejecutar scripts de creación para suplir una lectura que falla.

## Condiciones comerciales invariables

Pro 79 EUR/mes, descuento fijo 40 EUR/mes en las facturas del 02/11/2026 y 02/12/2026: importe 39 EUR. Desde 02/01/2027, 79 EUR, salvo cambio a Basic 39 EUR o cancelación al final del periodo. Cupón restringido al producto Pro, duración repeating de 2 meses, max_redemptions=1 (un canje, dos cuotas). Aceptación expresa del Owner y hash de términos.

- Ancla: 2026-11-02T13:53:09Z = 02/11 14:53:09 Madrid.
- Límite para iniciar Checkout: 2026-11-02T13:08:09Z = 02/11 14:08:09 Madrid.
- promo_ends_before: 2027-01-02T13:53:09Z.
- No desplazar fechas ni recrear oferta tardía sin otra autorización comercial.

## GO por etapas, independientes

Antes de pedir cada GO, aportar SHA/identificadores, diff o salida de simulación sin secretos, resultado del paso anterior y reversión. Ninguna autorización de una etapa autoriza las demás.

| GO | Alcance exacto | Evidencia previa y criterio de salida |
| --- | --- | --- |
| T | Integración y publicación SOLO gestcopy-staging, variable no secreta BILLING_RETURN_APP_ORIGIN SOLO Preview/rama gestcopy-staging; Stripe Test, tenants sintéticos y S10 | CI verde de SHA combinado; rama staging sin cambios concurrentes; validar cinco retornos y rechazos, webhook, único Pro, converted_to_stripe, redeemed, holds=0, derechos y 50 GiB, portal Basic/cancelar, aislamiento. SMTP necesita su procedimiento propio si no funciona. No tocar demo/e2e suscripciones existentes sin alcance concreto. |
| L0 | Merge de PR aprobadas (retornos, #161, #158 en orden revisado) y único deploy Production del SHA final | S10/retornos PASS o aceptación expresa y documentada del bloqueo; Release Gate de combinación 3/3 verde; copia v2 <2 h con recuperación verificada; rollback de código anotado. No migraciones. Tras publicar, verificar alias Current, salud y ausencia de Pro antes de preparar Live. |
| L1 | Solo lectura de BD Production | Confirmar migración YA aplicada, RPC/grants/RLS, catálogo, SUR4 Basic interna, activación, holds y checkout abiertos. Esta etapa no autoriza ninguna escritura. |
| L2 | Crear/reutilizar producto y precio Pro Live 79 EUR/mes y registrar billing_prices en Production | Auditoría de cuenta charges_enabled/payouts_enabled, requisitos y webhook PASS. Ejecutar primero bootstrap-stripe-catalog --plan pro --inspect/simulación. GO debe identificar cuenta, producto/precio y fila a registrar. Una lectura posterior debe confirmar importe/modo y ausencia de duplicados. |
| L3a | Crear/reutilizar configuración portal Pro→Basic en Stripe Live | Portal Basic por defecto sin cambio de plan; precios Basic/Pro verificados; vista previa del script portal. Cambio a Basic/cancelación al final del periodo, sin prorrateo. Registrar bpc_ exacto. |
| L3b | Configurar STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE SOLO Vercel Production y redesplegar | GO identifica bpc_ validado y SHA exacto sin cambios de código. Verificación posterior de configuración y deploy Current. Obligatorio antes de contratar. |
| L4 | Crear cupón gestcopy-sur4-pro-39 en Live | Simulación de tenant-billing-offer coupon: amount_off=4000 EUR, repeating 2 meses, max_redemptions=1, producto Pro exacto, redeem_by ancla. GO exacto antes de --confirm-live. Verificación de lectura. |
| L5 | Cambiar SOLO la activación de la suscripción interna SUR4 a ready_for_checkout | Prelectura: id, Basic interna vigente, sin Stripe actual/holds ni sesiones abiertas. GO debe indicar tenant, fila, motivo y autor. No cambia plan ni fecha del trial. |
| L6 | Conceder SOLO la oferta SUR4 en Production | Simulación grant con cupón, fechas, términos y contract_deadline exactos. GO antes de --confirm-live. Tras conceder, leer oferta, hash y derechos; todavía sin crear Checkout. |
| L7 | Contratación real por el Owner de SUR4 | Owner lee/acepta y completa Checkout antes de 02/11 14:08:09 Madrid. La ejecuta el Owner. Sin pruebas ni cargos Live por el agente; sin cambiar la suscripción desde scripts. |
| L8 | Solo lectura después de contratación | Eventos procesados/idempotencia; una única Stripe Pro vigente; interna converted_to_stripe; oferta redeemed; holds=0; 50 GiB y derechos correctos con importación retenida según política actual. Correlacionar ids sin PII ni secretos. No resend Live sin GO adicional. |
| L9 | Recordatorio del 01 al 15/12 | Borrador del runbook. El envío requiere autorización específica; no programado ni enviado por esta sesión. |

## Criterio de NO-GO

Si falta acceso, CI, correo/S10, E2E, copia, auditoría Live, portal, coherencia de fechas o una autorización: detener únicamente esa etapa y registrar evidencia. No saltarse bloqueos del runbook ni reutilizar GO históricos para nuevas escrituras.

Antes del pago: reversión independiente autorizada (revocar oferta, devolver activación y retirar cupón). Después del pago: toda cancelación/reembolso requiere decisión del propietario. No borrar datos del tenant.
