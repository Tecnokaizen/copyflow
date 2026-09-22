import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHECKOUT_IDEMPOTENCY_KEY_PREFIX,
  checkoutIdempotencyKey,
  reservedExpiresAtUnix,
} from "./checkout-attempts-keys";
import { CHECKOUT_PROCESSING_CODE } from "./webhook-errors";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("checkout idempotency hardening", () => {
  it("builds attempt-scoped Stripe idempotency keys (B/C)", () => {
    const a = checkoutIdempotencyKey("11111111-1111-4111-8111-111111111111");
    const b = checkoutIdempotencyKey("22222222-2222-4222-8222-222222222222");
    assert.equal(a, "gestcopy-checkout:11111111-1111-4111-8111-111111111111");
    assert.equal(b, "gestcopy-checkout:22222222-2222-4222-8222-222222222222");
    assert.notEqual(a, b);
    assert.ok(a.startsWith(CHECKOUT_IDEMPOTENCY_KEY_PREFIX));
  });

  it("maps reserved ISO expiry to Stripe expires_at unix seconds (D)", () => {
    const iso = "2030-01-15T12:00:00.000Z";
    assert.equal(reservedExpiresAtUnix(iso), 1894708800);
    assert.throws(() => reservedExpiresAtUnix("not-a-date"), /Invalid reserved/);
  });

  it("reserves DB attempt before Stripe create and passes attempt idempotency key (A/B/C)", () => {
    const checkout = readSource("lib/billing/checkout.ts");
    const attempts = readSource("lib/billing/checkout-attempts.ts");
    const migration = readSource(
      "supabase/migrations/20260922111940_paid_onboarding_checkout_idempotency_v1.sql"
    );
    const recovery = readSource(
      "supabase/migrations/20260922120000_paid_onboarding_checkout_creating_recovery_v1.sql"
    );

    assert.match(migration, /prepare_billing_checkout_attempt_v2/);
    assert.match(migration, /status = 'creating'/);
    assert.match(migration, /gestcopy-checkout:/);
    assert.match(migration, /billing_checkout_attempts_one_active_per_tenant/);
    assert.match(
      migration,
      /array\['creating'::text, 'open'::text, 'completed'::text\]/
    );

    assert.match(attempts, /prepare_billing_checkout_attempt_v2/);
    assert.match(attempts, /attach_billing_checkout_session_v2/);
    assert.match(checkout, /prepareCheckoutAttempt/);
    assert.match(checkout, /idempotencyKey/);
    assert.match(checkout, /\{\s*idempotencyKey:\s*input\.idempotencyKey\s*\}/);
    assert.match(checkout, /expires_at:\s*expiresAtUnix/);
    assert.match(checkout, /reservedExpiresAtUnix/);
    assert.match(checkout, /expiresAt:\s*prepared\.expiresAt/);
    // No best-effort expire of a losing second Stripe session.
    assert.doesNotMatch(checkout, /sessions\.expire/);
    // Subscription gate lives in prepare RPC outcome.
    assert.match(checkout, /current_subscription_exists/);
    assert.match(checkout, /CheckoutProcessingError/);

    // Creating recovery: no created_at-only soft lease.
    assert.doesNotMatch(recovery, /created_at <= .*5 minutes/);
    assert.match(recovery, /expires_at \+ v_expiry_grace/);
    assert.match(recovery, /'expires_at', v_active\.expires_at/);
  });

  it("registration attaches to the reserved attempt (D)", () => {
    const attempts = readSource("lib/billing/checkout-attempts.ts");
    const migration = readSource(
      "supabase/migrations/20260922111940_paid_onboarding_checkout_idempotency_v1.sql"
    );
    assert.match(attempts, /attachCheckoutSession/);
    assert.match(migration, /attach_billing_checkout_session_v2/);
    assert.match(migration, /idempotent', true/);
    assert.doesNotMatch(attempts, /register_billing_checkout_attempt_v1/);
  });

  it("Stripe retrieve errors stay retryable and do not expire (E/F)", () => {
    const attempts = readSource("lib/billing/checkout-attempts.ts");
    const checkout = readSource("lib/billing/checkout.ts");

    const retrieveFn = attempts.slice(
      attempts.indexOf("export async function resolveReusableCheckoutSession")
    );
    const catchStart = retrieveFn.indexOf("} catch");
    const afterCatch = retrieveFn.indexOf(
      'if (session.status === "open"',
      catchStart
    );
    const catchBlock = retrieveFn.slice(catchStart, afterCatch);
    assert.match(catchBlock, /kind:\s*"retryable"/);
    assert.doesNotMatch(catchBlock, /finalizeCheckoutAttempt/);
    assert.doesNotMatch(catchBlock, /status:\s*"expired"/);

    assert.match(checkout, /CheckoutTransientError/);
    assert.match(checkout, /resolved\.kind === "retryable"/);
    assert.match(checkout, /throw new CheckoutTransientError/);
  });

  it("explicit expired allows a new attempt; complete blocks create (G/H/I)", () => {
    const attempts = readSource("lib/billing/checkout-attempts.ts");
    const checkout = readSource("lib/billing/checkout.ts");
    const migration = readSource(
      "supabase/migrations/20260922111940_paid_onboarding_checkout_idempotency_v1.sql"
    );

    assert.match(attempts, /session\.status === "expired"/);
    assert.match(attempts, /status: "expired"/);
    assert.match(attempts, /session\.status === "complete"/);
    assert.match(attempts, /kind: "processing"/);
    assert.match(checkout, /CheckoutProcessingError/);
    assert.match(migration, /checkout_processing/);
    assert.equal(CHECKOUT_PROCESSING_CODE, "checkout_processing");
  });

  it("routes and UI expose checkout_processing stably (H/J)", () => {
    const billingRoute = readSource(
      "app/api/billing/checkout-session/route.ts"
    );
    const onboardingRoute = readSource("app/api/onboarding/route.ts");
    const onboardingErrors = readSource("lib/onboarding/errors.ts");
    const billingUi = readSource("components/settings/billing-settings.tsx");

    assert.match(billingRoute, /CHECKOUT_PROCESSING_CODE/);
    assert.match(billingRoute, /CheckoutTransientError[\s\S]*,\s*503\)/);
    assert.match(onboardingRoute, /CHECKOUT_PROCESSING_CODE/);
    assert.match(
      onboardingErrors,
      /Estamos confirmando tu suscripción/
    );
    assert.match(
      billingUi,
      /Estamos confirmando tu suscripción/
    );
    assert.match(billingRoute, /CURRENT_SUBSCRIPTION_EXISTS_CODE/);
  });

  it("phase28/29 suites exist and CI runs them (K)", () => {
    const phase28 = readSource(
      "supabase/tests/phase28_paid_onboarding_checkout_idempotency.sql"
    );
    const phase29 = readSource(
      "supabase/tests/phase29_paid_onboarding_checkout_creating_recovery.sql"
    );
    const workflow = readSource(".github/workflows/kiosk-supabase.yml");
    assert.match(phase28, /DEMO mutated/);
    assert.match(phase28, /SUR4 mutated/);
    assert.match(phase28, /current_subscription_exists/);
    assert.match(phase28, /checkout_processing/);
    assert.match(phase29, /attach-fail recovery/);
    assert.match(phase29, /past-expiry creating must be expired/);
    assert.match(phase29, /DEMO mutated/);
    assert.match(
      workflow,
      /phase28_paid_onboarding_checkout_idempotency\.sql/
    );
    assert.match(
      workflow,
      /phase29_paid_onboarding_checkout_creating_recovery\.sql/
    );
  });
});
