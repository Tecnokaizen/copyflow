import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  QUOTE_NOT_REQUIRED_LABEL,
  formatOrderQuoteSituation,
  manualQuoteStatusOptions,
  resolveOrderQuoteSituation,
} from "./quote-situation";
import { buildDraftSaveSteps, createOrderDraft } from "./draft";
import type { Order, SourceQuote } from "./types";

const catalog = [
  { id: "s-nr", code: "not_required", name: "No requerido" },
  { id: "s-draft", code: "draft", name: "Borrador" },
  { id: "s-pending", code: "pending", name: "En revisión" },
  { id: "s-sent", code: "sent", name: "Enviado" },
  { id: "s-acc", code: "accepted", name: "Aceptado" },
  { id: "s-rej", code: "rejected", name: "Rechazado" },
];

const source: SourceQuote = {
  id: "q-6",
  reference: "SUR4-P0006",
  total: "126.00",
  currency: "EUR",
  status: "accepted",
  version_number: 2,
};

describe("order quote situation", () => {
  it("1. order without quote and without indication → No requerido", () => {
    const situation = resolveOrderQuoteSituation({ sourceQuote: null, quoteStatus: null });
    assert.equal(situation.kind, "not_required");
    assert.equal(formatOrderQuoteSituation(situation), "No requerido");
    assert.notEqual(formatOrderQuoteSituation(situation), "Sin definir");
  });

  it("2. order that requires a quote keeps its pending need visible", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: null,
      quoteStatus: { code: "draft", name: "Borrador" },
    });
    assert.deepEqual(situation, { kind: "manual", code: "draft", label: "Borrador" });
  });

  it("3. pending quote indication shows the tenant status name", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: null,
      quoteStatus: { code: "pending", name: "En revisión" },
    });
    assert.equal(formatOrderQuoteSituation(situation), "En revisión");
  });

  it("4. sent quote indication shows Enviado", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: null,
      quoteStatus: { code: "sent", name: "Enviado" },
    });
    assert.equal(situation.kind, "manual");
    assert.equal(situation.label, "Enviado");
  });

  it("5. accepted source quote is derived even when the order field is empty (SUR4-0014 case)", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: source,
      quoteStatus: null,
      quoteStatusOptions: catalog,
    });
    assert.equal(situation.kind, "source");
    assert.equal(situation.label, "Aceptado");
  });

  it("6. converted order reads Aceptado · Convertido en pedido and keeps both concepts", () => {
    const situation = resolveOrderQuoteSituation({ sourceQuote: source, quoteStatus: null });
    assert.equal(formatOrderQuoteSituation(situation), "Aceptado · Convertido en pedido");
    assert.equal(situation.kind === "source" && situation.code, "accepted");
    assert.equal(situation.kind === "source" && situation.detail, "Convertido en pedido");
  });

  it("7. rejected indication without source quote is shown as such", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: null,
      quoteStatus: { code: "rejected", name: "Rechazado" },
    });
    assert.equal(situation.label, "Rechazado");
  });

  it("8. the situation is derived on every read: source wins over a stale manual value", () => {
    const stale = { code: "pending", name: "En revisión" };
    const before = resolveOrderQuoteSituation({ sourceQuote: null, quoteStatus: stale });
    const after = resolveOrderQuoteSituation({ sourceQuote: source, quoteStatus: stale });
    assert.equal(before.label, "En revisión");
    assert.equal(formatOrderQuoteSituation(after), "Aceptado · Convertido en pedido");
  });

  it("8b. uses the tenant's own catalog name for the source status", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: source,
      quoteStatus: null,
      quoteStatusOptions: [{ code: "accepted", name: "Aprobado por cliente" }],
    });
    assert.equal(situation.label, "Aprobado por cliente");
  });

  it("9. versioned quotes: the derived state does not depend on the accepted version number", () => {
    const v1 = resolveOrderQuoteSituation({ sourceQuote: { ...source, version_number: 1 }, quoteStatus: null });
    const v5 = resolveOrderQuoteSituation({ sourceQuote: { ...source, version_number: 5 }, quoteStatus: null });
    assert.deepEqual(v1, v5);
  });

  it("10. multi-tenant: no source quote from the RPC means no derived quote information", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: null,
      quoteStatus: null,
      quoteStatusOptions: catalog,
    });
    assert.equal(situation.kind, "not_required");

    const route = readFileSync(new URL("../../app/api/orders/[id]/route.ts", import.meta.url), "utf8");
    assert.match(route, /\.eq\("tenant_id", context\.tenant\.id\)/);
    assert.match(route, /order_source_quote_v2", \{\s*p_tenant_id: context\.tenant\.id, p_order_id: id/);
    assert.equal(route.includes("service_role"), false);

    const sql = readFileSync(
      new URL("../../supabase/migrations/20261006110000_quote_accepted_conversion.sql", import.meta.url),
      "utf8"
    );
    const fn = sql.slice(sql.indexOf("create function public.order_source_quote_v2"));
    assert.match(fn, /q\.tenant_id=p_tenant_id and q\.converted_order_id=p_order_id/);
    assert.match(fn, /has_tenant_role\(q\.tenant_id/);
  });

  it("11. source situation carries the internal quote id for navigation", () => {
    const situation = resolveOrderQuoteSituation({ sourceQuote: source, quoteStatus: null });
    assert.deepEqual(situation.kind === "source" && situation.quote, {
      id: "q-6",
      reference: "SUR4-P0006",
    });
  });

  it("12a. compatibility: existing manual values keep showing their catalog name", () => {
    const situation = resolveOrderQuoteSituation({
      sourceQuote: null,
      quoteStatus: { code: "not_required", name: "No requerido" },
    });
    assert.equal(situation.kind, "manual");
    assert.equal(situation.label, QUOTE_NOT_REQUIRED_LABEL);
  });

  it("12b. the manual selector hides a duplicate not_required option unless it is stored", () => {
    assert.deepEqual(
      manualQuoteStatusOptions(catalog, null).map((option) => option.code),
      ["draft", "pending", "sent", "accepted", "rejected"]
    );
    assert.ok(manualQuoteStatusOptions(catalog, "s-nr").some((option) => option.code === "not_required"));
    assert.deepEqual(manualQuoteStatusOptions(null, null), []);
  });

  it("12c. a linked order never writes the derived value back to orders.quote_status_id", () => {
    const order = {
      id: "o-14",
      title: "Pedido",
      priority: "normal",
      status_id: "st-1",
      quote_status_id: null,
      quote_status: null,
    } as unknown as Order;
    const draft = createOrderDraft(order, []);
    assert.equal(draft.quote_status_id, null);
    const steps = buildDraftSaveSteps(order, draft, []);
    assert.equal(
      steps.some((step) => "field" in step && step.field === "quote_status_id"),
      false
    );
  });
});
