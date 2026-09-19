import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDER_UPLOAD_CONCURRENCY,
  SILENT_LIST_REFRESH_NOTICE,
  canApplyFilesUiUpdate,
  claimUploadLocalId,
  createConcurrencyGate,
  listRefreshFailureMode,
  releaseUploadLocalId,
  resolveActionErrorOnListResult,
} from "./upload-queue";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createConcurrencyGate", () => {
  it("allows real concurrency up to max 2 and never exceeds it", async () => {
    assert.equal(ORDER_UPLOAD_CONCURRENCY, 2);
    const gate = createConcurrencyGate(ORDER_UPLOAD_CONCURRENCY);
    let current = 0;
    let maxActive = 0;
    let overlappingPairs = 0;

    await Promise.all(
      [1, 2, 3, 4].map(() =>
        gate.run(async () => {
          current += 1;
          maxActive = Math.max(maxActive, current);
          if (current > 1) overlappingPairs += 1;
          await delay(30);
          current -= 1;
        }),
      ),
    );

    assert.equal(maxActive, 2);
    assert.ok(
      overlappingPairs > 0,
      "expected at least one moment with >1 concurrent tasks",
    );
    assert.equal(gate.activeCount(), 0);
  });
});

describe("claimUploadLocalId", () => {
  it("blocks double retry for the same localId until released", () => {
    const claimed = new Set<string>();
    assert.equal(claimUploadLocalId(claimed, "u1"), true);
    assert.equal(claimUploadLocalId(claimed, "u1"), false);
    assert.equal(claimUploadLocalId(claimed, "u2"), true);
    releaseUploadLocalId(claimed, "u1");
    assert.equal(claimUploadLocalId(claimed, "u1"), true);
  });
});

describe("canApplyFilesUiUpdate", () => {
  it("rejects unmounted or cross-order callbacks", () => {
    assert.equal(
      canApplyFilesUiUpdate({
        mounted: true,
        instanceOrderId: "order-a",
        callbackOrderId: "order-a",
      }),
      true,
    );
    assert.equal(
      canApplyFilesUiUpdate({
        mounted: false,
        instanceOrderId: "order-a",
        callbackOrderId: "order-a",
      }),
      false,
    );
    assert.equal(
      canApplyFilesUiUpdate({
        mounted: true,
        instanceOrderId: "order-b",
        callbackOrderId: "order-a",
      }),
      false,
    );
  });
});

describe("listRefreshFailureMode", () => {
  it("keeps list usable on silent post-upload refresh failure", () => {
    assert.equal(
      listRefreshFailureMode({ silent: true }),
      "keep_list_notice",
    );
    assert.equal(listRefreshFailureMode({ silent: false }), "full_error");
    assert.match(SILENT_LIST_REFRESH_NOTICE, /actualizar el listado/i);
  });
});

describe("resolveActionErrorOnListResult", () => {
  it("sets notice on silent failure and clears it after successful retry", () => {
    const afterSilentFail = resolveActionErrorOnListResult({
      ok: false,
      silent: true,
    });
    assert.equal(afterSilentFail, SILENT_LIST_REFRESH_NOTICE);

    // "Reintentar carga" uses a non-silent refreshList(); success must clear.
    const afterSuccessfulRetry = resolveActionErrorOnListResult({
      ok: true,
      silent: false,
    });
    assert.equal(afterSuccessfulRetry, null);

    // Silent success also clears.
    assert.equal(
      resolveActionErrorOnListResult({ ok: true, silent: true }),
      null,
    );

    // Full LIST failure leaves actionError alone (listError owns UX).
    assert.equal(
      resolveActionErrorOnListResult({ ok: false, silent: false }),
      undefined,
    );
  });
});
