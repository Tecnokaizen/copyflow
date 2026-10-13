import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  receiptIdsFromRows,
  receiptSchemaUnavailable,
  withReceiptMarker,
} from "./receipt-links";

describe("receipt link lookup", () => {
  it("treats a missing remote relationship as no receipts yet", () => {
    assert.equal(
      receiptSchemaUnavailable(
        "Could not find a relationship between 'order_files' and 'order_payments' in the schema cache",
      ),
      true,
    );
    assert.equal(
      receiptSchemaUnavailable(
        "Could not find the 'receipt_file_id' column of 'order_payments' in the schema cache",
      ),
      true,
    );
    assert.equal(receiptSchemaUnavailable("permission denied"), false);
  });

  it("marks only the files returned as linked", () => {
    const linked = receiptIdsFromRows([
      { receipt_file_id: "file-a" },
      { receipt_file_id: null },
      {},
    ]);
    assert.deepEqual(
      withReceiptMarker({ id: "file-a", original_name: "a.pdf" }, linked)
        .payment_receipts,
      [{ id: "file-a" }],
    );
    assert.equal(
      withReceiptMarker({ id: "file-b" }, linked).payment_receipts,
      null,
    );
  });
});
