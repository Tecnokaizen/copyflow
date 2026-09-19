import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyArchivedOrdersFilter,
  applyNonArchivedOrdersFilter,
  applyOperationalOrdersFilter,
} from "./operational";

const root = path.join(import.meta.dirname, "../..");

function read(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

type Call = { method: string; args: unknown[] };

function createMockQuery() {
  const calls: Call[] = [];
  const api: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["is", "eq", "not", "gte", "lt"]) {
    api[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return api;
    };
  }
  return { api, calls };
}

describe("archived list filter helpers", () => {
  it("non-archived filter only constrains archived_at IS NULL", () => {
    const { api, calls } = createMockQuery();
    applyNonArchivedOrdersFilter(api);
    assert.deepEqual(calls, [{ method: "is", args: ["archived_at", null] }]);
  });

  it("archived filter constrains archived_at IS NOT NULL", () => {
    const { api, calls } = createMockQuery();
    applyArchivedOrdersFilter(api);
    assert.deepEqual(calls, [
      { method: "not", args: ["archived_at", "is", null] },
    ]);
  });

  it("operational filter still includes archived + closed + cancelled", () => {
    const { api, calls } = createMockQuery();
    applyOperationalOrdersFilter(api);
    assert.deepEqual(calls, [
      { method: "is", args: ["archived_at", null] },
      { method: "eq", args: ["status.is_closed", false] },
      { method: "eq", args: ["status.is_cancelled", false] },
    ]);
  });
});

describe("GET /api/orders archived semantics (source)", () => {
  it("accepts filter=archived and keeps tenant_id equality", () => {
    const source = read("app/api/orders/route.ts");
    assert.match(source, /"archived"/);
    assert.match(source, /applyArchivedOrdersFilter/);
    assert.match(source, /applyNonArchivedOrdersFilter/);
    assert.match(source, /\.eq\("tenant_id", context\.tenant\.id\)/);
    assert.equal(source.includes("service_role"), false);
  });

  it("calendar all path excludes archived orders", () => {
    const source = read("app/api/orders/route.ts");
    // active → operational; else (all/null) → non-archived
    assert.match(
      source,
      /if \(activeOnly\) \{\s*query = applyOperationalOrdersFilter\(query\);\s*\} else \{\s*[\s\S]*?applyNonArchivedOrdersFilter\(query\);/
    );
  });

  it("orders page parses and exposes Archivados chip", () => {
    const source = read("app/orders/page.tsx");
    assert.match(source, /raw === "archived"/);
    assert.match(source, /id: "archived", label: "Archivados"/);
    assert.match(source, /filter === "archived"/);
  });
});
