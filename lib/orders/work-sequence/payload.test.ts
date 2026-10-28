import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { workSequenceErrorResponse } from "./errors";
import {
  normalizeStageName,
  parseCreateStageBody,
  parseExpectedRowVersion,
  parseReplaceStepsBody,
  parseStepDoneBody,
  parseUpdateStageBody,
} from "./payload";

const STAGE = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const STEP = "33333333-3333-4333-8333-333333333333";

describe("parseReplaceStepsBody", () => {
  it("accepts the version as digits or a safe integer", () => {
    assert.equal(parseExpectedRowVersion("12"), "12");
    assert.equal(parseExpectedRowVersion(12), "12");
    for (const bad of [undefined, null, "", "1.5", "-1", -1, 1.5, "12a", {}]) {
      assert.equal(parseExpectedRowVersion(bad), null, String(bad));
    }
  });

  it("normalises steps and drops unknown keys", () => {
    const parsed = parseReplaceStepsBody({
      expected_version: "4",
      tenant_id: "other",
      steps: [
        { id: STEP, stage_id: STAGE, team_member_id: MEMBER, done: true, position: 9 },
        { id: null, stage_id: STAGE },
        { stage_id: STAGE, team_member_id: null },
      ],
    });
    assert.deepEqual(parsed, {
      ok: true,
      expectedVersion: "4",
      steps: [
        { id: STEP, stage_id: STAGE, team_member_id: MEMBER },
        { stage_id: STAGE, team_member_id: null },
        { stage_id: STAGE, team_member_id: null },
      ],
    });
  });

  it("accepts an empty sequence (removing every pending step)", () => {
    assert.deepEqual(parseReplaceStepsBody({ expected_version: "1", steps: [] }), {
      ok: true,
      expectedVersion: "1",
      steps: [],
    });
  });

  it("reports the first bad step with its index and field", () => {
    const cases: Array<[unknown, Record<string, unknown>]> = [
      [null, { code: "invalid_body" }],
      [[], { code: "invalid_body" }],
      [{ steps: [] }, { code: "invalid_version", field: "expected_version" }],
      [{ expected_version: "1", steps: {} }, { code: "invalid_steps", field: "steps" }],
      [{ expected_version: "1", steps: [STAGE] }, { code: "invalid_steps", index: 0, field: "step" }],
      [{ expected_version: "1", steps: [{ stage_id: STAGE }, { stage_id: null }] }, { code: "invalid_steps", index: 1, field: "stage_id" }],
      [{ expected_version: "1", steps: [{ stage_id: STAGE, team_member_id: "x" }] }, { code: "invalid_steps", index: 0, field: "team_member_id" }],
      [{ expected_version: "1", steps: [{ id: 3, stage_id: STAGE }] }, { code: "invalid_steps", index: 0, field: "id" }],
      [
        { expected_version: "1", steps: [{ id: STEP, stage_id: STAGE }, { id: STEP.toUpperCase(), stage_id: STAGE }] },
        { code: "invalid_steps", index: 1, field: "id" },
      ],
      [{ expected_version: "1", steps: Array.from({ length: 11 }, () => ({ stage_id: STAGE })) }, { code: "too_many_steps" }],
    ];
    for (const [body, expected] of cases) {
      assert.deepEqual(parseReplaceStepsBody(body), { ok: false, ...expected }, JSON.stringify(body));
    }
  });

  it("allows exactly ten steps", () => {
    const parsed = parseReplaceStepsBody({ expected_version: "1", steps: Array.from({ length: 10 }, () => ({ stage_id: STAGE })) });
    assert.equal(parsed.ok, true);
  });
});

describe("parseStepDoneBody", () => {
  it("accepts mark, mark with executor and undo", () => {
    assert.deepEqual(parseStepDoneBody({ done: true }), { ok: true, done: true, executedBy: null });
    assert.deepEqual(parseStepDoneBody({ done: true, executed_by: MEMBER }), { ok: true, done: true, executedBy: MEMBER });
    assert.deepEqual(parseStepDoneBody({ done: false, executed_by: null }), { ok: true, done: false, executedBy: null });
  });

  it("rejects a missing action, a bad executor and an executor on undo", () => {
    assert.deepEqual(parseStepDoneBody({}), { ok: false, code: "invalid_action", field: "done" });
    assert.deepEqual(parseStepDoneBody({ done: 1 }), { ok: false, code: "invalid_action", field: "done" });
    assert.deepEqual(parseStepDoneBody({ done: true, executed_by: "me" }), { ok: false, code: "invalid_executor", field: "executed_by" });
    assert.deepEqual(parseStepDoneBody({ done: false, executed_by: MEMBER }), { ok: false, code: "invalid_executor", field: "executed_by" });
    assert.deepEqual(parseStepDoneBody("x"), { ok: false, code: "invalid_body" });
  });
});

