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
