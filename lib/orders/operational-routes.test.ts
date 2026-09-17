import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");

function readRoute(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("operational predicate in API routes", () => {
  const routes = [
    ["app/api/orders/route.ts", "GET /api/orders"],
    ["app/api/orders/counter/route.ts", "counter"],
    ["app/api/orders/mine/route.ts", "mine"],
    ["app/api/dashboard/route.ts", "dashboard"],
  ] as const;

  for (const [file, label] of routes) {
    it(`${label} uses applyOperationalOrdersFilter and never filters delivered_at`, () => {
      const source = readRoute(file);
      assert.match(source, /applyOperationalOrdersFilter/);
      assert.equal(source.includes('.is("delivered_at"'), false);
      assert.equal(source.includes("delivered_at, null"), false);
      assert.equal(source.includes('eq("delivered_at"'), false);
    });
  }

  it("counter and mine select archived_at for client-side predicate", () => {
    const counter = readRoute("app/api/orders/counter/route.ts");
    const mine = readRoute("app/api/orders/mine/route.ts");
    assert.match(counter, /\barchived_at\b/);
    assert.match(mine, /\barchived_at\b/);
  });
});
