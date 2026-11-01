/** Pure helpers for Checkout idempotency (no Stripe / server-only). */

export const CHECKOUT_IDEMPOTENCY_KEY_PREFIX = "gestcopy-checkout:";

export function checkoutIdempotencyKey(attemptId: string): string {
  return `${CHECKOUT_IDEMPOTENCY_KEY_PREFIX}${attemptId}`;
}

export type ExpectedCheckoutSession = {
  planCode: string;
  offerId: string | null;
  termsHash: string | null;
};

/**
 * An open Checkout Session is reused only when it sells what is asked now:
 * same plan, same offer (or none) and same accepted terms. Sessions created
 * before offers existed carry no offer metadata and match a plain Checkout.
 */
export function checkoutSessionMatches(
  metadata: Record<string, string> | null | undefined,
  expected: ExpectedCheckoutSession
): boolean {
  const meta = metadata ?? {};
  return (
    (meta.plan_code ?? null) === expected.planCode &&
    (meta.offer_id ?? null) === expected.offerId &&
    (meta.offer_terms_hash ?? null) === expected.termsHash
  );
}

/** Unix seconds for Stripe Checkout `expires_at` from a reserved ISO timestamp. */
export function reservedExpiresAtUnix(expiresAtIso: string): number {
  const ms = Date.parse(expiresAtIso);
  if (!Number.isFinite(ms)) {
    throw new Error("Invalid reserved checkout expires_at");
  }
  return Math.floor(ms / 1000);
}
