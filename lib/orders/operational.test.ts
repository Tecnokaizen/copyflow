import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOperationalOrdersFilter,
  isOrderArchived,
  isOrderOperational,
  isOrderTerminal,
} from "./operational";

describe("isOrderOperational", () => {
  it("1. normal open order is active", () => {
    assert.equal(
      isOrderOperational({
        archived_at: null,
        status: { is_closed: false, is_cancelled: false },
      }),
      true
    );
  });

  it("2. ready (non-terminal) remains active", () => {
    assert.equal(
      isOrderOperational({
        archived_at: null,
        status: { is_ready: true, is_closed: false, is_cancelled: false },
      }),
      true
    );
  });

  it("3. closed/delivered status is inactive", () => {
    assert.equal(
      isOrderOperational({
        archived_at: null,
        status: { is_closed: true, is_cancelled: false },
      }),
      false
    );
    assert.equal(
      isOrderTerminal({
        status: { is_closed: true, is_cancelled: false },
      }),
      true
    );
  });

  it("4. cancelled is inactive", () => {
    assert.equal(
      isOrderOperational({
        archived_at: null,
        status: { is_closed: false, is_cancelled: true },
      }),
      false
    );
  });

  it("5. archived is inactive", () => {
    assert.equal(
      isOrderArchived({ archived_at: "2026-09-17T12:00:00.000Z" }),
      true
    );
    assert.equal(
      isOrderOperational({
        archived_at: "2026-09-17T12:00:00.000Z",
        status: { is_closed: false, is_cancelled: false },
      }),
      false
    );
  });

  it("6. inconsistent delivered_at without terminal/archive stays ACTIVE", () => {
    // delivered_at is intentionally ignored by the operational predicate.
    const order = {
      archived_at: null,
      delivered_at: "2026-09-14T10:00:00.000Z",
      status: { is_closed: false, is_cancelled: false, is_ready: true },
    };
    assert.equal(isOrderOperational(order), true);
  });
});

describe("applyOperationalOrdersFilter", () => {
  it("applies archived_at + closed + cancelled and never delivered_at", () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const query = {
      is(column: string, value: null) {
        calls.push({ method: "is", args: [column, value] });
        return this;
      },
      eq(column: string, value: boolean) {
        calls.push({ method: "eq", args: [column, value] });
        return this;
      },
    };

    const result = applyOperationalOrdersFilter(query);
    assert.equal(result, query);
    assert.deepEqual(calls, [
      { method: "is", args: ["archived_at", null] },
      { method: "eq", args: ["status.is_closed", false] },
      { method: "eq", args: ["status.is_cancelled", false] },
    ]);
    assert.equal(
      calls.some((call) => call.args.includes("delivered_at")),
      false
    );
  });
});
