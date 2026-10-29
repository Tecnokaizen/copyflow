import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderLabels, RECEIPT_DESCRIPTION_TITLE } from "./labels";
import { NO_ORDER_FEATURES, ORDER_FEATURE_CODES } from "./order-features";

describe("order labels (SUR4 N16, N21)", () => {
  it("keeps today's names without the grant", () => {
    assert.deepEqual(orderLabels({ custom: false }), {
      total: "Total del pedido",
      paid: "Entregado a cuenta",
      due: "Pendiente de cobro",
      description: "Instrucciones",
    });
  });

  it("uses SUR4 names only with order_custom_labels", () => {
    assert.deepEqual(orderLabels({ custom: true }), {
      total: "Total pedido",
      paid: "A cuenta",
      due: "Falta por abonar",
      description: "Descripción",
    });
    assert.equal(RECEIPT_DESCRIPTION_TITLE, "Descripción del trabajo");
  });
});

describe("order features (contract §4)", () => {
  it("names the four A1 codes and starts everything off", () => {
    assert.deepEqual(Object.values(ORDER_FEATURE_CODES).sort(), [
      "order_custom_labels",
      "order_sticky_notes",
      "order_work_sequence",
      "order_work_sheet_ficha",
    ]);
    assert.ok(Object.values(NO_ORDER_FEATURES).every((value) => value === false));
  });
});
