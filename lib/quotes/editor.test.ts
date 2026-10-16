import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_EDITOR_ITEMS, draftPayload, duplicateEditorItem, editorValidation, editorValues, emptyEditorItem, formatQuoteMoney, moveEditorItem } from "./editor";
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
  describe("duplicate line", () => {
    const line = (key: string, extra: Partial<ReturnType<typeof emptyEditorItem>> = {}) => ({ ...emptyEditorItem(key), concept: `Concepto ${key}`, ...extra });
    it("inserts an identical line right after the original with its own key", () => {
      const items = [line("a"), line("b", { description: "A4 color", quantity: "250", unit: "pág", unit_price: "0.085", discount_percent: "12.5", tax_rate: "10" }), line("c")];
      const next = duplicateEditorItem(items, 1, "copy");
      assert.deepEqual(next.map((item) => item.key), ["a", "b", "copy", "c"]);
      const fields = ({ concept, description, quantity, unit, unit_price, discount_percent, tax_rate }: (typeof next)[number]) => ({ concept, description, quantity, unit, unit_price, discount_percent, tax_rate });
      assert.notEqual(next[2].key, next[1].key);
      assert.deepEqual(fields(next[2]), fields(next[1]));
      assert.deepEqual(fields(next[2]), { concept: "Concepto b", description: "A4 color", quantity: "250", unit: "pág", unit_price: "0.085", discount_percent: "12.5", tax_rate: "10" });
    });
    it("works at the first and last position", () => {
      const items = [line("a"), line("b")];
      assert.deepEqual(duplicateEditorItem(items, 0, "x").map((item) => item.key), ["a", "x", "b"]);
      assert.deepEqual(duplicateEditorItem(items, 1, "y").map((item) => item.key), ["a", "b", "y"]);
    });
    it("does not mutate the input and creates an independent object", () => {
      const items = [line("a")]; const before = JSON.stringify(items);
      const next = duplicateEditorItem(items, 0, "copy");
      assert.equal(JSON.stringify(items), before); assert.notEqual(next, items);
      assert.notEqual(next[1], next[0]);
      next[1] = { ...next[1], concept: "Editada", quantity: "9" };
      assert.equal(next[0].concept, "Concepto a"); assert.equal(next[0].quantity, "1");
    });
    it("copies only editable fields, never server-computed data or identity", () => {
      const saved = { ...line("saved-id"), id: "saved-id", position: 3, subtotal: "100.00", tax_amount: "21.00", total: "121.00" };
      const [, copy] = duplicateEditorItem([saved], 0, "new-key") as Array<Record<string, unknown>>;
      assert.deepEqual(Object.keys(copy).sort(), ["concept", "description", "discount_percent", "key", "quantity", "tax_rate", "unit", "unit_price"]);
      for (const field of ["id", "position", "subtotal", "tax_amount", "total"]) assert.equal(field in copy, false, field);
    });
    it("normalizes missing optional fields the same way the editor does", () => {
      const [, copy] = duplicateEditorItem([line("a", { description: undefined, unit: undefined })], 0, "x");
      assert.equal(copy.description, null); assert.equal(copy.unit, null);
    });
    it("is a no-op for an out-of-range index, an empty or repeated key", () => {
      const items = [line("a"), line("b")];
      for (const index of [-1, 2, 99, Number.NaN]) assert.equal(duplicateEditorItem(items, index, "x"), items);
      assert.equal(duplicateEditorItem(items, 0, ""), items);
      assert.equal(duplicateEditorItem(items, 0, "b"), items);
      assert.equal(duplicateEditorItem([], 0, "x").length, 0);
    });
    it("respects the 500-line limit exactly", () => {
      assert.equal(MAX_EDITOR_ITEMS, 500);
      const items = Array.from({ length: 499 }, (_, i) => line(`k${i}`));
      const full = duplicateEditorItem(items, 10, "last");
      assert.equal(full.length, 500);
      assert.equal(duplicateEditorItem(full, 10, "over"), full);
      assert.equal(editorValidation({ ...editorValues(detail), items: full.map((item) => ({ ...item, concept: "x" })) }).some((error) => error.includes("500")), false);
    });
    it("keeps copies as ordinary lines: valid, payload without client totals, no alternative marker", () => {
      const values = editorValues(detail);
      values.items = duplicateEditorItem([line("a", { concept: "Copias", quantity: "100" })], 0, "b");
      values.items[1] = { ...values.items[1], quantity: "500" };
      assert.deepEqual(editorValidation(values), []);
      const payload = draftPayload(detail, values);
      assert.equal(payload.items.length, 2);
      assert.deepEqual(payload.items.map((item) => item.quantity), ["100", "500"]);
      for (const item of payload.items) {
        assert.deepEqual(Object.keys(item).sort(), ["concept", "description", "discount_percent", "quantity", "tax_rate", "unit", "unit_price"]);
      }
    });
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
