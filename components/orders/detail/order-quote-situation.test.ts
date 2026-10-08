import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
  OrderQuoteSituationField,
  OrderQuoteSituationValue,
} from "./order-quote-situation";
import { resolveOrderQuoteSituation } from "@/lib/orders/quote-situation";
import type { ManagementOption, SourceQuote } from "@/lib/orders/types";

const options: ManagementOption[] = [
  { id: "s-nr", code: "not_required", name: "No requerido" },
  { id: "s-pending", code: "pending", name: "En revisión" },
  { id: "s-acc", code: "accepted", name: "Aceptado" },
];

const source: SourceQuote = {
  id: "q-6",
  reference: "SUR4-P0006",
  total: "126.00",
  currency: "EUR",
  status: "accepted",
  version_number: 1,
};

const pending = { code: "pending", name: "En revisión" };

function value(sourceQuote: SourceQuote | null, quoteStatus: { code: string; name: string } | null) {
  return renderToStaticMarkup(
    createElement(OrderQuoteSituationValue, {
      situation: resolveOrderQuoteSituation({ sourceQuote, quoteStatus, quoteStatusOptions: options }),
    })
  );
}

function field(sourceQuote: SourceQuote | null, stored: string | null) {
  return renderToStaticMarkup(
    createElement(OrderQuoteSituationField, {
      situation: resolveOrderQuoteSituation({
        sourceQuote,
        quoteStatus: stored ? pending : null,
        quoteStatusOptions: options,
      }),
      value: stored,
      storedId: stored,
      options,
      onChange: () => {},
    })
  );
}

describe("order ficha · Producción · Presupuesto", () => {
  it("shows No requerido instead of an undefined value for orders without quote", () => {
    const html = value(null, null);
    assert.match(html, /No requerido/);
    assert.equal(html.includes("Sin definir"), false);
    assert.equal(html.includes("—"), false);
  });

  it("derives Aceptado · Convertido en pedido with a badge and an internal-id link", () => {
    const html = value(source, null);
    assert.match(html, /Aceptado/);
    assert.match(html, /Convertido en pedido/);
    assert.match(html, /href="\/quotes\/q-6"/);
    assert.match(html, /SUR4-P0006/);
    assert.match(html, /ring-inset/);
  });

  it("ignores a stale manual value when a source quote exists", () => {
    const html = value(source, pending);
    assert.equal(html.includes("En revisión"), false);
    assert.match(html, /Convertido en pedido/);
  });

  it("keeps a manual pending indication visible for orders without source quote", () => {
    assert.match(value(null, pending), /En revisión/);
  });

  it("edit mode: the derived value is read-only for linked orders", () => {
    const html = field(source, null);
    assert.equal(html.includes("<select"), false);
    assert.match(html, /no se edita aquí/);
    assert.match(html, /href="\/quotes\/q-6"/);
  });

  it("edit mode: manual selector offers No requerido once and the tenant statuses", () => {
    const html = field(null, null);
    assert.match(html, /<select/);
    assert.equal(html.match(/No requerido/g)?.length, 1);
    assert.match(html, /En revisión/);
    assert.equal(html.includes("Sin definir"), false);
  });

  it("edit mode: a stored not_required value stays selectable", () => {
    const html = renderToStaticMarkup(
      createElement(OrderQuoteSituationField, {
        situation: resolveOrderQuoteSituation({
          sourceQuote: null,
          quoteStatus: { code: "not_required", name: "No requerido" },
        }),
        value: "s-nr",
        storedId: "s-nr",
        options,
        onChange: () => {},
      })
    );
    assert.match(html, /value="s-nr"/);
  });

  it("Producción and the workspace are wired to the tenant-scoped source quote", () => {
    const production = readFileSync(new URL("./order-production.tsx", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("./order-workspace.tsx", import.meta.url), "utf8");
    assert.match(production, /resolveOrderQuoteSituation\(\{\s*sourceQuote,/);
    assert.match(production, /<OrderQuoteSituationValue situation=\{quoteSituation\} \/>/);
    assert.match(production, /<OrderQuoteSituationField/);
    assert.equal(production.includes("— Sin definir —</option>\n            {managementOptions?.quote_statuses"), false);
    assert.match(workspace, /sourceQuote=\{sourceQuote\}/);
  });
});
