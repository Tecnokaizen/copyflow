import "server-only";

import Stripe from "stripe";

import {
  assertStripeConfig,
  getStripeMode,
  stripeModeToLivemode,
  type StripeConfig,
  type StripeMode,
} from "@/lib/billing/stripe-config";

export type { StripeConfig, StripeMode };
export { assertStripeConfig, getStripeMode, stripeModeToLivemode };

let stripeSingleton: Stripe | null = null;

/**
 * Lazy Stripe SDK client. Throws only when invoked without config —
 * importing this module must not fail builds that lack Stripe env.
 */
export function getStripe(): Stripe {
  const config = assertStripeConfig();

  if (!config.ok) {
    throw new Error(`Stripe is not configured (${config.reason})`);
  }

  if (!stripeSingleton) {
    stripeSingleton = new Stripe(config.secretKey, {
      apiVersion: "2026-08-26.dahlia",
      typescript: true,
      appInfo: {
        name: "Gestcopy",
        version: "billing-v1",
      },
    });
  }

  return stripeSingleton;
}

/** Test helper: clear cached client between cases. */
export function resetStripeClientForTests() {
  stripeSingleton = null;
}
