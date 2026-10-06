import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftPayload, editorValidation, editorValues, emptyEditorItem, formatQuoteMoney, moveEditorItem } from "./editor";
import { parseOperationalQuotePayload } from "./payload";
import type { QuoteCommercialDetail } from "./types";
import { parseQuoteListQuery, quoteListQuery, quoteStatusFilters } from "./workflow";

const detail = {
  quote: { id: "q", row_version: 99, title: "Old", description: "Trabajo", notes: "Condiciones", currency: "EUR", issue_date: "2026-10-05", prices_include_tax: false },
  current_version: { id: "v", state: "draft", row_version: 4, title: "Nuevo", description: "Trabajo", terms: "Términos", currency: "EUR", issue_date: "2026-10-05", prices_include_tax: false },
  items: [], versions: [],
} as unknown as QuoteCommercialDetail;
describe("commercial draft editor model", () => {
  it("uses the version header and concurrency token, not quotes.row_version", () => {
    const values = editorValues(detail);
    assert.equal(values.header.title, "Nuevo");
    values.items.push(emptyEditorItem("local")); values.items[0].concept = "Copias";
    const payload = draftPayload(detail, values);
    assert.equal(payload.expected_row_version, 4);
    assert.equal(payload.version_id, "v");
    assert.equal("key" in payload.items[0], false);
    assert.equal("total" in payload.items[0], false);
  });
  it("preserves legacy data when no current version exists", () => {
    const values = editorValues({ ...detail, current_version: null });
    assert.equal(values.header.title, "Old"); assert.equal(values.header.terms, "Condiciones");
  });
  it("never builds writable payloads for prepared or sent history", () => {
    for (const state of ["prepared", "sent"] as const) assert.throws(() => draftPayload({ ...detail, current_version: { ...detail.current_version!, state } }, editorValues(detail)));
  });
  it("validates concept, quantity, price, discount and tax before saving", () => {
    const values = editorValues(detail); values.items = [{ ...emptyEditorItem("a"), concept: "", quantity: "0", unit_price: "-1", discount_percent: "101", tax_rate: "-2" }];
    assert.equal(editorValidation(values).length, 5);
    values.items = [{ ...emptyEditorItem("a"), concept: "Copias", quantity: "2.5", discount_percent: "100" }];
    assert.deepEqual(editorValidation(values), []);
  });
  it("reorders without changing identity or mutating original lines", () => {
    const items = [emptyEditorItem("a"), emptyEditorItem("b"), emptyEditorItem("c")];
    assert.deepEqual(moveEditorItem(items, 1, -1).map((item) => item.key), ["b", "a", "c"]);
    assert.deepEqual(items.map((item) => item.key), ["a", "b", "c"]);
    assert.equal(moveEditorItem(items, 0, -1), items);
  });
  it("formats server strings without a client-side totals calculator", () => {
    assert.match(formatQuoteMoney("121.00", "EUR"), /121,00/);
    assert.equal(formatQuoteMoney(undefined), "—");
  });
  it("supports expired as a filter without a prepared commercial status", () => {
    assert.equal(quoteListQuery({ status: "expired" }), "/quotes?status=expired");
    assert.equal(parseQuoteListQuery(new URLSearchParams("status=prepared")).status, "");
    assert.deepEqual(quoteStatusFilters([]).map((item) => item.code), ["draft", "sent", "accepted", "rejected", "expired"]);
  });
  it("operational PATCH excludes document data and keeps the old full parser separate", () => {
    const input = { operational_only: true, expected_row_version: 99, client_id: null, service_id: null, assigned_team_member_id: null };
    const parsed = parseOperationalQuotePayload(input);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(Object.keys(parsed.data).sort(), ["assigned_team_member_id", "client_id", "expected_row_version", "service_id"]);
    for (const key of ["title", "description", "notes", "valid_until", "contact_email", "billing_name", "currency", "items"]) assert.equal(parseOperationalQuotePayload({ ...input, [key]: "overwrite" }).ok, false);
  });
});
