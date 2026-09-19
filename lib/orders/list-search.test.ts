import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ORDERS_CLIENT_SEARCH_EMBED,
  buildOrdersClientNameImatchValue,
  buildOrdersContainsRegex,
  buildOrdersListSearchOrClause,
  buildOrdersQuotedContainsRegex,
  escapeRegexLiteral,
  normalizeOrdersListQuery,
  quotePostgrestFilterValue,
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

describe("escape layers (regex literal vs PostgREST)", () => {
  it("escapes regex metacharacters as literals", () => {
    assert.equal(escapeRegexLiteral("100%_off"), "100%_off");
    assert.equal(escapeRegexLiteral("a\\b"), "a\\\\b");
    assert.equal(escapeRegexLiteral("a*b"), "a\\*b");
    assert.equal(escapeRegexLiteral("demo,0191"), "demo,0191");
    assert.equal(escapeRegexLiteral('say "hello"'), 'say "hello"');
  });

  it("builds contains regex with only outer .* as wildcards", () => {
    assert.equal(buildOrdersContainsRegex("100%_off"), ".*100%_off.*");
    assert.equal(buildOrdersContainsRegex("a\\b"), ".*a\\\\b.*");
    assert.equal(buildOrdersContainsRegex("a*b"), ".*a\\*b.*");
  });

  it("quotes for PostgREST so backslash escapes survive the parser", () => {
    assert.equal(
      quotePostgrestFilterValue(".*a\\*b.*"),
      '".*a\\\\*b.*"'
    );
    assert.equal(
      quotePostgrestFilterValue(".*a\\\\b.*"),
      '".*a\\\\\\\\b.*"'
    );
    assert.equal(
      quotePostgrestFilterValue('.*say "hello".*'),
      '".*say \\"hello\\".*"'
    );
  });

  it("builds or() with quoted imatch + client_search.not.is.null", () => {
    const clause = buildOrdersListSearchOrClause("demo,0191");
    assert.equal(
      clause,
      'reference.imatch.".*demo,0191.*",title.imatch.".*demo,0191.*",client_search.not.is.null'
    );
    assert.equal(clause.includes("client_id.in"), false);
    assert.equal(clause.includes("ilike"), false);
    assert.equal(
      buildOrdersClientNameImatchValue("acme"),
      ".*acme.*"
    );
    assert.equal(
      buildOrdersQuotedContainsRegex("a*b"),
      '".*a\\\\*b.*"'
    );
  });
});

/**
 * Minimal PostgREST quoted-value unescaper, then JS RegExp with `i` flag
 * approximating PostgreSQL `~*` for our contains patterns.
 */
function unquotePostgrestFilterValue(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    const inner = raw.slice(1, -1);
    let out = "";
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "\\" && i + 1 < inner.length) {
        out += inner[i + 1];
        i += 1;
      } else {
        out += inner[i];
      }
    }
    return out;
  }
  return raw;
}

function matchesViaBuiltSearch(q: string, fieldValue: string): boolean {
  const quoted = buildOrdersQuotedContainsRegex(q);
  const pattern = unquotePostgrestFilterValue(quoted);
  return new RegExp(pattern, "i").test(fieldValue);
}

describe("search semantics after PostgREST + imatch layers", () => {
  it("normal contains: reference / title / client", () => {
    assert.equal(matchesViaBuiltSearch("demo", "pedido-demo-0191"), true);
    assert.equal(matchesViaBuiltSearch("trabajo", "Trabajo urgente"), true);
    assert.equal(matchesViaBuiltSearch("acme", "Cliente ACME SL"), true);
  });

  it("is case-insensitive", () => {
    assert.equal(matchesViaBuiltSearch("AcMe", "ACME"), true);
  });

  it("treats % and _ as literals (100%_off)", () => {
    assert.equal(matchesViaBuiltSearch("100%_off", "promo 100%_off hoy"), true);
    assert.equal(matchesViaBuiltSearch("100%_off", "promo 100XYoff hoy"), false);
  });

  it("treats backslash as literal (a\\b)", () => {
    assert.equal(matchesViaBuiltSearch("a\\b", "path a\\b end"), true);
    assert.equal(matchesViaBuiltSearch("a\\b", "path ab end"), false);
  });

  it("treats asterisk as literal (a*b), not PostgREST like wildcard", () => {
    assert.equal(matchesViaBuiltSearch("a*b", "code a*b ok"), true);
    assert.equal(matchesViaBuiltSearch("a*b", "code axb ok"), false);
    assert.equal(matchesViaBuiltSearch("a*b", "code aXXXb ok"), false);
  });

  it("keeps commas and quotes as data", () => {
    assert.equal(matchesViaBuiltSearch("demo,0191", "ref demo,0191"), true);
    assert.equal(matchesViaBuiltSearch('say "hello"', 'note say "hello"'), true);
  });

  it("does not treat PostgREST-looking injection text as syntax", () => {
    const q = "X).or(tenant_id.neq.0)";
    const clause = buildOrdersListSearchOrClause(q);
    assert.match(
      clause,
      /^reference\.imatch\."[^"]+",title\.imatch\."[^"]+",client_search\.not\.is\.null$/
    );
    assert.equal(matchesViaBuiltSearch(q, `prefix ${q} suffix`), true);
    assert.equal(matchesViaBuiltSearch(q, "unrelated"), false);
  });
});

describe("GET /api/orders list search (source)", () => {
  it("uses client_search embed OR — no client ID prefetch / limit(200)", () => {
    const source = readFileSync(
      path.join(root, "app/api/orders/route.ts"),
      "utf8"
    );
    assert.match(source, /normalizeOrdersListQuery/);
    assert.match(source, /buildOrdersListSearchOrClause/);
    assert.match(source, /ORDERS_CLIENT_SEARCH_EMBED/);
    assert.match(source, /client_search\.name/);
    assert.match(source, /\.filter\("client_search\.name", "imatch"/);
    assert.match(source, /\.eq\("tenant_id", context\.tenant\.id\)/);
    assert.match(source, /applyNonArchivedOrdersFilter/);
    assert.equal(source.includes("service_role"), false);
    assert.equal(source.includes(".limit(200)"), false);
    assert.equal(source.includes("matchingClientIds"), false);
    assert.equal(source.includes("client_id.in"), false);
    assert.match(source, /client:clients\(\*\)/);
    assert.equal(/client:clients!inner/.test(source), false);
  });

  it("documents no arbitrary client-id cutoff (201+ regression)", () => {
    const helper = readFileSync(
      path.join(root, "lib/orders/list-search.ts"),
      "utf8"
    );
    const route = readFileSync(
      path.join(root, "app/api/orders/route.ts"),
      "utf8"
    );
    assert.equal(helper.includes("limit(200)"), false);
    assert.equal(route.includes('from("clients")'), false);
    assert.equal(ORDERS_CLIENT_SEARCH_EMBED, "client_search:clients()");
    assert.match(
      buildOrdersListSearchOrClause("acme"),
      /client_search\.not\.is\.null/
    );
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
