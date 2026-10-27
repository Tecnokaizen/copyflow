const DETERMINISTIC_ERROR_CODES = new Set([
  "unsupported_event_type",
  "checkout_not_subscription",
  "checkout_missing_subscription",
  "invoice_without_subscription",
  "invoice_subscription_mismatch",
  "stripe_object_mode_mismatch",
  "stripe_mode_mismatch",
  "tenant_ref_missing",
  "tenant_ref_mismatch",
  "tenant_not_found",
  "missing_price_id",
  "unknown_price_mapping",
  "unmapped_subscription_status",
  // Held by sync_billing_subscription_v1: a current internal subscription is
  // never canceled by Stripe. Retrying cannot help until an operator acts
  // (requeue_billing_webhook_event_v1).
  "internal_subscription_current",
]);

export function isRetryableWebhookFailure(errorCode: string | undefined) {
  if (!errorCode) {
    return true;
  }
  return !DETERMINISTIC_ERROR_CODES.has(errorCode);
}

export const CURRENT_SUBSCRIPTION_EXISTS_CODE = "current_subscription_exists";
export const CHECKOUT_PROCESSING_CODE = "checkout_processing";
