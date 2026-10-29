import "server-only";

import { Resend } from "resend";

import { assertEmailConfigForResend, resolveEmailTransport } from "@/lib/email/env";

import {
  type BillingReconciliationAlert,
  BILLING_RECONCILIATION_LOG_TAG,
  billingAlertRecipient,
  buildBillingReconciliationText,
} from "@/lib/billing/reconciliation-alert-text";

export { BILLING_RECONCILIATION_LOG_TAG, type BillingReconciliationAlert };

/**
 * Operational alert for billing reconciliation (D1). Every call logs a
 * structured line with a stable tag (ids only, no personal data). The first
 * occurrence of a hold also emails BILLING_ALERT_EMAIL when it is configured.
 * Never throws: the webhook outcome must not depend on the alert.
 */
export async function notifyBillingReconciliation(
  alert: BillingReconciliationAlert
): Promise<{ emailed: boolean }> {
  console.error(`${BILLING_RECONCILIATION_LOG_TAG} ${alert.kind}`, {
    tenantId: alert.tenantId,
    providerSubscriptionId: alert.providerSubscriptionId,
    livemode: alert.livemode,
    eventId: alert.eventId,
    holdId: alert.holdId,
    firstOccurrence: alert.firstOccurrence,
  });

  const recipient = billingAlertRecipient();
  if (!alert.firstOccurrence || !recipient) {
    return { emailed: false };
  }

  try {
    const transport = resolveEmailTransport();
    if (transport !== "resend") {
      console.info(`${BILLING_RECONCILIATION_LOG_TAG} alert email (${transport})`, {
        holdId: alert.holdId,
      });
      return { emailed: transport === "console" };
    }

    const config = assertEmailConfigForResend();
    if (!config.ok) {
      console.error(`${BILLING_RECONCILIATION_LOG_TAG} alert email not configured`, {
        reason: config.reason,
      });
      return { emailed: false };
    }

    const resend = new Resend(config.apiKey);
    const { error } = await resend.emails.send({
      from: config.from,
      to: recipient,
      subject: "Gestcopy · conciliación de facturación pendiente",
      text: buildBillingReconciliationText(alert),
    });
    if (error) {
      console.error(`${BILLING_RECONCILIATION_LOG_TAG} alert email failed`, {
        name: error.name,
      });
      return { emailed: false };
    }
    return { emailed: true };
  } catch (error) {
    console.error(`${BILLING_RECONCILIATION_LOG_TAG} alert email exception`, {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { emailed: false };
  }
}
