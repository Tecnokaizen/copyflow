import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { navStructureForRole } from "../nav/items";
import { DEFAULT_ORDERS_VIEW, resolveOrdersView } from "./default-view";

const view = (query: string) => resolveOrdersView(new URLSearchParams(query));

describe("default view of /orders", () => {
  it("opens Calendario when the URL names no view", () => {
    assert.equal(DEFAULT_ORDERS_VIEW, "calendar");
    assert.equal(view(""), "calendar");
    assert.equal(view("create=1"), "calendar");
    assert.equal(view("created=1"), "calendar");
    assert.equal(view("view=nonsense"), "calendar");
  });

  it("keeps a manual or linked choice", () => {
    assert.equal(view("view=list"), "list");
    assert.equal(view("view=list&filter=all"), "list");
    assert.equal(view("view=calendar&scope=today"), "calendar");
    assert.equal(view("view=service"), "service");
  });

  it("keeps the list for filtered links without a view", () => {
    for (const query of ["filter=attention", "filter=archived", "status_id=x", "sort=due_at&dir=asc", "layout=grid"]) {
      assert.equal(view(query), "list", query);
    }
  });

  it("«Todos los pedidos» in the menu opens Calendario and keeps «todos» for Lista", () => {
    const group = navStructureForRole("owner").find(
      (entry) => entry.type === "group" && entry.group.id === "orders"
    );
    assert.ok(group && group.type === "group");
    const item = group.group.items.find((entry) => entry.id === "orders");
    assert.ok(item);
    const params = new URL(item.href, "https://app.test").searchParams;
    assert.equal(resolveOrdersView(params), "calendar");
    assert.equal(params.get("filter"), "all");
  });

  it("is what the orders page starts from (no tenant-specific branch)", () => {
    const page = readFileSync(new URL("../../app/orders/page.tsx", import.meta.url), "utf8");
    assert.match(page, /useState<ViewMode>\(\(\) => resolveOrdersView\(searchParams\)\)/);
    assert.equal(/["']sur4["']|tenant\.slug\s*===/i.test(page), false);
  });
});
