/**
 * D1 · webhook guard for current internal subscriptions
 * (20261018170000_billing_internal_subscription_webhook_guard_v1.sql).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { INTERNAL_SUBSCRIPTION_CURRENT_CODE } from "./internal-subscription";
import { classifySyncResult } from "./sync-result";
import { isRetryableWebhookFailure } from "./webhook-errors";

const root = path.join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const MIGRATION =
  "supabase/migrations/20261018170000_billing_internal_subscription_webhook_guard_v1.sql";

function stripSqlComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
}

describe("sync_billing_subscription_v1 result classification", () => {
  it("recognises held, stale and synced results", () => {
    assert.equal(
      classifySyncResult({ outcome: "held", code: "internal_subscription_current", held: true }),
      "held"
    );
    assert.equal(classifySyncResult({ held: true }), "held");
    assert.equal(classifySyncResult({ subscription_id: "x", stale: true }), "stale");
    assert.equal(classifySyncResult({ subscription_id: "x", stale: false }), "synced");
    assert.equal(classifySyncResult(null), "synced");
    assert.equal(classifySyncResult([]), "synced");
  });

  it("treats a held event as final for Stripe (no retry storm)", () => {
    assert.equal(isRetryableWebhookFailure(INTERNAL_SUBSCRIPTION_CURRENT_CODE), false);
  });
});

describe("webhook guard for current internal subscriptions", () => {
  it("returns before tenant activation when the sync is held, logging ids only", () => {
    const webhook = read("lib/billing/webhook.ts");
    const held = webhook.indexOf('syncOutcome === "held"');
    const activation = webhook.indexOf("activateTenantAfterBilling({");
    assert.ok(held > 0, "held branch missing");
    assert.ok(activation > held, "held branch must run before activation");

    const branch = webhook.slice(held, webhook.indexOf('syncOutcome === "stale"'));
    assert.match(branch, /errorCode: INTERNAL_SUBSCRIPTION_CURRENT_CODE/);
    assert.match(branch, /retryable: false/);
    assert.doesNotMatch(branch, /email|customer_email|name:/i);
  });

  it("sync holds instead of canceling non-Stripe rows and shares the key-31 lock", () => {
    const sql = stripSqlComments(read(MIGRATION));
    assert.match(sql, /hashtextextended\(p_tenant_id::text, 31\)/);
    assert.doesNotMatch(sql, /4242/);
    assert.match(sql, /s\.provider is distinct from 'stripe'/);
    assert.match(sql, /'outcome', 'held'/);
    assert.match(sql, /and s\.provider = 'stripe'\s+and s\.status = any \(v_current_statuses\)/);
  });

  it("prepare refuses Checkout in-lock while a non-Stripe row is current", () => {
    const sql = stripSqlComments(read(MIGRATION));
    assert.match(sql, /'outcome', 'internal_subscription_current'/);
    assert.match(read("lib/billing/checkout-attempts.ts"), /outcome: "internal_subscription_current"/);
    assert.match(
      read("lib/billing/checkout.ts"),
      /prepared\.outcome === "internal_subscription_current"[\s\S]{0,80}CheckoutInternalSubscriptionError/
    );
  });

  it("keeps the RPCs service-only", () => {
    const sql = read(MIGRATION);
    for (const fn of [
      "requeue_billing_webhook_event_v1\\(text\\)",
      "prepare_billing_checkout_attempt_v2\\(uuid, text, text, text, boolean\\)",
      "sync_billing_subscription_v1\\(\\s*uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean\\s*\\)",
    ]) {
      for (const role of ["public", "anon", "authenticated"]) {
        assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from ${role};`), `${fn} ${role}`);
      }
    }
    assert.doesNotMatch(sql, /grant[^;]*to[^;]*\b(anon|authenticated|public)\b/i);
  });
});
