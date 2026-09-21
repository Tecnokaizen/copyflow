import "server-only";

import Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePlanFromStripePriceId } from "@/lib/billing/resolve-plan-from-price";
import {
  mapStripeSubscriptionStatus,
  stripeEventCreatedAt,
} from "@/lib/billing/stripe-status";
import { stripeCancelAtToIso } from "@/lib/billing/cancellation-display";
import { resolveTenantIdFromWebhookSources } from "@/lib/billing/tenant-from-webhook";

export type WebhookProcessResult = {
  status: "processed" | "ignored" | "failed";
  errorCode?: string;
};

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
    return { status: "failed", errorCode: tenantResolve.errorCode };
  }

  if (!(await tenantExists(tenantResolve.tenantId))) {
    return { status: "failed", errorCode: "tenant_not_found" };
  }

  const priceId = primaryPriceId(subscription);
  if (!priceId) {
    return { status: "failed", errorCode: "missing_price_id" };
  }

  const plan = await resolvePlanFromStripePriceId({
    providerPriceId: priceId,
    livemode: input.livemode,
  });

  if (!plan) {
    return { status: "failed", errorCode: "unknown_price_mapping" };
  }

  const status = mapStripeSubscriptionStatus(subscription.status);
  if (!status) {
    return { status: "failed", errorCode: "unmapped_subscription_status" };
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
    return { status: "failed", errorCode: "sync_rpc_failed" };
  }

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (data as { stale?: boolean }).stale === true
  ) {
    return { status: "ignored", errorCode: "stale_event" };
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
    return { status: "ignored", errorCode: "unsupported_event_type" };
  }

  const eventCreatedAt = stripeEventCreatedAt(event.created);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription") {
      return { status: "ignored", errorCode: "checkout_not_subscription" };
    }

    const subscriptionRef = session.subscription;
    const subscriptionId =
      typeof subscriptionRef === "string"
        ? subscriptionRef
        : subscriptionRef?.id;

    if (!subscriptionId) {
      return { status: "failed", errorCode: "checkout_missing_subscription" };
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
    // deleted still carries final status (usually canceled)
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
      return { status: "ignored", errorCode: "invoice_without_subscription" };
    }

    const subscription = await loadStripeSubscription(stripe, subscriptionId);
    return syncSubscriptionFromStripe({
      subscription,
      livemode: event.livemode,
      eventCreatedAt,
    });
  }

  return { status: "ignored", errorCode: "unsupported_event_type" };
}

export async function recordWebhookEventReceived(input: {
  providerEventId: string;
  eventType: string;
  livemode: boolean;
  providerCreatedAt: Date | null;
  objectId: string | null;
}): Promise<"inserted" | "duplicate"> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_webhook_events").insert({
    provider: "stripe",
    provider_event_id: input.providerEventId,
    event_type: input.eventType,
    livemode: input.livemode,
    provider_created_at: input.providerCreatedAt?.toISOString() ?? null,
    object_id: input.objectId,
    status: "received",
  });

  if (error) {
    if (error.code === "23505") {
      return "duplicate";
    }
    throw new Error(`Failed to record webhook event: ${error.message}`);
  }

  return "inserted";
}

export async function finalizeWebhookEvent(input: {
  providerEventId: string;
  status: "processed" | "ignored" | "failed";
  errorCode?: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_webhook_events")
    .update({
      status: input.status,
      error_code: input.errorCode ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("provider", "stripe")
    .eq("provider_event_id", input.providerEventId);

  if (error) {
    throw new Error(`Failed to finalize webhook event: ${error.message}`);
  }
}
