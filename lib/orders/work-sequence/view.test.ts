import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reorderWorkStages } from "./stage-order";
import type { WorkStageDto, WorkStepDto } from "./types";
import {
  editorErrorRow,
  editorRowsFromSteps,
  editorRowsToPayload,
  markBlockedReason,
  memberOptionsForRow,
  moveEditorRow,
  newEditorRow,
  personLabel,
  removeEditorRow,
  rowPersonUnavailable,
  rowStageInactive,
  sequenceProgress,
  sequenceWarnings,
  stageOptionsForRow,
  STEP_STATE_LABELS,
  stepState,
  updateEditorRow,
  validateEditorRows,
} from "./view";

const jesus = { id: "m-jesus", name: "Jesús", active: true, can_receive_orders: true };
const raquel = { id: "m-raquel", name: "Raquel", active: false, can_receive_orders: true };
const davinia = { id: "m-davinia", name: "Davinia", active: true, can_receive_orders: true };
const design = { id: "s-design", name: "Diseño", icon: "design", active: true };
const prepare = { id: "s-prepare", name: "Preparación", icon: "prepare", active: true };
const cut = { id: "s-cut", name: "Corte", icon: "cut", active: false };

function step(overrides: Partial<WorkStepDto>): WorkStepDto {
  return {
    id: "step",
    position: 1,
    stage: design,
    team_member: jesus,
    executed_by: null,
    done: false,
    completed_at: null,
    completed_by_name: null,
    is_current: false,
    ...overrides,
  };
}

// SUR4-0106: Diseño (Jesús, hecho) → Preparación (Raquel, le toca) → Corte (Davinia).
const sur4 = [
  step({ id: "a", position: 1, done: true, completed_at: "2026-10-28T09:15:00Z", executed_by: { id: jesus.id, name: "Jesús" }, completed_by_name: "Tamara" }),
  step({ id: "b", position: 2, stage: prepare, team_member: raquel, is_current: true }),
  step({ id: "c", position: 3, stage: cut, team_member: davinia }),
];

const stages: WorkStageDto[] = [
  { ...design, sort_order: 0 },
  { ...prepare, sort_order: 1 },
];

describe("sequence strip rules", () => {
  it("names every state in text (never colour alone)", () => {
    assert.deepEqual(sur4.map((s) => STEP_STATE_LABELS[stepState(s)]), ["Hecho", "Le toca ahora", "Pendiente"]);
  });

  it("labels inactive and unassigned people", () => {
    assert.equal(personLabel(jesus), "Jesús");
    assert.equal(personLabel(raquel), "Raquel (inactiva)");
    assert.equal(personLabel({ ...davinia, can_receive_orders: false }), "Davinia (no recibe pedidos)");
    assert.equal(personLabel(null), "Sin asignar");
  });

  it("warns when the turn belongs to an inactive person and about inactive stages", () => {
    const warnings = sequenceWarnings(sur4);
    assert.deepEqual(warnings.map((w) => [w.kind, w.stepId]), [
      ["current_person_unavailable", "b"],
      ["stage_inactive", "c"],
    ]);
    assert.match(warnings[0].message, /Raquel, que está inactiva/);
    assert.deepEqual(sequenceProgress(sur4), { done: 1, total: 3 });
  });

  it("warns when the current step has nobody and blocks its mark", () => {
    const steps = [step({ id: "x", team_member: null, is_current: true })];
    assert.equal(sequenceWarnings(steps)[0].kind, "current_unassigned");
    assert.ok(markBlockedReason(steps[0]));
    assert.ok(markBlockedReason(sur4[1]));
    assert.equal(markBlockedReason(sur4[2]), null);
    assert.equal(markBlockedReason(sur4[0]), null);
  });

  it("does not warn about an inactive stage of a done step", () => {
    assert.deepEqual(sequenceWarnings([step({ stage: cut, done: true, completed_at: "2026-10-28T09:15:00Z" })]), []);
  });
});

