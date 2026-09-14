import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAbortError, nextLoadSignal } from "./abort";

describe("isAbortError", () => {
  it("detects AbortError", () => {
    const error = new DOMException("Aborted", "AbortError");
    assert.equal(isAbortError(error), true);
    assert.equal(isAbortError(new Error("boom")), false);
    assert.equal(isAbortError(null), false);
  });
});

describe("nextLoadSignal", () => {
  it("aborts the previous controller and follows the external signal", () => {
    const first = nextLoadSignal(null);
    const external = new AbortController();
    const second = nextLoadSignal(first.controller, external.signal);

    assert.equal(first.controller.signal.aborted, true);
    assert.equal(second.signal.aborted, false);

    external.abort();
    assert.equal(second.signal.aborted, true);
  });
});
