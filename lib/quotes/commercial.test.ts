import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  commercialFailureBody,
  interpretCommercialDatabaseError,
  interpretCommercialRpcResult,
} from "./commercial";
import {
  mapQuote,
  mapQuoteItem,
  mapQuoteVersion,
  summarizeQuoteVersion,
} from "./types";

const QUOTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function versionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION,
    quote_id: QUOTE,
    version_number: 2,
    state: "draft",
    title: "Congreso",
    description: "<p>Material</p>",
    terms: null,
    issue_date: "2026-10-05",
    valid_until: "2026-10-31",
    currency: "EUR",
    prices_include_tax: true,
    subtotal: "520.66",
    tax_total: "109.34",
    total: "630.00",
    tax_breakdown: [
      { tax_rate: "21.000000", subtotal: "520.66", tax_amount: "109.34", total: "630.00" },
    ],
    pdf_file_id: null,
    created_at: "2026-10-05T12:00:00.000Z",
    locked_at: null,
    sent_at: null,
    row_version: 4,
    seller_snapshot: { hidden: true },
    client_snapshot: { hidden: true },
    ...overrides,
  };
}

describe("commercial quote contracts", () => {
  it("maps authoritative decimals without exposing internal snapshots", () => {
    const version = mapQuoteVersion(versionFixture());
    assert.ok(version);
    assert.equal(version.total, "630.00");
    assert.equal(version.tax_breakdown[0].tax_amount, "109.34");
    assert.equal("seller_snapshot" in version, false);
    assert.equal("client_snapshot" in version, false);

    assert.deepEqual(summarizeQuoteVersion(version), {
      pdf_file_id: null,
      id: VERSION,
      version_number: 2,
      state: "draft",
      issue_date: "2026-10-05",
      valid_until: "2026-10-31",
      currency: "EUR",
      subtotal: "520.66",
      tax_total: "109.34",
      total: "630.00",
      created_at: "2026-10-05T12:00:00.000Z",
      locked_at: null,
      sent_at: null,
      row_version: 4,
    });
  });

  it("maps list summaries while preserving every pre-existing quote field", () => {
    const quote = mapQuote({
      id: QUOTE,
      reference: "P-0001",
      title: "Congreso",
      description: "<p>Material</p>",
      notes: null,
      contact_name: "Raquel",
      contact_email: "raquel@example.com",
      contact_phone: null,
      billing_name: "ANFRE",
      tax_id: null,
      billing_address: null,
      issue_date: "2026-10-05",
      valid_until: "2026-10-31",
      currency: "EUR",
      prices_include_tax: true,
      subtotal: "520.66",
      tax_total: "109.34",
      total: "630.00",
      current_version_id: VERSION,
      accepted_version_id: null,
      converted_order_id: null,
      created_at: "2026-10-05T12:00:00.000Z",
      updated_at: "2026-10-05T12:01:00.000Z",
      row_version: 3,
      current_version: { version_number: 2, state: "draft" },
      status: { id: QUOTE, name: "Borrador", code: "draft", color: null },
      client: { id: QUOTE, name: "ANFRE" },
      service: null,
      assignee: null,
      converted_order: null,
    });

    assert.ok(quote);
    assert.equal(quote.reference, "P-0001");
    assert.equal(quote.description, "<p>Material</p>");
    assert.equal(quote.client?.name, "ANFRE");
    assert.equal(quote.current_version_number, 2);
    assert.equal(quote.total, "630.00");
    assert.equal(quote.converted_order_id, null);
  });

  it("maps line items with PostgreSQL decimal strings", () => {
    const item = mapQuoteItem({
      id: QUOTE,
      position: 1,
      concept: "Roll Up",
      description: null,
      quantity: "2.000000",
      unit: "ud",
      unit_price: "105.000000",
      discount_percent: "0.000000",
      tax_rate: "21.000000",
      subtotal: "173.55",
      tax_amount: "36.45",
      total: "210.00",
    });
    assert.ok(item);
    assert.equal(item.total, "210.00");
  });
});

