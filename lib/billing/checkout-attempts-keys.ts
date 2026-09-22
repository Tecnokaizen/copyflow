/** Pure helpers for Checkout idempotency (no Stripe / server-only). */

export const CHECKOUT_IDEMPOTENCY_KEY_PREFIX = "gestcopy-checkout:";

export function checkoutIdempotencyKey(attemptId: string): string {
  return `${CHECKOUT_IDEMPOTENCY_KEY_PREFIX}${attemptId}`;
}

/** Unix seconds for Stripe Checkout `expires_at` from a reserved ISO timestamp. */
export function reservedExpiresAtUnix(expiresAtIso: string): number {
  const ms = Date.parse(expiresAtIso);
  if (!Number.isFinite(ms)) {
    throw new Error("Invalid reserved checkout expires_at");
  }
  return Math.floor(ms / 1000);
}
