import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatActivityText } from "./format";
import type { ActivityItem } from "./types";

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "act-1",
    action: "order.created",
    entity_type: "order",
    entity_id: "order-1",
    user_id: null,
    team_member_id: null,
    previous_values: null,
    new_values: null,
    metadata: {},
    created_at: "2026-09-17T12:00:00.000Z",
    actor: { id: "user-1", name: "Ana" },
    ...overrides,
  };
}

describe("formatActivityText order.archived", () => {
  it("M. renders Pedido archivado for order detail timeline", () => {
    assert.equal(
      formatActivityText(
        item({
          action: "order.archived",
          metadata: {
            reference: "PED-42",
            status_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          },
        })
      ),
      "Pedido archivado"
    );
  });

  it("keeps created and status_changed formatting", () => {
    assert.equal(formatActivityText(item({ action: "order.created" })), "Pedido creado");
    assert.equal(
      formatActivityText(
        item({
          action: "order.status_changed",
          previous_values: { status_name: "En curso" },
          new_values: { status_name: "Listo" },
        })
      ),
      "En curso → Listo"
    );
  });
});