describe("commercial RPC result mapping", () => {
  it("returns the database version and a machine-readable stale conflict", () => {
    const success = interpretCommercialRpcResult({ ok: true, version: versionFixture() });
    assert.equal(success.ok, true);
    if (success.ok) assert.equal(success.version.total, "630.00");

    const conflict = interpretCommercialRpcResult({
      ok: false,
      error: "conflict",
      row_version: "9",
    });
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.status, 409);
    assert.deepEqual(commercialFailureBody(conflict), {
      error: "El presupuesto cambió. Recarga e inténtalo de nuevo",
      code: "stale_row_version",
      current_row_version: 9,
    });
  });

  it("distinguishes transitions, business invariants and hidden resources", () => {
    for (const [error, status] of [
      ["not_found", 404],
      ["immutable_version", 409],
      ["draft_exists", 409],
      ["new_version_required", 409],
      ["items_required", 422],
      ["history_required", 422],
      ["invalid", 400],
    ] as const) {
      const result = interpretCommercialRpcResult({ ok: false, error });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, status, error);
    }

    assert.equal(interpretCommercialDatabaseError({ code: "23503" }, "fallback").status, 404);
    assert.equal(interpretCommercialDatabaseError({ code: "23514" }, "fallback").status, 422);
    assert.equal(interpretCommercialDatabaseError({ code: "55000" }, "fallback").status, 409);
  });
});

describe("commercial HTTP adapter wiring", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  it("adds fixed-query commercial detail without returning snapshot columns", () => {
    const types = source("lib/quotes/types.ts");
    const detail = source("app/api/quotes/[id]/route.ts");
    assert.match(detail, /Promise\.all\(\[/);
    assert.match(detail, /\.from\("quote_versions"\)/);
    assert.match(detail, /\.from\("quote_items"\)/);
    assert.match(detail, /\.eq\("tenant_id", access\.context\.tenant\.id\)/);
    assert.equal(/QUOTE_VERSION_SELECT[\s\S]*seller_snapshot/.test(types), false);
    assert.match(detail, /quote: loaded\.quote/);
    assert.match(detail, /current_version: currentVersion/);
    assert.match(detail, /versions: mappedVersions\.map\(summarizeQuoteVersion\)/);
  });

  it("wires draft, version and prepare routes only to commercial RPCs", () => {
    const draft = source("app/api/quotes/[id]/draft/route.ts");
    const versions = source("app/api/quotes/[id]/versions/route.ts");
    const prepare = source("app/api/quotes/[id]/prepare/route.ts");

    assert.match(draft, /\.rpc\("ensure_quote_draft_v1"/);
    assert.match(draft, /\.rpc\("save_quote_draft_v1"/);
    assert.match(draft, /p_header: parsed\.data\.header/);
    assert.match(draft, /p_items: parsed\.data\.items/);
    assert.match(versions, /\.rpc\("create_quote_version_v1"/);
    assert.match(versions, /result\.code === "draft_exists"/);
    assert.match(prepare, /\.rpc\("prepare_quote_version_v1"/);
    assert.equal(prepare.includes("status_id:"), false);
    assert.equal(prepare.includes("sent_at:"), false);
    assert.equal(draft.includes("tenant_id: parsed"), false);
  });

  it("keeps the existing list contract and enriches it in one query", () => {
    const route = source("app/api/quotes/route.ts");
    const types = source("lib/quotes/types.ts");
    assert.match(route, /quotes: \(data \?\? \[\]\)\.map\(mapQuote\)/);
    assert.match(types, /current_version:quote_versions!quotes_current_version_fk/);
    assert.match(types, /subtotal,/);
    assert.match(types, /tax_total,/);
    assert.match(types, /total,/);
    assert.match(types, /currency,/);
    assert.match(types, /issue_date,/);
    assert.match(types, /valid_until,/);
  });
});
