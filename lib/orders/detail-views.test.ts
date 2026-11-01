import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canManageOrderDetailView,
  readStoredOrderDetailView,
  resolveOrderDetailView,
  resolvePreviewOrderDetailView,
  type OrderDetailViewCode,
} from "@/lib/orders/detail-views";

const ALL: OrderDetailViewCode[] = ["classic", "operational", "tabs", "production", "hybrid"];
const stored = (view: unknown, extra: Record<string, unknown> = {}) => ({
  quick_order_layout_v1: { version: 1, placements: {} },
  order_detail_view_v1: { version: 1, view, ...extra },
});

describe("resolveOrderDetailView", () => {
  it("falls back to classic when missing, malformed or unknown", () => {
    for (const prefs of [
      null,
      undefined,
      [],
      "x",
      {},
      { order_detail_view_v1: null },
      { order_detail_view_v1: { view: "tabs" } },
      { order_detail_view_v1: { version: 2, view: "tabs" } },
      stored("kanban"),
      stored(42),
    ]) {
      assert.equal(resolveOrderDetailView(prefs, ALL), "classic");
    }
  });

  it("returns a stored, implemented view", () => {
    assert.equal(resolveOrderDetailView(stored("hybrid"), ALL), "hybrid");
  });

  it("falls back to classic for a view not yet implemented", () => {
    assert.equal(resolveOrderDetailView(stored("tabs"), ["classic", "hybrid"]), "classic");
  });

  it("reads previous_view only when valid", () => {
    assert.equal(
      readStoredOrderDetailView(stored("tabs", { previous_view: "hybrid" }))?.previous_view,
      "hybrid"
    );
    assert.equal(
      readStoredOrderDetailView(stored("tabs", { previous_view: "nope" }))?.previous_view,
      null
    );
  });
});

describe("who can change or preview the view", () => {
  it("only owner and admin manage it", () => {
    assert.equal(canManageOrderDetailView("owner"), true);
    assert.equal(canManageOrderDetailView("admin"), true);
    for (const role of ["manager", "staff", "viewer", "", null, undefined]) {
      assert.equal(canManageOrderDetailView(role), false);
    }
  });

  it("preview needs owner/admin and an implemented view", () => {
    const preview = resolvePreviewOrderDetailView;
    assert.equal(preview({ requested: "tabs", role: "admin", implemented: ALL }), "tabs");
    assert.equal(preview({ requested: "tabs", role: "staff", implemented: ALL }), null);
    assert.equal(preview({ requested: "tabs", role: "owner", implemented: ["classic"] }), null);
    assert.equal(preview({ requested: "../x", role: "owner", implemented: ALL }), null);
    assert.equal(preview({ requested: null, role: "owner", implemented: ALL }), null);
  });
});
