import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLEANUP_LIMIT,
  type CleanupCandidate,
  selectCleanupCandidates,
} from "./cleanup";

function candidate(
  kind: CleanupCandidate["kind"],
  id: string,
  upload_expires_at = "2026-09-24T12:00:00Z"
): CleanupCandidate {
  return {
    kind,
    id,
    tenant_id: "tenant",
    parent_id: `${kind}-parent`,
    storage_key: `${kind}s/tenant/${kind}-parent/${id}`,
    upload_expires_at,
  };
}

describe("global expired upload cleanup selection", () => {
  for (const count of [CLEANUP_LIMIT, CLEANUP_LIMIT + 25]) {
    it(`includes an older quote despite ${count} expired orders`, () => {
      const orders = Array.from({ length: count }, (_, i) =>
        candidate("order", String(i).padStart(3, "0"))
      );
      const quote = candidate("quote", "old-quote", "2026-09-23T12:00:00Z");
      const batch = selectCleanupCandidates([...orders, quote]);

      assert.equal(batch.length, 100);
      assert.equal(batch[0], quote);
      assert.equal(batch.filter((row) => row.kind === "order").length, 99);
    });
  }

  it("caps the combined batch at 100 and prioritizes age over kind", () => {
    const orders = Array.from({ length: CLEANUP_LIMIT }, (_, i) =>
      candidate("order", `order-${i}`, new Date(Date.UTC(2026, 8, 23, 0, i * 2)).toISOString())
    );
    const quotes = Array.from({ length: CLEANUP_LIMIT }, (_, i) =>
      candidate("quote", `quote-${i}`, new Date(Date.UTC(2026, 8, 23, 0, i * 2 + 1)).toISOString())
    );
    const batch = selectCleanupCandidates([...quotes.reverse(), ...orders.reverse()]);

    assert.equal(batch.length, 100);
    assert.deepEqual(
      batch.map((row) => row.id),
      Array.from({ length: 50 }, (_, i) => [`order-${i}`, `quote-${i}`]).flat()
    );
  });

  it("breaks equal expiry ties by kind/id regardless of input order", () => {
    const rows = [
      candidate("quote", "b"),
      candidate("order", "b"),
      candidate("quote", "a"),
      candidate("order", "a"),
    ];
    const expected = [rows[3], rows[1], rows[2], rows[0]];
    assert.deepEqual(selectCleanupCandidates(rows), expected);
    assert.deepEqual(selectCleanupCandidates([...rows].reverse()), expected);
    assert.deepEqual(selectCleanupCandidates([rows[2], rows[0], rows[3], rows[1]]), expected);
  });

  it("compares expiry instants across timezone offsets", () => {
    const order = candidate("order", "later", "2026-09-24T10:00:00Z");
    const quote = candidate("quote", "earlier", "2026-09-24T11:00:00+02:00");
    assert.deepEqual(selectCleanupCandidates([order, quote]), [quote, order]);
  });

  it("handles empty and single-kind batches without mutating input", () => {
    assert.deepEqual(selectCleanupCandidates([]), []);
    for (const kind of ["order", "quote"] as const) {
      const newer = Object.freeze(candidate(kind, "newer"));
      const older = Object.freeze(candidate(kind, "older", "2026-09-23T12:00:00Z"));
      const rows = Object.freeze([newer, older]);
      assert.deepEqual(selectCleanupCandidates(rows), [older, newer]);
      assert.deepEqual(rows, [newer, older]);
    }
  });
});
