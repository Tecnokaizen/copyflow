import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatActivityEvent } from "../../activity/format";
import type { ActivityEvent } from "../../activity/types";
import { parseStepOrderStatus } from "./payload";
import { autoFinishNotice, stillReadyNotice } from "./view";

// Addendum 02 · automatic finish of orders with a work sequence: the parts the
// browser sees (answer parsing, notices and the activity line).

const STATUS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("parseStepOrderStatus", () => {
  it("keeps only a well-formed status", () => {
    assert.deepEqual(parseStepOrderStatus({ id: STATUS_ID, code: "ready", name: "Listo", automatic: true, extra: 1 }), {
      id: STATUS_ID,
      code: "ready",
      name: "Listo",
      automatic: true,
    });
    for (const value of [null, undefined, "x", [], { id: "nope", code: "ready", name: "Listo", automatic: true },
      { id: STATUS_ID, code: "ready", name: "Listo" }, { id: STATUS_ID, code: 3, name: "Listo", automatic: true }]) {
      assert.equal(parseStepOrderStatus(value), null);
    }
  });
});

describe("work sequence notices", () => {
  it("announces the automatic finish with the tenant's own status name", () => {
    assert.equal(
      autoFinishNotice({ id: STATUS_ID, code: "terminado_taller", name: "Terminado", automatic: true }),
      "Secuencia completada: el pedido ha pasado automáticamente a «Terminado»."
    );
    assert.equal(autoFinishNotice({ id: STATUS_ID, code: "ready", name: "Listo", automatic: false }), null);
    assert.equal(autoFinishNotice(null), null);
  });

  it("warns that undoing a step keeps the ready status (D-B)", () => {
    assert.equal(
      stillReadyNotice("order_stays_ready", { id: STATUS_ID, code: "ready", name: "Terminado", automatic: false }),
      "El pedido sigue en «Terminado». Si vuelve a producción, cambia el estado a mano."
    );
    assert.match(stillReadyNotice("order_stays_ready", null) ?? "", /sigue en «Listo»/);
    assert.equal(stillReadyNotice(null, null), null);
  });
});

function statusEvent(metadata: { [key: string]: string | boolean }): ActivityEvent {
  return {
    id: "evt-auto",
    created_at: "2026-11-04T10:00:00.000Z",
    actor_type: "user",
    actor_name: "Raquel",
    user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    team_member_id: null,
    action: "order.status_changed",
    entity_type: "order",
    entity_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    entity_label: "SUR4-0106",
    changed_field: "status",
    previous_values: { status_id: STATUS_ID, status_code: "in_progress", status_name: "En proceso" },
    new_values: { status_id: STATUS_ID, status_code: "ready", status_name: "Terminado" },
    metadata,
  };
}

describe("order.status_changed activity", () => {
  it("says the change was automatic and which stage triggered it", () => {
    const auto = formatActivityEvent(
      statusEvent({ reference: "SUR4-0106", automatic: true, trigger: "work_sequence_completed", stage_name: "Acabado" })
    );
    assert.equal(auto.headline, "Cambio automático de estado de SUR4-0106 al completar la última etapa (Acabado)");
    assert.equal(auto.actor, "Raquel");
    assert.equal(auto.changes[0]?.from, "En proceso");
    assert.equal(auto.changes[0]?.to, "Terminado");

    const noStage = formatActivityEvent(statusEvent({ reference: "SUR4-0106", automatic: true }));
    assert.match(noStage.headline, /al completar la secuencia de trabajo$/);
  });

  it("keeps the manual wording", () => {
    assert.equal(formatActivityEvent(statusEvent({ reference: "SUR4-0106" })).headline, "Cambió el estado de SUR4-0106");
    assert.equal(
      formatActivityEvent(statusEvent({ reference: "SUR4-0106", automatic: "true" })).headline,
      "Cambió el estado de SUR4-0106"
    );
  });
});
