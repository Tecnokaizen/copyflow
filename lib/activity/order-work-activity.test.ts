import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatActivityEvent, actionsForEntity } from "./format";
import {
  NOTE_ACTIVITY_ACTIONS,
  WORK_STEP_ACTIVITY_ACTIONS,
  orderWorkActivityHeadline,
  orderWorkActivityText,
} from "./order-work-activity";
import { ACTIVITY_ACTIONS } from "./types";
import { formatActivityText } from "../orders/format";
import type { ActivityItem } from "../orders/types";

describe("SUR4 activity texts (T9: no note text)", () => {
  it("covers every action the E5/E7 migrations write", () => {
    for (const action of [...NOTE_ACTIVITY_ACTIONS, ...WORK_STEP_ACTIVITY_ACTIONS]) {
      assert.ok((ACTIVITY_ACTIONS as readonly string[]).includes(action), action);
      assert.ok(orderWorkActivityText(action, {}, {}), action);
    }
  });

  it("says whether a new Post-it is internal or printable", () => {
    assert.equal(
      orderWorkActivityText("order.note_created", null, { visibility: "internal" }),
      "Añadió un post-it interno"
    );
    assert.equal(
      orderWorkActivityText("order.note_created", null, { visibility: "printable" }),
      "Añadió un post-it imprimible"
    );
  });

  it("describes steps by stage and person", () => {
    assert.equal(
      orderWorkActivityText(
        "order.work_steps_changed",
        { steps: [] },
        {
          steps: [
            { stage_name: "Diseño", team_member_name: "Jesús" },
            { stage_name: "Impresión", team_member_name: null },
          ],
        }
      ),
      "Secuencia de trabajo: sin pasos ⇒ Diseño (Jesús) → Impresión"
    );
    assert.equal(
      orderWorkActivityText("order.work_step_completed", {}, {
        stage_name: "Preparación",
        executed_by_name: "Raquel",
      }),
      "Paso hecho: Preparación, por Raquel"
    );
    assert.equal(
      orderWorkActivityHeadline("order.work_step_reopened", { stage_name: "Corte" }, {}, "S4C-0020"),
      "Reabrió el paso Corte de S4C-0020"
    );
  });

  it("feeds the order page and the activity page", () => {
    const item = {
      id: "a",
      action: "order.note_voided",
      entity_type: "order",
      entity_id: "o",
      user_id: null,
      team_member_id: null,
      previous_values: {},
      new_values: {},
      metadata: { reference: "S4C-0020" },
      created_at: "2026-10-28T10:00:00Z",
    } as unknown as ActivityItem;
    assert.equal(formatActivityText(item), "Anuló un post-it");

    const formatted = formatActivityEvent({
      id: "a",
      created_at: "2026-10-28T10:00:00Z",
      actor_type: "user",
      actor_name: "Raquel",
      user_id: null,
      team_member_id: null,
      action: "order.work_step_completed",
      entity_type: "order",
      entity_id: "o",
      entity_label: "S4C-0020",
      changed_field: null,
      previous_values: { stage_name: "Preparación" },
      new_values: { stage_name: "Preparación", executed_by_name: "Raquel" },
      metadata: { reference: "S4C-0020", field: "work_steps" },
    });
    assert.equal(formatted.headline, "Marcó hecho el paso Preparación de S4C-0020");

    const values = actionsForEntity("order").map((option) => option.value);
    assert.ok(values.includes("order.work_step_completed"));
    assert.ok(values.includes("order.note_created"));
  });
});
