import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFeatureEnabled } from "./resolve";

describe("feature resolution", () => {
  it("uses an explicit override before the plan", () => {
    assert.equal(
      resolveFeatureEnabled({ overrideEnabled: true, planEnabled: false }),
      true
    );
    assert.equal(
      resolveFeatureEnabled({ overrideEnabled: false, planEnabled: true }),
      false
    );
  });

  it("uses the plan only when there is no override", () => {
    assert.equal(
      resolveFeatureEnabled({ overrideEnabled: null, planEnabled: true }),
      true
    );
    assert.equal(
      resolveFeatureEnabled({ overrideEnabled: null, planEnabled: false }),
      false
    );
    assert.equal(
      resolveFeatureEnabled({ overrideEnabled: null, planEnabled: null }),
      false
    );
  });
});
