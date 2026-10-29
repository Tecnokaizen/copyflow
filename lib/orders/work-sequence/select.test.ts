import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WORK_STEP_SELECT } from "./select";

// SUR4 E1/E8: order_work_steps has two FKs to team_members, so an embed
// without its hint answers 300 (PGRST201) in PostgREST.
describe("work sequence PostgREST hints", () => {
  it("embeds the assigned person through order_work_steps_team_member_fk", () => {
    assert.ok(
      WORK_STEP_SELECT.includes(
        "team_member:team_members!order_work_steps_team_member_fk(id, name, active, can_receive_orders)"
      )
    );
  });

  it("embeds the executor through order_work_steps_executed_by_fk", () => {
    assert.ok(WORK_STEP_SELECT.includes("executed_by:team_members!order_work_steps_executed_by_fk(id, name)"));
  });

  it("has no team_members embed without a hint and never pulls every column", () => {
    const embeds = [...WORK_STEP_SELECT.matchAll(/team_members(![a-z_]+)?\s*\(([^)]*)\)/g)];
    assert.equal(embeds.length, 2);
    for (const [, hint, columns] of embeds) {
      assert.ok(hint, "missing hint");
      assert.notEqual(columns.trim(), "*");
    }
    assert.ok(WORK_STEP_SELECT.includes("stage:work_stages!order_work_steps_stage_fk("));
  });
});
