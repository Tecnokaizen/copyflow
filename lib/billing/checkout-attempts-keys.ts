/** Pure helpers for Checkout idempotency (no Stripe / server-only). */

export const CHECKOUT_IDEMPOTENCY_KEY_PREFIX = "gestcopy-checkout:";

export function checkoutIdempotencyKey(attemptId: string): string {
  return `${CHECKOUT_IDEMPOTENCY_KEY_PREFIX}${attemptId}`;
}