describe("stage payloads", () => {
  it("normalises names like upsert_work_stage_v1", () => {
    assert.equal(normalizeStageName("  Corte \t  y   plegado "), "Corte y plegado");
  });

  it("parses create and suggested bodies", () => {
    assert.deepEqual(parseCreateStageBody({ suggested: true, name: "" }), { ok: true, kind: "suggested" });
    assert.deepEqual(parseCreateStageBody({ name: " Corte ", icon: "cut", sort_order: 3, active: false }), {
      ok: true, kind: "create", name: "Corte", icon: "cut", active: false, sortOrder: 3,
    });
    assert.deepEqual(parseCreateStageBody({ name: "Corte", icon: "cut" }), {
      ok: true, kind: "create", name: "Corte", icon: "cut", active: null, sortOrder: null,
    });
  });

  it("rejects bad create bodies with the RPC's codes", () => {
    assert.equal((parseCreateStageBody({ name: "   ", icon: "cut" }) as { code: string }).code, "invalid_name");
    assert.equal((parseCreateStageBody({ name: "x".repeat(41), icon: "cut" }) as { code: string }).code, "invalid_name");
    assert.equal((parseCreateStageBody({ name: "x".repeat(40), icon: "cut" }) as { ok: boolean }).ok, true);
    assert.equal((parseCreateStageBody({ name: "Corte", icon: "Cut" }) as { code: string }).code, "invalid_icon");
    assert.equal((parseCreateStageBody({ name: "Corte", icon: "cut", sort_order: -1 }) as { code: string }).code, "invalid_sort_order");
    assert.equal((parseCreateStageBody({ name: "Corte", icon: "cut", sort_order: 2.5 }) as { code: string }).code, "invalid_sort_order");
    assert.equal((parseCreateStageBody({ name: "Corte", icon: "cut", active: "no" }) as { code: string }).code, "invalid_active");
  });

  it("parses partial updates and refuses empty ones", () => {
    assert.deepEqual(parseUpdateStageBody({ id: STAGE, active: false }), { ok: true, id: STAGE, active: false });
    assert.deepEqual(parseUpdateStageBody({ id: STAGE, sort_order: 0, name: " A " }), { ok: true, id: STAGE, name: "A", sortOrder: 0 });
    assert.deepEqual(parseUpdateStageBody({ id: STAGE }), { ok: false, code: "invalid_body" });
    assert.deepEqual(parseUpdateStageBody({ id: "x", active: true }), { ok: false, code: "not_found", field: "id" });
    assert.deepEqual(parseUpdateStageBody({ id: STAGE, icon: null }), { ok: false, code: "invalid_icon", field: "icon" });
  });
});

describe("workSequenceErrorResponse", () => {
  it("follows contract §9", () => {
    const status = (error: string, scope: "order" | "step" | "stage" = "order") =>
      workSequenceErrorResponse({ error }, scope).status;
    assert.equal(status("not_found"), 404);
    assert.equal(status("forbidden"), 403);
    for (const code of ["conflict", "order_archived", "step_done"]) assert.equal(status(code), 409);
    for (const code of [
      "invalid_steps", "too_many_steps", "stage_inactive", "member_unassignable", "step_unassigned",
      "invalid_action", "invalid_name", "invalid_icon", "invalid_sort_order", "duplicate_name", "too_many_stages",
    ]) {
      assert.equal(status(code), 422, code);
    }
    assert.equal(status("brand_new"), 500);
  });

  it("keeps row_version, index, field and step_id", () => {
    assert.deepEqual(workSequenceErrorResponse({ error: "conflict", row_version: 12 }, "order").body, {
      error: "El pedido ha cambiado. Recarga e inténtalo de nuevo",
      code: "conflict",
      row_version: "12",
    });
    assert.deepEqual(workSequenceErrorResponse({ error: "invalid_steps", index: 2, field: "stage_id" }, "order").body, {
      error: "Elige una fase válida",
      code: "invalid_steps",
      index: 2,
      field: "stage_id",
    });
    assert.equal(workSequenceErrorResponse({ error: "step_done", step_id: STEP }, "order").body.step_id, STEP);
    assert.equal(workSequenceErrorResponse({ code: "invalid_name" }, "stage").status, 422);
    assert.equal(workSequenceErrorResponse({ error: "not_found" }, "stage").body.error, "No se encontró la fase");
  });
});
