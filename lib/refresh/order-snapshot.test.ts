import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldApplyLiveOrderSnapshot } from "./order-snapshot";

describe("shouldApplyLiveOrderSnapshot", () => {
  it("applies remote order data when the ficha is idle", () => {
    assert.equal(
      shouldApplyLiveOrderSnapshot({
        editing: false,
        saving: false,
        quickSaving: false,
      }),
      true
    );
  });

  it("does not overwrite a ficha that is being edited or saved", () => {
    assert.equal(
      shouldApplyLiveOrderSnapshot({
        editing: true,
        saving: false,
        quickSaving: false,
      }),
      false
    );
    assert.equal(
      shouldApplyLiveOrderSnapshot({
        editing: false,
        saving: true,
        quickSaving: false,
      }),
      false
    );
    assert.equal(
      shouldApplyLiveOrderSnapshot({
        editing: false,
        saving: false,
        quickSaving: true,
      }),
      false
    );
  });
});
