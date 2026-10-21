import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VOICE_EXPECTATIONS, parseVoiceExpectation } from "./voice-flows";

describe("voice E2E expectation", () => {
  it("accepts only the documented operator states", () => {
    for (const value of VOICE_EXPECTATIONS) assert.equal(parseVoiceExpectation(value), value);
    for (const value of [undefined, "", "ON", "skip", "real"]) {
      assert.throws(() => parseVoiceExpectation(value), /E2E_VOICE_EXPECT/);
    }
  });
});
