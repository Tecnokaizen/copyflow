import "server-only";

import Stripe from "stripe";

import { activateTenantAfterBilling } from "@/lib/onboarding/activate";
import { isQualifyingActivationStatus } from "@/lib/onboarding/pending-tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePlanFromStripePriceId } from "@/lib/billing/resolve-plan-from-price";
import {
  mapStripeSubscriptionStatus,
  stripeEventCreatedAt,
} from "@/lib/billing/stripe-status";
import { stripeCancelAtToIso } from "@/lib/billing/cancellation-display";
import { resolveTenantIdFromWebhookSources } from "@/lib/billing/tenant-from-webhook";
import { isRetryableWebhookFailure } from "@/lib/billing/webhook-errors";

export type WebhookProcessResult = {
  status: "processed" | "ignored" | "failed";
  errorCode?: string;
  retryable?: boolean;
};

export type WebhookClaimOutcome =
  | "claimed"
  | "already_final"
  | "in_progress"
  | "rejected";

export { isRetryableWebhookFailure };

const SUPPORTED_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

function customerIdFrom(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) {
    return null;
  }
  if (typeof customer === "string") {
    return customer;
  }
  if ("deleted" in customer && customer.deleted) {
    return customer.id ?? null;
  }
  return customer.id ?? null;
}

function primaryPriceId(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  if (!price) {
    return null;
  }
  return typeof price === "string" ? price : price.id;
}

function periodBounds(subscription: Stripe.Subscription): {
  start: string | null;
  end: string | null;
} {
  const item = subscription.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;

  const startSec =
    item?.current_period_start ??
    (subscription as { current_period_start?: number }).current_period_start;
  const endSec =
    item?.current_period_end ??
    (subscription as { current_period_end?: number }).current_period_end;

  return {
    start:
      typeof startSec === "number"
        ? new Date(startSec * 1000).toISOString()
        : null,
    end:
      typeof endSec === "number" ? new Date(endSec * 1000).toISOString() : null,
  };
}

function resolveTenantIdFromSources(input: {
  subscriptionTenantId: string | null | undefined;
  sessionClientReferenceId: string | null | undefined;
  sessionMetadataTenantId: string | null | undefined;
}): { ok: true; tenantId: string } | { ok: false; errorCode: string } {
  return resolveTenantIdFromWebhookSources(input);
}

