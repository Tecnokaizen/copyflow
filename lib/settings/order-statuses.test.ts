import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  nextAvailableStatusCode,
  orderStatusKindFromFlags,
  parseOrderStatusPayload,
  statusCodeBaseFromName,
} from "./order-statuses";

describe("order status settings helpers", () => {
  it("derives semantic kind from lifecycle flags", () => {
    assert.equal(orderStatusKindFromFlags({ is_initial: true }), "initial");
    assert.equal(orderStatusKindFromFlags({ is_ready: true }), "ready");
    assert.equal(orderStatusKindFromFlags({ is_closed: true }), "closed");
    assert.equal(orderStatusKindFromFlags({ is_cancelled: true }), "cancelled");
    assert.equal(orderStatusKindFromFlags({}), "in_progress");
  });

  it("creates stable internal codes from tenant labels", () => {
    assert.equal(statusCodeBaseFromName("En impresión"), "en_impresion");
    assert.equal(statusCodeBaseFromName("  Listo / Recoger  "), "listo_recoger");
    assert.equal(statusCodeBaseFromName("---"), "status");
  });

  it("chooses a non-conflicting code without exposing code editing", () => {
    assert.equal(
      nextAvailableStatusCode("En proceso", ["en_proceso", "en_proceso_2"]),
      "en_proceso_3"
    );
  });

  it("accepts only the safe Settings payload", () => {
    assert.deepEqual(
      parseOrderStatusPayload({
        name: "Diseño",
        kind: "in_progress",
        active: true,
        sort_order: 20,
      }),
      {
        ok: true,
        data: {
          name: "Diseño",
          kind: "in_progress",
          active: true,
          sort_order: 20,
        },
      }
    );

    assert.equal(
      parseOrderStatusPayload({
        name: "Recibido",
        kind: "initial",
        active: false,
        sort_order: 1,
      }).ok,
      true
    );

    assert.equal(
      parseOrderStatusPayload({
        name: "Hack",
        kind: "closed",
        active: true,
        sort_order: 1,
        tenant_id: "forged",
      }).ok,
      false
    );
  });
});
