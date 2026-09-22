import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripe } from "@/lib/billing/stripe";
import {
  assertStripeConfig,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";
import { stripeEventCreatedAt } from "@/lib/billing/stripe-status";
import {
  claimWebhookEvent,
  finalizeWebhookEvent,
  isRetryableWebhookFailure,
  processStripeEvent,
} from "@/lib/billing/webhook";
import { eventLivemodeMatchesExpected } from "@/lib/billing/webhook-mode";

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

  // Fail closed on Test/Live mismatch BEFORE claim or any DB write.
  const expectedLivemode = stripeModeToLivemode(config.mode);
  if (!eventLivemodeMatchesExpected(event.livemode, expectedLivemode)) {
    console.error("[POST /api/webhooks/stripe] stripe_mode_mismatch", {
      eventId: event.id,
      eventLivemode: event.livemode,
      expectedLivemode,
      stripeMode: config.mode,
    });
    return NextResponse.json(
      {
        error: "stripe_mode_mismatch",
        event_livemode: event.livemode,
        expected_livemode: expectedLivemode,
      },
      { status: 400 }
    );
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

    // Do not ACK Stripe while another worker still owns a fresh lease.
    if (claim.outcome === "in_progress") {
      return new NextResponse("Webhook event already being processed", {
        status: 503,
      });
    }

    if (claim.outcome !== "claimed" || !claim.attempt) {
      return new NextResponse("Could not claim webhook event", { status: 500 });
    }

    const processingAttempt = claim.attempt;

    const result = await processStripeEvent({
      stripe: getStripe(),
      event,
    });

    const retryable =
      result.status === "failed"
        ? (result.retryable ?? isRetryableWebhookFailure(result.errorCode))
        : false;

    const finalized = await finalizeWebhookEvent({
      providerEventId: event.id,
      status: result.status,
      errorCode: result.errorCode,
      retryable,
      processingAttempt,
    });

    if (finalized.outcome === "stale_claim") {
      // A newer claim owns the event; do not ACK — let Stripe retry if needed.
      return new NextResponse("Stale webhook claim", { status: 503 });
    }

    if (result.status === "failed" && retryable) {
      return new NextResponse("Webhook processing retryable failure", {
        status: 500,
      });
    }

    return NextResponse.json({
      received: true,
      status: result.status,
      error_code: result.errorCode ?? null,
      attempt: processingAttempt,
    });
  } catch (error) {
    console.error("[POST /api/webhooks/stripe] processing failed", {
      message: error instanceof Error ? error.message : "unknown",
      eventId: event.id,
    });
    // Without a known attempt we cannot safely finalize; return retryable.
    return new NextResponse("Webhook processing error", { status: 500 });
  }
}