async function tenantExists(tenantId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load tenant: ${error.message}`);
  }

  return Boolean(data?.id);
}

async function syncSubscriptionFromStripe(input: {
  subscription: Stripe.Subscription;
  livemode: boolean;
  eventCreatedAt: Date | null;
  sessionClientReferenceId?: string | null;
  sessionMetadataTenantId?: string | null;
}): Promise<WebhookProcessResult> {
  const subscription = input.subscription;
  const tenantResolve = resolveTenantIdFromSources({
    subscriptionTenantId: subscription.metadata?.tenant_id,
    sessionClientReferenceId: input.sessionClientReferenceId,
    sessionMetadataTenantId: input.sessionMetadataTenantId,
  });

  if (!tenantResolve.ok) {
    return {
      status: "failed",
      errorCode: tenantResolve.errorCode,
      retryable: false,
    };
  }

  if (!(await tenantExists(tenantResolve.tenantId))) {
    return {
      status: "failed",
      errorCode: "tenant_not_found",
      retryable: false,
    };
  }

  const priceId = primaryPriceId(subscription);
  if (!priceId) {
    return {
      status: "failed",
      errorCode: "missing_price_id",
      retryable: false,
    };
  }

  const plan = await resolvePlanFromStripePriceId({
    providerPriceId: priceId,
    livemode: input.livemode,
  });

  if (!plan) {
    return {
      status: "failed",
      errorCode: "unknown_price_mapping",
      retryable: false,
    };
  }

  const status = mapStripeSubscriptionStatus(subscription.status);
  if (!status) {
    return {
      status: "failed",
      errorCode: "unmapped_subscription_status",
      retryable: false,
    };
  }

  const customerId = customerIdFrom(subscription.customer);
  const period = periodBounds(subscription);
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("sync_billing_subscription_v1", {
    p_tenant_id: tenantResolve.tenantId,
    p_plan_id: plan.planId,
    p_provider: "stripe",
    p_provider_customer_id: customerId,
    p_provider_subscription_id: subscription.id,
    p_status: status,
    p_current_period_start: period.start,
    p_current_period_end: period.end,
    p_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    p_metadata: {
      stripe_status: subscription.status,
      plan_code: plan.planCode,
    },
    p_provider_event_created_at: input.eventCreatedAt?.toISOString() ?? null,
    p_cancel_at: stripeCancelAtToIso(subscription.cancel_at),
  });

  if (error) {
    console.error("[billing.webhook] sync_billing_subscription_v1 failed", {
      message: error.message,
      code: error.code,
    });
    return {
      status: "failed",
      errorCode: "sync_rpc_failed",
      retryable: true,
    };
  }

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (data as { stale?: boolean }).stale === true
  ) {
    return { status: "ignored", errorCode: "stale_event", retryable: false };
  }

  if (isQualifyingActivationStatus(status)) {
    const activation = await activateTenantAfterBilling({
      tenantId: tenantResolve.tenantId,
      providerSubscriptionId: subscription.id,
      subscriptionStatus: status,
    });

    if (!activation) {
      return {
        status: "failed",
        errorCode: "tenant_activation_failed",
        retryable: true,
      };
    }

    if (
      activation.outcome === "rejected" &&
      activation.reason === "tenant_not_found"
    ) {
      return {
        status: "failed",
        errorCode: "tenant_not_found",
        retryable: false,
      };
    }
  }

  return { status: "processed" };
}

async function loadStripeSubscription(
  stripe: Stripe,
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
}

export async function processStripeEvent(input: {
  stripe: Stripe;
  event: Stripe.Event;
}): Promise<WebhookProcessResult> {
  const { stripe, event } = input;

  if (!SUPPORTED_TYPES.has(event.type)) {
    return {
      status: "ignored",
      errorCode: "unsupported_event_type",
      retryable: false,
    };
  }

  const eventCreatedAt = stripeEventCreatedAt(event.created);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") {
        return {
          status: "ignored",
          errorCode: "checkout_not_subscription",
          retryable: false,
        };
      }

      const subscriptionRef = session.subscription;
      const subscriptionId =
        typeof subscriptionRef === "string"
          ? subscriptionRef
          : subscriptionRef?.id;

      if (!subscriptionId) {
        return {
          status: "failed",
          errorCode: "checkout_missing_subscription",
          retryable: false,
        };
      }

      const subscription = await loadStripeSubscription(stripe, subscriptionId);
      return syncSubscriptionFromStripe({
        subscription,
        livemode: event.livemode,
        eventCreatedAt,
        sessionClientReferenceId: session.client_reference_id,
        sessionMetadataTenantId: session.metadata?.tenant_id,
      });
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      return syncSubscriptionFromStripe({
        subscription,
        livemode: event.livemode,
        eventCreatedAt,
      });
    }

    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_failed"
    ) {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionRef =
        (invoice as { subscription?: string | Stripe.Subscription | null })
          .subscription ?? null;
      const subscriptionId =
        typeof subscriptionRef === "string"
          ? subscriptionRef
          : subscriptionRef && typeof subscriptionRef === "object"
            ? subscriptionRef.id
            : null;

      if (!subscriptionId) {
        return {
          status: "ignored",
          errorCode: "invoice_without_subscription",
          retryable: false,
        };
      }

      const subscription = await loadStripeSubscription(stripe, subscriptionId);
      return syncSubscriptionFromStripe({
        subscription,
        livemode: event.livemode,
        eventCreatedAt,
      });
    }

    return {
      status: "ignored",
      errorCode: "unsupported_event_type",
      retryable: false,
    };
  } catch (error) {
    console.error("[billing.webhook] processStripeEvent exception", {
      message: error instanceof Error ? error.message : "unknown",
      type: event.type,
    });
    return {
      status: "failed",
      errorCode: "processing_exception",
      retryable: true,
    };
  }
}

export async function claimWebhookEvent(input: {
  providerEventId: string;
  eventType: string;
  livemode: boolean;
  providerCreatedAt: Date | null;
  objectId: string | null;
}): Promise<{
  outcome: WebhookClaimOutcome;
  status?: string;
  retryable?: boolean;
  errorCode?: string;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_billing_webhook_event_v1", {
    p_provider: "stripe",
    p_provider_event_id: input.providerEventId,
    p_event_type: input.eventType,
    p_livemode: input.livemode,
    p_provider_created_at: input.providerCreatedAt?.toISOString() ?? null,
    p_object_id: input.objectId,
  });

  if (error) {
    throw new Error(`Failed to claim webhook event: ${error.message}`);
  }

  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  const outcome =
    typeof record.outcome === "string"
      ? (record.outcome as WebhookClaimOutcome)
      : "rejected";

  return {
    outcome,
    status: typeof record.status === "string" ? record.status : undefined,
    retryable:
      typeof record.retryable === "boolean" ? record.retryable : undefined,
    errorCode:
      typeof record.error_code === "string" ? record.error_code : undefined,
  };
}

/** @deprecated use claimWebhookEvent — kept for source-compat in older tests */
export async function recordWebhookEventReceived(input: {
  providerEventId: string;
  eventType: string;
  livemode: boolean;
  providerCreatedAt: Date | null;
  objectId: string | null;
}): Promise<"inserted" | "duplicate"> {
  const claim = await claimWebhookEvent(input);
  if (claim.outcome === "claimed" && !("reclaimed" in (claim as object))) {
    return "inserted";
  }
  return "duplicate";
}

export async function finalizeWebhookEvent(input: {
  providerEventId: string;
  status: "processed" | "ignored" | "failed";
  errorCode?: string;
  retryable?: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  const retryable =
    input.status === "failed"
      ? (input.retryable ?? isRetryableWebhookFailure(input.errorCode))
      : false;

  const { error } = await admin.rpc("finalize_billing_webhook_event_v1", {
    p_provider: "stripe",
    p_provider_event_id: input.providerEventId,
    p_status: input.status,
    p_error_code: input.errorCode ?? null,
    p_retryable: retryable,
  });

  if (error) {
    throw new Error(`Failed to finalize webhook event: ${error.message}`);
  }
}
