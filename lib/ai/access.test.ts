import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessVoiceOrdersModule,
  isVoiceOrdersEnvEnabled,
} from "@/lib/ai/voice-orders/feature";

describe("voice orders access helpers", () => {
  it("allows operative roles only when the feature is on", () => {
    assert.equal(canAccessVoiceOrdersModule("staff", true), true);
    assert.equal(canAccessVoiceOrdersModule("viewer", true), false);
    assert.equal(canAccessVoiceOrdersModule("staff", false), false);
  });

  it("treats missing env as disabled", () => {
    const previous = process.env.AI_VOICE_ORDERS_ENABLED;
    delete process.env.AI_VOICE_ORDERS_ENABLED;
    assert.equal(isVoiceOrdersEnvEnabled(), false);
    process.env.AI_VOICE_ORDERS_ENABLED = "true";
    assert.equal(isVoiceOrdersEnvEnabled(), true);
    if (previous === undefined) {
      delete process.env.AI_VOICE_ORDERS_ENABLED;
    } else {
      process.env.AI_VOICE_ORDERS_ENABLED = previous;
    }
  });
});
