import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripe } from "@/lib/billing/stripe";
import { assertStripeConfig } from "@/lib/billing/stripe-config";
import { stripeEventCreatedAt } from "@/lib/billing/stripe-status";
import {
  finalizeWebhookEvent,
  processStripeEvent,
  recordWebhookEventReceived,
} from "@/lib/billing/webhook";

function objectIdFromEvent(event: Stripe.Event): string | null {
  const object = event.data?.object as { id?: unknown } | undefined;
  return typeof object?.id === "string" ? object.id : null;
}

export async function POST(request: NextRequest) {
  const config = assertStripeConfig();
  if (!config.ok) {
    return new NextResponse("Billing is not configured", { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new NextResponse("Missing stripe-signature", { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.webhookSecret
    );
  } catch (error) {
    console.error("[POST /api/webhooks/stripe] invalid signature", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    const recorded = await recordWebhookEventReceived({
      providerEventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      providerCreatedAt: stripeEventCreatedAt(event.created),
      objectId: objectIdFromEvent(event),
    });

    if (recorded === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const result = await processStripeEvent({
      stripe: getStripe(),
      event,
    });

    await finalizeWebhookEvent({
      providerEventId: event.id,
      status: result.status,
      errorCode: result.errorCode,
    });

    // Always 200 after accepted+recorded so Stripe does not retry forever on
    // business failures we already persisted as failed.
    return NextResponse.json({
      received: true,
      status: result.status,
      error_code: result.errorCode ?? null,
    });
  } catch (error) {
    console.error("[POST /api/webhooks/stripe] processing failed", {
      message: error instanceof Error ? error.message : "unknown",
      eventId: event.id,
    });
    try {
      await finalizeWebhookEvent({
        providerEventId: event.id,
        status: "failed",
        errorCode: "processing_exception",
      });
    } catch {
      // ignore secondary failure
    }
    return new NextResponse("Webhook processing error", { status: 500 });
  }
}
