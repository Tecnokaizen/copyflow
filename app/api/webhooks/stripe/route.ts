import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripe } from "@/lib/billing/stripe";
import { assertStripeConfig } from "@/lib/billing/stripe-config";
import { stripeEventCreatedAt } from "@/lib/billing/stripe-status";
import {
  claimWebhookEvent,
  finalizeWebhookEvent,
  isRetryableWebhookFailure,
  processStripeEvent,
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
    const claim = await claimWebhookEvent({
      providerEventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      providerCreatedAt: stripeEventCreatedAt(event.created),
      objectId: objectIdFromEvent(event),
    });

    if (claim.outcome === "already_final") {
      return NextResponse.json({
        received: true,
        duplicate: true,
        status: claim.status ?? null,
      });
    }

    if (claim.outcome === "in_progress") {
      return NextResponse.json({
        received: true,
        in_progress: true,
      });
    }

    if (claim.outcome !== "claimed") {
      return new NextResponse("Could not claim webhook event", { status: 500 });
    }

    const result = await processStripeEvent({
      stripe: getStripe(),
      event,
    });

    const retryable =
      result.status === "failed"
        ? (result.retryable ?? isRetryableWebhookFailure(result.errorCode))
        : false;

    await finalizeWebhookEvent({
      providerEventId: event.id,
      status: result.status,
      errorCode: result.errorCode,
      retryable,
    });

    if (result.status === "failed" && retryable) {
      return new NextResponse("Webhook processing retryable failure", {
        status: 500,
      });
    }

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
        retryable: true,
      });
    } catch {
      // ignore secondary failure
    }
    return new NextResponse("Webhook processing error", { status: 500 });
  }
}
