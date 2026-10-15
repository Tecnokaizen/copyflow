import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMBERSHIP_ROLES } from "@/lib/auth/membership-roles";
import {
  AI_VOICE_ORDERS_FEATURE_CODE,
  canViewProEarlyAccess,
  earlyAccessContext,
  PRO_EARLY_ACCESS_FEATURE_CODE,
  proEarlyAccessFromContext,
  VOICE_ORDERS_V1_STATUS,
} from "./early-access";

describe("Pro early access policy", () => {
  it("uses the catalog codes of the additive migration", () => {
    assert.equal(PRO_EARLY_ACCESS_FEATURE_CODE, "pro_early_access");
    assert.equal(AI_VOICE_ORDERS_FEATURE_CODE, "ai_voice_orders");
  });

  it("enrols only on an explicit true and then announces voice as planned", () => {
    assert.deepEqual(earlyAccessContext(true), {
      pro: true,
      voice_orders: { status: "planned" },
    });
    assert.equal(VOICE_ORDERS_V1_STATUS, "planned");
  });

  it("hides the program and all voice details on absence, error or odd values", () => {
    for (const value of [false, null, undefined, "true", 1, {}, []]) {
      const context = earlyAccessContext(value);
      assert.deepEqual(context, { pro: false }, `value ${String(value)}`);
      assert.equal("voice_orders" in context, false);
    }
  });

  it("lets every active membership role of an enrolled tenant read the page", () => {
    for (const role of MEMBERSHIP_ROLES) {
      assert.equal(canViewProEarlyAccess(role, true), true, role);
      assert.equal(canViewProEarlyAccess(role, false), false, role);
    }
  });

  it("denies unknown roles and anything that is not an explicit true", () => {
    for (const role of [null, undefined, "", "superadmin", "Owner"]) {
      assert.equal(canViewProEarlyAccess(role, true), false, String(role));
    }
    for (const enabled of [null, undefined, "true", 1]) {
      assert.equal(canViewProEarlyAccess("owner", enabled), false);
    }
  });

  it("reads /api/context fail-closed in the browser", () => {
    assert.equal(proEarlyAccessFromContext({ early_access: { pro: true } }), true);
    for (const payload of [
      null,
      undefined,
      "context",
      {},
      { error: "Unauthorized or tenant access denied" },
      { early_access: null },
      { early_access: true },
      { early_access: { pro: "true" } },
      { early_access: { pro: false } },
      { features: { quotes: true } },
    ]) {
      assert.equal(proEarlyAccessFromContext(payload), false, JSON.stringify(payload));
    }
  });
});
