import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatActivityEvent } from "./format";
import type { ActivityEvent } from "./types";

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt-1",
    created_at: "2026-09-14T10:00:00.000Z",
    actor_type: "user",
    actor_name: "Rubén",
    user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    team_member_id: null,
    action: "membership.role_changed",
    entity_type: "membership",
    entity_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    entity_label: null,
    changed_field: "role",
    previous_values: { role: "staff" },
    new_values: { role: "admin" },
    metadata: { from_role: "staff", to_role: "admin" },
    ...overrides,
  };
}

describe("membership.role_changed activity", () => {
  it("describes an access role change without mentioning the team member", () => {
    const formatted = formatActivityEvent(event());
    assert.match(formatted.headline, /rol de acceso/i);
    assert.equal(formatted.href, "/team/access");
    assert.equal(
      formatted.changes.some((change) => /puesto|área|area/i.test(change.label)),
      false
    );
  });
});

describe("order.archived activity", () => {
  it("M. formats archive events without exposing raw IDs", () => {
    const formatted = formatActivityEvent(
      event({
        action: "order.archived",
        entity_type: "order",
        entity_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        entity_label: "PED-42",
        changed_field: null,
        previous_values: null,
        new_values: {
          archived_at: "2026-09-17T12:00:00.000Z",
        },
        metadata: {
          reference: "PED-42",
          status_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        },
      })
    );

    assert.match(formatted.headline, /archiv/i);
    assert.equal(formatted.summary, "Pedido archivado");
    assert.equal(formatted.href, "/orders/cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert.equal(
      formatted.changes.some((change) =>
        /dddddddd-dddd-4ddd-8ddd-dddddddddddd/i.test(
          `${change.from}${change.to}${change.label}`
        )
      ),
      false
    );
  });
});
