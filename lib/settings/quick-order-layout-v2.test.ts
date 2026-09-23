import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_QUICK_ORDER_LAYOUT, fieldsForPlacement, mergeQuickOrderLayoutPreference,
  parseQuickOrderLayoutPatch, resolveQuickOrderLayout,
} from "./quick-order-layout";

describe("Pedido V2 additive preferences", () => {
  it("retains every legacy placement, adding only the new fields to More", () => {
    const legacy = Object.fromEntries(Object.entries(DEFAULT_QUICK_ORDER_LAYOUT)
      .filter(([field]) => field !== "files" && field !== "file_status"));
    legacy.client = "more";
    legacy.notes = "primary";
    const resolved = resolveQuickOrderLayout({ quick_order_layout_v1: { version: 1, placements: legacy } });
    assert.deepEqual(resolved, { ...legacy, file_status: "more", files: "more" });
    assert.deepEqual(parseQuickOrderLayoutPatch({ layout: legacy, revision: "rev" }), { ok: true, layout: resolved, revision: "rev" });
  });

  it("round-trips Hidden without resetting V1 or neighboring tenant preferences", () => {
    const layout = { ...DEFAULT_QUICK_ORDER_LAYOUT, client: "hidden", files: "primary", file_status: "hidden" } as const;
    const demo = mergeQuickOrderLayoutPreference({ other: true }, layout);
    const sur4 = { quick_order_layout_v1: { version: 1, placements: DEFAULT_QUICK_ORDER_LAYOUT } };
    assert.deepEqual(resolveQuickOrderLayout(demo), layout);
    assert.deepEqual(resolveQuickOrderLayout(sur4), DEFAULT_QUICK_ORDER_LAYOUT);
    assert.equal(demo.other, true);
    assert.equal(parseQuickOrderLayoutPatch({ layout, revision: "rev" }).ok, true);
    assert.deepEqual(fieldsForPlacement(layout, "hidden"), ["client", "file_status"]);
    for (const placement of ["primary", "more"] as const) {
      assert.ok(!fieldsForPlacement(layout, placement).includes("client"));
      assert.ok(!fieldsForPlacement(layout, placement).includes("file_status"));
    }
  });

  it("rejects invalid values, unknown fields and client-supplied tenant context", () => {
    for (const extra of [{ files: null }, { file_status: false }, { unexpected: "hidden" }]) {
      assert.equal(parseQuickOrderLayoutPatch({ layout: { ...DEFAULT_QUICK_ORDER_LAYOUT, ...extra }, revision: "rev" }).ok, false);
    }
    assert.equal(parseQuickOrderLayoutPatch({ layout: DEFAULT_QUICK_ORDER_LAYOUT, revision: "rev", tenant_id: "other" }).ok, false);
  });
});
