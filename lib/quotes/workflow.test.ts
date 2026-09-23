import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { quoteStatusTone } from "./types";
import {
  operationalCreateVisibility,
  quoteCountLabel,
  quotePageRange,
  parseQuoteListQuery,
  quoteListQuery,
  quoteSearchFilter,
  quoteStatusFilters,
} from "./workflow";

describe("quote status filters", () => {
  it("keeps pending and shows the tenant name, including sent", () => {
    assert.deepEqual(
      quoteStatusFilters([
        { code: "rejected", name: "Rechazado" },
        { code: "pending", name: "En curso del cliente" },
        { code: "draft", name: "Borrador" },
        { code: "accepted", name: "Aceptado" },
        { code: "sent", name: "Enviado" },
        { code: "custom", name: "Interno" },
      ]),
      [
        { code: "draft", name: "Borrador" },
        { code: "pending", name: "En curso del cliente" },
        { code: "sent", name: "Enviados" },
        { code: "accepted", name: "Aceptados" },
        { code: "rejected", name: "Rechazados" },
      ]
    );
  });

  it("omits sent until the catalog has it", () => {
    assert.deepEqual(
      quoteStatusFilters([
        { code: "draft", name: "Borrador" },
        { code: "pending", name: "En revisión" },
      ]).map((status) => status.code),
      ["draft", "pending"]
    );
  });

  it("tones sent as info and keeps pending", () => {
    assert.equal(quoteStatusTone("sent"), "info");
    assert.equal(quoteStatusTone("pending"), "warning");
  });
});

describe("quote list copy", () => {
  it("counts quotes and the visible page range", () => {
    assert.equal(quoteCountLabel(0), "0 presupuestos");
    assert.equal(quoteCountLabel(1), "1 presupuesto");
    assert.equal(quoteCountLabel(12), "12 presupuestos");
    assert.deepEqual(quotePageRange(2, 25, 10, 35), {
      from: 26,
      to: 35,
      total: 35,
    });
    assert.equal(quotePageRange(1, 25, 0, 0), null);
  });
});

describe("quote search", () => {
  it("includes the tenant client ids and ignores anything else", () => {
    const filter = quoteSearchFilter("%ana%", [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "not-a-uuid",
    ]);

    assert.match(filter, /reference\.ilike\.%ana%/);
    assert.match(filter, /title\.ilike\.%ana%/);
    assert.match(filter, /description\.ilike\.%ana%/);
    assert.match(
      filter,
      /client_id\.in\.\(aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\)/
    );
    assert.equal(filter.includes("not-a-uuid"), false);
  });
});

describe("operational create actions", () => {
  it("shows a new order for writers and a new quote only for owner or admin with the feature", () => {
    assert.deepEqual(operationalCreateVisibility("owner", true), {
      order: true,
      quote: true,
    });
    assert.deepEqual(operationalCreateVisibility("admin", true), {
      order: true,
      quote: true,
    });
    assert.deepEqual(operationalCreateVisibility("manager", true), {
      order: true,
      quote: false,
    });
    assert.deepEqual(operationalCreateVisibility("staff", true), {
      order: true,
      quote: false,
    });
    assert.deepEqual(operationalCreateVisibility("viewer", true), {
      order: false,
      quote: false,
    });
    assert.deepEqual(operationalCreateVisibility("owner", false), {
      order: true,
      quote: false,
    });
  });

  it("places Nuevo pedido and Nuevo presupuesto on the operational screens", () => {
    const actions = readFileSync(
      new URL("../../components/quotes/operational-create-actions.tsx", import.meta.url),
      "utf8"
    );
    assert.match(actions, /Nuevo pedido/);
    assert.match(actions, /Nuevo presupuesto/);

    for (const file of [
      "app/orders/page.tsx",
      "app/orders/mine/page.tsx",
      "app/counter/page.tsx",
      "components/quotes/quotes-list.tsx",
    ]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.match(source, /OperationalCreateActions/);
    }

    const list = readFileSync(
      new URL("../../components/quotes/quotes-list.tsx", import.meta.url),
      "utf8"
    );
    assert.match(list, /converted_order/);
    assert.match(list, /quoteStatusFilters/);
    assert.match(list, /Mostrando/);
    assert.match(list, /quoteListQuery/);
  });

  it("keeps status filters in the quotes URL", () => {
    assert.equal(quoteListQuery({ status: "sent" }), "/quotes?status=sent");
    assert.equal(
      quoteListQuery({ status: "pending", q: "ana", page: 2 }),
      "/quotes?status=pending&q=ana&page=2"
    );
    assert.deepEqual(
      parseQuoteListQuery(new URLSearchParams("status=sent&q=ana&page=2")),
      { status: "sent", q: "ana", page: 2 }
    );
    assert.equal(
      parseQuoteListQuery(new URLSearchParams("status=nope")).status,
      ""
    );
  });
});
