/**
 * Pure parts of the billing reconciliation alert (no server-only imports).
 */
export const BILLING_RECONCILIATION_LOG_TAG = "[billing.reconciliation]";

export type BillingReconciliationAlert = {
  kind: "subscription_held";
  tenantId: string;
  providerSubscriptionId: string;
  livemode: boolean;
  eventId: string;
  holdId: string | null;
  /** True when this event opened (or reopened) the hold. */
  firstOccurrence: boolean;
};

export function billingAlertRecipient(): string | null {
  const value = process.env.BILLING_ALERT_EMAIL?.trim();
  return value ? value : null;
}

export function buildBillingReconciliationText(alert: BillingReconciliationAlert): string {
  return [
    "Gestcopy · conciliación de facturación pendiente",
    "",
    "Stripe ha confirmado una suscripción vigente para un tenant con una suscripción interna protegida.",
    "No se ha registrado en local: el cobro existe en Stripe y no se reintentará automáticamente.",
    "",
    `Tenant: ${alert.tenantId}`,
    `Suscripción de Stripe: ${alert.providerSubscriptionId} (${alert.livemode ? "Live" : "Test"})`,
    `Evento: ${alert.eventId}`,
    `Retención: ${alert.holdId ?? "sin id"}`,
    "",
    "Revisar con list_billing_reconciliation_v1() y resolver con",
    "requeue_billing_subscription_hold_v1 o resolve_billing_subscription_hold_v1.",
    "Mientras siga pendiente, el tenant no puede iniciar un nuevo checkout.",
  ].join("\n");
}
