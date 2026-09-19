import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildOrdersSearchOrFilter,
  buildOrdersTextSearchOrFilter,
  escapeIlikePattern,
  normalizeOrdersListQuery,
} from "./list-search";

const root = path.join(import.meta.dirname, "../..");

describe("normalizeOrdersListQuery", () => {
  it("trims and caps at 80 characters", () => {
    assert.equal(normalizeOrdersListQuery("  demo  "), "demo");
    assert.equal(normalizeOrdersListQuery(null), "");
    assert.equal(normalizeOrdersListQuery(undefined), "");
    assert.equal(normalizeOrdersListQuery("   "), "");
    const long = "a".repeat(100);
    assert.equal(normalizeOrdersListQuery(long).length, 80);
  });
});

describe("escapeIlikePattern / or filter", () => {
  it("escapes ILIKE wildcards", () => {
    assert.equal(escapeIlikePattern("100%_off"), "100\\%\\_off");
    assert.equal(escapeIlikePattern("a\\b"), "a\\\\b");
  });

  it("builds quoted or() for reference and title", () => {
    const clause = buildOrdersTextSearchOrFilter("demo,0191");
    assert.match(clause, /^reference\.ilike\."%demo,0191%",title\.ilike\."%demo,0191%"$/);
  });

  it("appends only uuid client ids to or()", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const clause = buildOrdersSearchOrFilter({
      q: "SUR4",
      matchingClientIds: [id, "not-a-uuid"],
    });
    assert.match(clause, /reference\.ilike\."%SUR4%"/);
    assert.match(clause, /client_id\.in\.\(aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\)/);
    assert.equal(clause.includes("not-a-uuid"), false);
  });
});

describe("GET /api/orders list search (source)", () => {
  it("normalizes q, scopes clients by tenant, and keeps tenant_id + non-archived for all", () => {
    const source = readFileSync(
      path.join(root, "app/api/orders/route.ts"),
      "utf8"
    );
    assert.match(source, /normalizeOrdersListQuery/);
    assert.match(source, /buildOrdersSearchOrFilter/);
    assert.match(source, /\.eq\("tenant_id", context\.tenant\.id\)/);
    assert.match(source, /from\("clients"\)/);
    assert.match(source, /\.eq\("tenant_id", context\.tenant\.id\)/);
    assert.match(source, /applyNonArchivedOrdersFilter/);
    assert.equal(source.includes("service_role"), false);
  });

  it("orders list UI sends q and resets page via query key", () => {
    const source = readFileSync(path.join(root, "app/orders/page.tsx"), "utf8");
    assert.match(source, /debouncedQuery/);
    assert.match(source, /params\.set\("q", debouncedQuery\)/);
    assert.match(source, /listFilter === "all"/);
    assert.match(source, /No hay pedidos que coincidan con la búsqueda/);
    assert.match(source, /\$\{debouncedQuery\}/);
    assert.match(source, /setPage\(1\)/);
  });
});
