import type Stripe from "stripe";

/**
 * Resolve the Stripe Subscription id from an Invoice under API 2026-08-26.dahlia.
 *
 * Canonical: invoice.parent?.subscription_details?.subscription
 * Legacy fallback: invoice.subscription (older payloads / API versions)
 *
 * Never infer from customer.
 */
export type InvoiceSubscriptionResolve =
  | {
      ok: true;
      subscriptionId: string;
      source: "canonical" | "legacy" | "both_agree";
    }
  | {
      ok: false;
      errorCode: "invoice_without_subscription" | "invoice_subscription_mismatch";
    };

function idFromSubscriptionRef(
  ref: string | Stripe.Subscription | null | undefined
): string | null {
  if (!ref) {
    return null;
  }
  if (typeof ref === "string") {
    const trimmed = ref.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof ref === "object" && typeof ref.id === "string") {
    const trimmed = ref.id.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function legacySubscriptionRef(
  invoice: Stripe.Invoice
): string | Stripe.Subscription | null | undefined {
  // Legacy top-level field removed from modern Invoice types; retained for old payloads.
  return (invoice as { subscription?: string | Stripe.Subscription | null })
    .subscription;
}

export function subscriptionIdFromInvoice(
  invoice: Stripe.Invoice
): InvoiceSubscriptionResolve {
  const canonical = idFromSubscriptionRef(
    invoice.parent?.subscription_details?.subscription
  );
  const legacy = idFromSubscriptionRef(legacySubscriptionRef(invoice));

  if (canonical && legacy && canonical !== legacy) {
    return { ok: false, errorCode: "invoice_subscription_mismatch" };
  }

  if (canonical) {
    return {
      ok: true,
      subscriptionId: canonical,
      source: legacy ? "both_agree" : "canonical",
    };
  }

  if (legacy) {
    return { ok: true, subscriptionId: legacy, source: "legacy" };
  }

  return { ok: false, errorCode: "invoice_without_subscription" };
}
