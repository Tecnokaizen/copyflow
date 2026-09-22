import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing/stripe";

export type PreparedCheckoutAttempt =
  | { outcome: "reuse"; sessionId: string; expiresAt: string | null }
  | { outcome: "create" };

export async function prepareCheckoutAttempt(
  tenantId: string
): Promise<PreparedCheckoutAttempt> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "prepare_billing_checkout_attempt_v1",
    { p_tenant_id: tenantId }
  );

  if (error) {
    throw new Error(`Failed to prepare checkout attempt: ${error.message}`);
  }

  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (
    record.outcome === "reuse" &&
    typeof record.provider_session_id === "string"
  ) {
    return {
      outcome: "reuse",
      sessionId: record.provider_session_id,
      expiresAt:
        typeof record.expires_at === "string" ? record.expires_at : null,
    };
  }

  return { outcome: "create" };
}

export async function registerCheckoutAttempt(input: {
  tenantId: string;
  sessionId: string;
  expiresAt: Date;
  planCode: string;
  billingInterval: string;
}): Promise<{ outcome: "registered" | "reuse"; sessionId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "register_billing_checkout_attempt_v1",
    {
      p_tenant_id: input.tenantId,
      p_provider_session_id: input.sessionId,
      p_expires_at: input.expiresAt.toISOString(),
      p_plan_code: input.planCode,
      p_billing_interval: input.billingInterval,
    }
  );

  if (error) {
    throw new Error(`Failed to register checkout attempt: ${error.message}`);
  }

  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (
    (record.outcome === "registered" || record.outcome === "reuse") &&
    typeof record.provider_session_id === "string"
  ) {
    return {
      outcome: record.outcome,
      sessionId: record.provider_session_id,
    };
  }

  throw new Error("Unexpected checkout attempt registration result");
}

export async function finalizeCheckoutAttempt(
  sessionId: string,
  status: "completed" | "expired" | "canceled"
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("finalize_billing_checkout_attempt_v1", {
    p_provider_session_id: sessionId,
    p_status: status,
  });

  if (error) {
    console.error("[billing.checkout] finalize attempt failed", {
      message: error.message,
      sessionId,
    });
  }
}

/**
 * If a stored open session is no longer usable in Stripe, mark it and allow create.
 */
export async function resolveReusableCheckoutSession(sessionId: string): Promise<
  | { ok: true; url: string; sessionId: string }
  | { ok: false }
> {
  const stripe = getStripe();
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "open" && session.url) {
      return { ok: true, url: session.url, sessionId: session.id };
    }

    const mapped =
      session.status === "complete"
        ? "completed"
        : session.status === "expired"
          ? "expired"
          : "canceled";
    await finalizeCheckoutAttempt(sessionId, mapped);
    return { ok: false };
  } catch (error) {
    console.error("[billing.checkout] reuse retrieve failed", {
      message: error instanceof Error ? error.message : "unknown",
      sessionId,
    });
    await finalizeCheckoutAttempt(sessionId, "expired");
    return { ok: false };
  }
}
