import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CURRENT_SUBSCRIPTION_EXISTS_CODE,
  isRetryableWebhookFailure,
} from "./webhook-errors";

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
});