describe("sequence editor rules", () => {
  it("builds rows in position order and the payload with ids only for existing steps", () => {
    const rows = editorRowsFromSteps([sur4[2], sur4[0], sur4[1]]);
    assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"]);
    const withNew = [...rows, newEditorRow("n1", design.id)];
    assert.deepEqual(editorRowsToPayload(withNew), [
      { id: "a", stage_id: design.id, team_member_id: jesus.id },
      { id: "b", stage_id: prepare.id, team_member_id: raquel.id },
      { id: "c", stage_id: cut.id, team_member_id: davinia.id },
      { stage_id: design.id, team_member_id: null },
    ]);
  });

  it("locks done rows: no change, no removal, but they can move", () => {
    const rows = editorRowsFromSteps(sur4);
    assert.equal(removeEditorRow(rows, 0).length, 3);
    assert.equal(removeEditorRow(rows, 1).length, 2);
    assert.equal(updateEditorRow(rows, 0, { team_member_id: null })[0].team_member_id, jesus.id);
    assert.equal(updateEditorRow(rows, 2, { team_member_id: null })[2].team_member_id, null);
    assert.deepEqual(moveEditorRow(rows, 0, 1).map((r) => r.id), ["b", "a", "c"]);
    assert.deepEqual(moveEditorRow(rows, 0, -1).map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual(moveEditorRow(rows, 2, 1).map((r) => r.id), ["a", "b", "c"]);
  });

  it("requires a stage on every row and at most ten rows", () => {
    assert.deepEqual(validateEditorRows([newEditorRow("n", design.id), newEditorRow("m")]), { index: 1, message: "Elige una fase." });
    assert.equal(validateEditorRows([]), null);
    const eleven = Array.from({ length: 11 }, (_, i) => newEditorRow(`n${i}`, design.id));
    assert.equal(validateEditorRows(eleven)?.index, null);
  });

  it("keeps an inactive stage or person visible but not selectable", () => {
    const [, rowB, rowC] = editorRowsFromSteps(sur4);
    assert.equal(rowStageInactive(rowC, stages), true);
    assert.equal(rowStageInactive(rowB, stages), false);
    assert.deepEqual(stageOptionsForRow(rowC, stages).at(-1), { value: cut.id, label: "Corte (desactivada)", disabled: true });
    assert.equal(stageOptionsForRow(rowB, stages).length, 2);
    const members = [{ id: jesus.id, name: "Jesús" }, { id: davinia.id, name: "Davinia" }];
    assert.deepEqual(memberOptionsForRow(rowB, members).at(-1), { value: raquel.id, label: "Raquel (inactiva)", disabled: true });
    assert.equal(rowPersonUnavailable(rowB, members), true);
    assert.equal(rowPersonUnavailable(rowC, members), false);
    assert.equal(rowPersonUnavailable(rowB, null), true);
  });

  it("points API errors at their row by index or step id", () => {
    const rows = editorRowsFromSteps(sur4);
    assert.equal(editorErrorRow({ index: 2 }, rows), 2);
    assert.equal(editorErrorRow({ index: 9 }, rows), null);
    assert.equal(editorErrorRow({ stepId: "b" }, rows), 1);
    assert.equal(editorErrorRow({ stepId: "gone" }, rows), null);
  });
});

describe("reorderWorkStages", () => {
  const list: WorkStageDto[] = [
    { ...design, sort_order: 0 },
    { ...prepare, sort_order: 1 },
    { ...cut, sort_order: 2 },
  ];

  it("swaps two numbered stages with two patches", () => {
    const { next, updates } = reorderWorkStages(list, 2, -1);
    assert.deepEqual(next.map((s) => s.name), ["Diseño", "Corte", "Preparación"]);
    assert.deepEqual(updates, [
      { id: cut.id, sort_order: 1 },
      { id: prepare.id, sort_order: 2 },
    ]);
  });

  it("numbers a list with repeated values and ignores moves past the ends", () => {
    const repeated = list.map((s) => ({ ...s, sort_order: 5 }));
    assert.equal(reorderWorkStages(repeated, 0, 1).updates.length, 3);
    assert.deepEqual(reorderWorkStages(list, 0, -1).updates, []);
    assert.deepEqual(reorderWorkStages(list, 2, 1).updates, []);
  });
});
