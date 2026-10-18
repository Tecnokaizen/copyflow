/**
 * Static guards for re-subscribing after cancellation
 * (20261018120000_billing_checkout_attempt_settled_v1.sql): a completed
 * attempt is settled only once its subscription was recorded and ended, the
 * RPC stays service-only, and the billing SQL suites run in the release gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const MIGRATION =
  "supabase/migrations/20261018120000_billing_checkout_attempt_settled_v1.sql";

const BILLING_GATE_SUITES = [
  "phase22_tenant_file_limits",
  "phase23_billing_foundation",
  "phase24_billing_checkout_webhook",
  "phase25_paid_onboarding",
  "phase26_paid_onboarding_security",
  "phase27_paid_onboarding_concurrency",
  "phase28_paid_onboarding_checkout_idempotency",
  "phase29_paid_onboarding_checkout_creating_recovery",
  "phase30_order_statuses_require_initial_security_definer",
  "phase31_tenant_provisioning_state",
  "phase32_stripe_live_hardening",
  "phase53_billing_checkout_resubscribe",
];

describe("checkout attempt settled after cancellation", () => {
  it("adds settled as a terminal status outside the one-active index", () => {
    const sql = read(MIGRATION);
    assert.match(sql, /'settled'::text/);
    assert.match(sql, /status = 'settled'/);
    // The one-active index keeps creating/open/completed only.
    assert.equal(/billing_checkout_attempts_one_active_per_tenant/.test(sql), false);
  });

  it("settles only when every Stripe row since the attempt was canceled", () => {
    const sql = read(MIGRATION);
    assert.match(sql, /s\.created_at >= a\.created_at/);
    assert.match(sql, /s\.status <> 'canceled'/);
    assert.match(sql, /s\.livemode = a\.livemode/);
    assert.match(sql, /pg_advisory_xact_lock\([\s\S]*hashtextextended\(p_tenant_id::text, 31\)/);
  });

  it("keeps prepare_billing_checkout_attempt_v2 service-only", () => {
    const sql = read(MIGRATION);
    for (const role of ["public", "anon", "authenticated"]) {
      assert.match(
        sql,
        new RegExp(
          `revoke all on function public\\.prepare_billing_checkout_attempt_v2\\(uuid, text, text, text, boolean\\) from ${role};`
        )
      );
    }
    assert.match(sql, /to postgres, service_role;/);
  });

  it("runs the billing SQL suites in the always-on release gate", () => {
    const workflow = read(".github/workflows/release-gate.yml");
    for (const suite of BILLING_GATE_SUITES) {
      assert.match(workflow, new RegExp(`^\\s+${suite}( \\\\)?$`, "m"), suite);
    }
  });
});
