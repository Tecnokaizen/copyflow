/**
 * D1 · webhook guard for current internal subscriptions, options B + C
 * (20261018170000_billing_internal_subscription_webhook_guard_v1.sql).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { INTERNAL_SUBSCRIPTION_CURRENT_CODE } from "./internal-subscription";
import {
  BILLING_RECONCILIATION_LOG_TAG,
  buildBillingReconciliationText,
} from "./reconciliation-alert-text";
import { classifySyncResult, heldSyncDetails } from "./sync-result";
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

  it("reads the hold id and whether this event opened the hold", () => {
    assert.deepEqual(heldSyncDetails({ outcome: "held", hold_id: "h1", hold_created: true }), {
      holdId: "h1",
      holdCreated: true,
    });
    assert.deepEqual(heldSyncDetails({ outcome: "held" }), { holdId: null, holdCreated: false });
    assert.deepEqual(heldSyncDetails(null), { holdId: null, holdCreated: false });
  });

  it("treats a held event as final for Stripe (no retry storm)", () => {
    assert.equal(isRetryableWebhookFailure(INTERNAL_SUBSCRIPTION_CURRENT_CODE), false);
  });
});

describe("webhook guard for current internal subscriptions", () => {
  it("passes the Stripe event id to the sync for every event type", () => {
    const webhook = read("lib/billing/webhook.ts");
    assert.match(webhook, /stripe_event_id: input\.eventId/);
    assert.equal(webhook.match(/eventId: event\.id,/g)?.length, 3);
  });

  it("returns before tenant activation when the sync is held, alerting with ids only", () => {
    const webhook = read("lib/billing/webhook.ts");
    const held = webhook.indexOf('syncOutcome === "held"');
    const activation = webhook.indexOf("activateTenantAfterBilling({");
    assert.ok(held > 0, "held branch missing");
    assert.ok(activation > held, "held branch must run before activation");

    const branch = webhook.slice(held, webhook.indexOf('syncOutcome === "stale"'));
    assert.match(branch, /errorCode: INTERNAL_SUBSCRIPTION_CURRENT_CODE/);
    assert.match(branch, /retryable: false/);
    assert.match(branch, /notifyBillingReconciliation\(/);
    assert.match(branch, /firstOccurrence: hold\.holdCreated/);
    assert.doesNotMatch(branch, /email|customer_email|name:/i);
  });

  it("sync holds instead of canceling non-Stripe rows and shares the key-31 lock", () => {
    const sql = stripSqlComments(read(MIGRATION));
    assert.match(sql, /hashtextextended\(p_tenant_id::text, 31\)/);
    assert.doesNotMatch(sql, /4242/);
    assert.match(sql, /s\.provider is distinct from 'stripe'/);
    assert.match(sql, /'outcome', 'held'/);
    assert.match(sql, /and s\.provider = 'stripe'\s+and s\.status = any \(v_current_statuses\)/);
    // The event id is traced on the hold, never stored on the subscription.
    assert.match(sql, /p_metadata - 'stripe_event_id'/);
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

  it("option C: converts only rows marked ready_for_checkout, audited", () => {
    const sql = stripSqlComments(read(MIGRATION));
    assert.match(
      sql,
      /if found\s+and coalesce\(v_internal\.metadata ->> 'billing_activation', ''\) = 'ready_for_checkout'/
    );
    assert.match(sql, /'billing_activation', 'converted_to_stripe'/);
    assert.match(sql, /'app\.billing_internal_via', 'stripe_conversion'/);
    assert.match(sql, /'app\.billing_internal_via', 'activation_rpc'/);
    assert.match(
      sql,
      /coalesce\(s\.metadata ->> 'billing_activation', ''\) <> 'ready_for_checkout'/
    );
  });

  it("a pending hold blocks new charges; recovery is idempotent and traced", () => {
    const sql = stripSqlComments(read(MIGRATION));
    assert.match(sql, /create table if not exists billing_private\.subscription_holds/);
    assert.match(sql, /'outcome', 'subscription_pending_reconciliation'/);
    assert.match(sql, /'idempotent', v_marked = 0/);
    assert.match(sql, /'requested_by', v_by/);
    assert.match(sql, /status = 'reconciled'/);
    assert.match(sql, /'kind', 'checkout_completed_unrecorded'/);
    assert.match(read("lib/billing/checkout-attempts.ts"), /outcome: "subscription_pending_reconciliation"/);
    assert.match(
      read("lib/billing/checkout.ts"),
      /prepared\.outcome === "subscription_pending_reconciliation"[\s\S]{0,80}CheckoutPendingReconciliationError/
    );
    for (const route of [
      "app/api/billing/checkout-session/route.ts",
      "app/api/onboarding/route.ts",
    ]) {
      assert.match(
        read(route),
        /error instanceof CheckoutPendingReconciliationError\)\s*\{\s*return json\(\s*\{[\s\S]*?code: SUBSCRIPTION_PENDING_RECONCILIATION_CODE,\s*\},\s*409\s*\)/,
        route
      );
    }
  });

  it("keeps the RPCs and the holds service-only", () => {
    const sql = read(MIGRATION);
    for (const fn of [
      "requeue_billing_subscription_hold_v1\\(uuid, text, text\\)",
      "resolve_billing_subscription_hold_v1\\(uuid, text, text\\)",
      "set_internal_billing_activation_v1\\(uuid, text, text, text\\)",
      "list_billing_reconciliation_v1\\(\\)",
    ]) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated;`), fn);
    }
    for (const role of ["public", "anon", "authenticated"]) {
      assert.match(
        sql,
        new RegExp(
          `revoke all on function public\\.prepare_billing_checkout_attempt_v2\\(uuid, text, text, text, boolean\\) from ${role};`
        )
      );
      assert.match(
        sql,
        new RegExp(
          `revoke all on function public\\.sync_billing_subscription_v1\\(\\s*uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, timestamptz, timestamptz, boolean\\s*\\) from ${role};`
        )
      );
    }
    assert.match(
      sql,
      /revoke all on table billing_private\.subscription_holds\s+from public, anon, authenticated, service_role;/
    );
    assert.doesNotMatch(stripSqlComments(sql), /\bgrant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
  });

  it("the billing page offers activation only for ready rows, from a server-side boolean", () => {
    const route = read("app/api/billing/subscription/route.ts");
    assert.match(route, /billing_activation_ready: billingActivationReady/);
    assert.match(route, /metadata\?\.billing_activation === READY_FOR_CHECKOUT/);
    assert.doesNotMatch(route, /metadata: display\.metadata/);
    const page = read("components/settings/billing-settings.tsx");
    assert.match(page, /isInternalCurrent && Boolean\(subscription\?\.billing_activation_ready\)/);
    assert.match(page, /subscription_pending_reconciliation/);
  });
});

describe("release gate", () => {
  it("runs the D1 suite and the two-session lock test", () => {
    const workflow = read(".github/workflows/release-gate.yml");
    assert.match(workflow, /^\s+phase57_billing_internal_subscription_guard( \\)?$/m);
    assert.match(
      workflow,
      /bash supabase\/tests\/phase57_billing_lock_concurrency\.sh "\$\{LOCAL_DB_URL\}"/
    );
  });
});

describe("billing reconciliation alert", () => {
  const alert = {
    kind: "subscription_held" as const,
    tenantId: "11111111-1111-4111-8111-111111111111",
    providerSubscriptionId: "sub_test_123",
    livemode: false,
    eventId: "evt_test_123",
    holdId: "22222222-2222-4222-8222-222222222222",
    firstOccurrence: true,
  };

  it("builds an operator email with ids and the recovery path, no personal data", () => {
    const text = buildBillingReconciliationText(alert);
    for (const part of [
      alert.tenantId,
      alert.providerSubscriptionId,
      alert.eventId,
      "(Test)",
      "list_billing_reconciliation_v1",
      "requeue_billing_subscription_hold_v1",
    ]) {
      assert.ok(text.includes(part), part);
    }
    assert.doesNotMatch(text, /@/);
  });

  it("logs with a stable tag, emails only a first occurrence when configured, never throws", () => {
    const source = read("lib/billing/reconciliation-alert.ts");
    assert.equal(BILLING_RECONCILIATION_LOG_TAG, "[billing.reconciliation]");
    assert.match(source, /if \(!alert\.firstOccurrence \|\| !recipient\)/);
    assert.match(read("lib/billing/reconciliation-alert-text.ts"), /process\.env\.BILLING_ALERT_EMAIL/);
    assert.match(source, /\} catch \(error\) \{/);
    assert.match(read(".env.example"), /^# BILLING_ALERT_EMAIL=$/m);
  });
});
