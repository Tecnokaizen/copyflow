import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CURRENT_SUBSCRIPTION_EXISTS_CODE,
  isRetryableWebhookFailure,
} from "./webhook-errors";

const root = path.join(import.meta.dirname, "../..");

describe("paid onboarding security helpers", () => {
  it("classifies webhook failures as retryable vs deterministic", () => {
    assert.equal(isRetryableWebhookFailure("tenant_activation_failed"), true);
    assert.equal(isRetryableWebhookFailure("sync_rpc_failed"), true);
    assert.equal(isRetryableWebhookFailure("processing_exception"), true);
    assert.equal(isRetryableWebhookFailure(undefined), true);

    assert.equal(isRetryableWebhookFailure("unknown_price_mapping"), false);
    assert.equal(isRetryableWebhookFailure("tenant_not_found"), false);
    assert.equal(isRetryableWebhookFailure("unsupported_event_type"), false);
  });

  it("exposes stable current_subscription_exists conflict code", () => {
    assert.equal(CURRENT_SUBSCRIPTION_EXISTS_CODE, "current_subscription_exists");
  });

  it("webhook route returns 503 for in_progress and uses processing attempt on finalize", () => {
    const route = readFileSync(
      path.join(root, "app/api/webhooks/stripe/route.ts"),
      "utf8"
    );
    assert.match(route, /in_progress[\s\S]*status: 503/);
    assert.match(route, /processingAttempt/);
    assert.match(route, /stale_claim/);
  });
});
