import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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

  it("is what the orders page starts from (no tenant-specific branch)", () => {
    const page = readFileSync(new URL("../../app/orders/page.tsx", import.meta.url), "utf8");
    assert.match(page, /useState<ViewMode>\(\(\) => resolveOrdersView\(searchParams\)\)/);
    assert.equal(/["']sur4["']|tenant\.slug\s*===/i.test(page), false);
  });
});
