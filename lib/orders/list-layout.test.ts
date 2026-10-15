import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOrdersListLayout } from "./list-layout";

describe("orders list presentation", () => {
  it("opens in grid when no layout was selected", () => {
    assert.equal(resolveOrdersListLayout(null), "grid");
    assert.equal(resolveOrdersListLayout(""), "grid");
  });

  it("respects an explicit list or grid selection in the URL", () => {
    assert.equal(resolveOrdersListLayout("list"), "list");
    assert.equal(resolveOrdersListLayout("grid"), "grid");
  });

  it("falls back to grid for unknown layout values", () => {
    assert.equal(resolveOrdersListLayout("legacy"), "grid");
    assert.equal(resolveOrdersListLayout("LIST"), "grid");
  });
});
