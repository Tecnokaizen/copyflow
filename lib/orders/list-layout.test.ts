import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOrdersListLayout } from "./list-layout";

describe("orders list presentation", () => {
  it("uses Cuadrícula for a new visit without a layout parameter", () => {
    assert.equal(parseOrdersListLayout(null), "grid");
    assert.equal(parseOrdersListLayout(new URLSearchParams("").get("layout")), "grid");
  });

  it("respects explicit Lista and Cuadrícula URLs", () => {
    assert.equal(parseOrdersListLayout("list"), "list");
    assert.equal(parseOrdersListLayout("grid"), "grid");
    const params = new URLSearchParams("filter=active&sort=due_at&dir=asc");
    params.set("layout", "list");
    assert.equal(parseOrdersListLayout(params.get("layout")), "list");
    assert.equal(params.get("filter"), "active");
    assert.equal(params.get("sort"), "due_at");
    assert.equal(params.get("dir"), "asc");
  });

  it("defaults to grid for unsupported layouts", () => {
    assert.equal(parseOrdersListLayout("unknown"), "grid");
    assert.equal(parseOrdersListLayout(""), "grid");
  });
});
