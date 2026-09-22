import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing/stripe";
import {
  CHECKOUT_IDEMPOTENCY_KEY_PREFIX,
  checkoutIdempotencyKey,
  reservedExpiresAtUnix,
} from "@/lib/billing/checkout-attempts-keys";

export {
  CHECKOUT_IDEMPOTENCY_KEY_PREFIX,
  checkoutIdempotencyKey,
  reservedExpiresAtUnix,
};
export const CHECKOUT_PROCESSING_CODE = "checkout_processing";

export type PreparedCheckoutAttemptV2 =
  | {
      outcome: "reserved";
      attemptId: string;
      idempotencyKey: string;
      expiresAt: string;
    }
  | {
      outcome: "reuse";
      attemptId: string;
      sessionId: string;
      expiresAt: string | null;
      idempotencyKey: string;
    }
  | { outcome: "current_subscription_exists" }
  | {
      outcome: "checkout_processing";
      attemptId: string | null;
      sessionId: string | null;
    };

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

export async function prepareCheckoutAttempt(input: {
  tenantId: string;
  planCode?: string;
  billingInterval?: string;
  flow?: "billing" | "onboarding";
}): Promise<PreparedCheckoutAttemptV2> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "prepare_billing_checkout_attempt_v2",
    {
      p_tenant_id: input.tenantId,
      p_plan_code: input.planCode ?? null,
      p_billing_interval: input.billingInterval ?? null,
      p_flow: input.flow ?? "billing",
    }
  );

  if (error) {
    throw new Error(`Failed to prepare checkout attempt: ${error.message}`);
  }

  const record = asRecord(data);

  if (record.outcome === "current_subscription_exists") {
    return { outcome: "current_subscription_exists" };
  }

  if (record.outcome === "checkout_processing") {
    return {
      outcome: "checkout_processing",
      attemptId: typeof record.attempt_id === "string" ? record.attempt_id : null,
      sessionId:
        typeof record.provider_session_id === "string"
          ? record.provider_session_id
          : null,
    };
  }

  if (
    record.outcome === "reserved" &&
    typeof record.attempt_id === "string" &&
    typeof record.idempotency_key === "string" &&
    typeof record.expires_at === "string"
  ) {
    return {
      outcome: "reserved",
      attemptId: record.attempt_id,
      idempotencyKey: record.idempotency_key,
      expiresAt: record.expires_at,
    };
  }

  if (
    record.outcome === "reuse" &&
    typeof record.attempt_id === "string" &&
    typeof record.provider_session_id === "string"
  ) {
    return {
      outcome: "reuse",
      attemptId: record.attempt_id,
      sessionId: record.provider_session_id,
      expiresAt:
        typeof record.expires_at === "string" ? record.expires_at : null,
      idempotencyKey:
        typeof record.idempotency_key === "string"
          ? record.idempotency_key
          : checkoutIdempotencyKey(record.attempt_id),
    };
  }

  throw new Error("Unexpected checkout attempt prepare result");
}

export async function attachCheckoutSession(input: {
  attemptId: string;
  sessionId: string;
  expiresAt: Date;
}): Promise<{ outcome: "attached"; sessionId: string; idempotent: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "attach_billing_checkout_session_v2",
    {
      p_attempt_id: input.attemptId,
      p_provider_session_id: input.sessionId,
      p_expires_at: input.expiresAt.toISOString(),
    }
  );

  if (error) {
    throw new Error(`Failed to attach checkout session: ${error.message}`);
  }

  const record = asRecord(data);

  if (
    record.outcome === "attached" &&
    typeof record.provider_session_id === "string"
  ) {
    return {
      outcome: "attached",
      sessionId: record.provider_session_id,
      idempotent: record.idempotent === true,
    };
  }

  throw new Error(
    `Unexpected checkout session attach result: ${String(record.reason ?? record.outcome)}`
  );
}

export async function finalizeCheckoutAttempt(input: {
  attemptId?: string | null;
  sessionId?: string | null;
  status: "completed" | "expired" | "canceled";
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("finalize_billing_checkout_attempt_v2", {
    p_attempt_id: input.attemptId ?? null,
    p_provider_session_id: input.sessionId ?? null,
    p_status: input.status,
  });

  if (error) {
    console.error("[billing.checkout] finalize attempt failed", {
      message: error.message,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
    });
  }
}

export type ResolveReusableResult =
  | { kind: "open"; url: string; sessionId: string }
  | { kind: "processing"; sessionId: string }
  | { kind: "expired"; sessionId: string }
  | { kind: "retryable"; sessionId: string; cause: unknown };

/**
 * Resolve a stored open Checkout Session.
 * Transient Stripe retrieve errors must NOT mark the attempt expired.
 */
export async function resolveReusableCheckoutSession(input: {
  attemptId: string;
  sessionId: string;
}): Promise<ResolveReusableResult> {
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(input.sessionId);
  } catch (error) {
    console.error("[billing.checkout] reuse retrieve failed (retryable)", {
      message: error instanceof Error ? error.message : "unknown",
      sessionId: input.sessionId,
      attemptId: input.attemptId,
    });
    return {
      kind: "retryable",
      sessionId: input.sessionId,
      cause: error,
    };
  }

  if (session.status === "open" && session.url) {
    return {
      kind: "open",
      url: session.url,
      sessionId: session.id,
    };
  }

  if (session.status === "complete") {
    await finalizeCheckoutAttempt({
      attemptId: input.attemptId,
      sessionId: session.id,
      status: "completed",
    });
    return { kind: "processing", sessionId: session.id };
  }

  if (session.status === "expired") {
    await finalizeCheckoutAttempt({
      attemptId: input.attemptId,
      sessionId: session.id,
      status: "expired",
    });
    return { kind: "expired", sessionId: session.id };
  }

  await finalizeCheckoutAttempt({
    attemptId: input.attemptId,
    sessionId: session.id,
    status: "canceled",
  });
  return { kind: "expired", sessionId: session.id };
}
