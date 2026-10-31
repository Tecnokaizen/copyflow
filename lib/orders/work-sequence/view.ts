import {
  MAX_WORK_STEPS,
  type AssignableMember,
  type WorkStageDto,
  type WorkStepDto,
  type WorkStepInput,
  type WorkStepPersonDto,
  type WorkStepStageDto,
} from "@/lib/orders/work-sequence/types";

// SUR4 E8: pure view rules of the sequence strip and its editor. The state is
// never shown by colour alone: every state has its text (D12 terms).

export type StepState = "done" | "current" | "pending";

export const STEP_STATE_LABELS: Record<StepState, string> = {
  done: "Hecho",
  current: "Le toca ahora",
  pending: "Pendiente",
};

export const UNASSIGNED_LABEL = "Sin asignar";

export function stepState(step: Pick<WorkStepDto, "done" | "is_current">): StepState {
  if (step.done) return "done";
  return step.is_current ? "current" : "pending";
}

/** Not eligible any more (R6): inactive or unable to receive orders. */
export function personUnavailable(person: WorkStepPersonDto | null | undefined) {
  return Boolean(person && (!person.active || !person.can_receive_orders));
}

export function personLabel(person: WorkStepPersonDto | null | undefined) {
  if (!person) return UNASSIGNED_LABEL;
  const name = person.name.trim() || "Persona";
  if (!person.active) return `${name} (inactiva)`;
  if (!person.can_receive_orders) return `${name} (no recibe pedidos)`;
  return name;
}

export function stageLabel(stage: WorkStepStageDto | null | undefined) {
  return stage?.name.trim() || "Fase";
}

export function currentStep(steps: readonly WorkStepDto[]) {
  return steps.find((step) => step.is_current) ?? null;
}

export function sequenceProgress(steps: readonly WorkStepDto[]) {
  return { done: steps.filter((step) => step.done).length, total: steps.length };
}

const DONE_AT = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDoneAt(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DONE_AT.format(date);
}

/** «Jesús · 28/10, 09:15» plus who marked it when it was someone else. */
export function doneSummary(step: WorkStepDto) {
  const parts = [step.executed_by?.name, formatDoneAt(step.completed_at)].filter(Boolean);
  const marker =
    step.completed_by_name && step.completed_by_name !== step.executed_by?.name
      ? `marcado por ${step.completed_by_name}`
      : null;
  return { line: parts.join(" · "), marker };
}

export type SequenceWarning = {
  kind: "current_person_unavailable" | "current_unassigned" | "stage_inactive";
  stepId: string;
  message: string;
};

export function sequenceWarnings(steps: readonly WorkStepDto[]): SequenceWarning[] {
  const warnings: SequenceWarning[] = [];
  const current = currentStep(steps);
  if (current?.team_member && personUnavailable(current.team_member)) {
    const why = current.team_member.active ? "no puede recibir pedidos" : "está inactiva";
    warnings.push({
      kind: "current_person_unavailable",
      stepId: current.id,
      message: `Le toca a ${current.team_member.name}, que ${why}. Cambia la persona del paso «${stageLabel(current.stage)}».`,
    });
  } else if (current && !current.team_member) {
    warnings.push({
      kind: "current_unassigned",
      stepId: current.id,
      message: `El paso «${stageLabel(current.stage)}» no tiene persona. Asígnala para poder marcarlo como hecho.`,
    });
  }
  for (const step of steps) {
    if (!step.done && step.stage && !step.stage.active) {
      warnings.push({
        kind: "stage_inactive",
        stepId: step.id,
        message: `La fase «${step.stage.name}» está desactivada. El paso se conserva, pero ya no se puede elegir en pasos nuevos.`,
      });
    }
  }
  return warnings;
}

/** Why «Marcar hecho» cannot be used on a pending step, or null. */
export function markBlockedReason(step: WorkStepDto) {
  if (step.done) return null;
  if (!step.team_member) return "Asigna una persona al paso para poder marcarlo.";
  if (personUnavailable(step.team_member)) {
    return "La persona del paso ya no puede recibir pedidos: cámbiala en «Editar secuencia».";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export type EditorRow = {
  key: string;
  id: string | null;
  stage_id: string;
  team_member_id: string | null;
  done: boolean;
  /** As stored: lets the selects show an inactive stage or person they do not list. */
  savedStage: WorkStepStageDto | null;
  savedPerson: WorkStepPersonDto | null;
};

export const DONE_ROW_LOCKED_HINT = "Paso hecho: deshazlo para cambiar su fase o su persona, o para quitarlo.";

export function editorRowsFromSteps(steps: readonly WorkStepDto[]): EditorRow[] {
  return [...steps]
    .sort((a, b) => a.position - b.position)
    .map((step) => ({
      key: step.id,
      id: step.id,
      stage_id: step.stage?.id ?? "",
      team_member_id: step.team_member?.id ?? null,
      done: step.done,
      savedStage: step.stage,
      savedPerson: step.team_member,
    }));
}

export function newEditorRow(key: string, stageId = ""): EditorRow {
  return {
    key,
    id: null,
    stage_id: stageId,
    team_member_id: null,
    done: false,
    savedStage: null,
    savedPerson: null,
  };
}

export function canAddEditorRow(rows: readonly EditorRow[]) {
  return rows.length < MAX_WORK_STEPS;
}

export function moveEditorRow(rows: readonly EditorRow[], index: number, delta: -1 | 1): EditorRow[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) {
    return [...rows];
  }
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeEditorRow(rows: readonly EditorRow[], index: number): EditorRow[] {
  if (rows[index]?.done) return [...rows];
  return rows.filter((_, position) => position !== index);
}

export function updateEditorRow(
  rows: readonly EditorRow[],
  index: number,
  patch: Partial<Pick<EditorRow, "stage_id" | "team_member_id">>
): EditorRow[] {
  return rows.map((row, position) => (position === index && !row.done ? { ...row, ...patch } : row));
}

export function editorRowsToPayload(rows: readonly EditorRow[]): WorkStepInput[] {
  return rows.map((row) => ({
    ...(row.id ? { id: row.id } : {}),
    stage_id: row.stage_id,
    team_member_id: row.team_member_id,
  }));
}

export function validateEditorRows(rows: readonly EditorRow[]): { index: number | null; message: string } | null {
  if (rows.length > MAX_WORK_STEPS) {
    return { index: null, message: `La secuencia admite como máximo ${MAX_WORK_STEPS} pasos.` };
  }
  const missing = rows.findIndex((row) => !row.stage_id);
  if (missing >= 0) {
    return { index: missing, message: "Elige una fase." };
  }
  return null;
}

/** The row an API error points at: by index (same order as the payload) or by step id. */
export function editorErrorRow(
  error: { index?: number | null; stepId?: string | null },
  rows: readonly EditorRow[]
): number | null {
  if (typeof error.index === "number" && error.index >= 0 && error.index < rows.length) {
    return error.index;
  }
  if (error.stepId) {
    const found = rows.findIndex((row) => row.id === error.stepId);
    return found >= 0 ? found : null;
  }
  return null;
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export function stageOptionsForRow(row: EditorRow, stages: readonly WorkStageDto[]): SelectOption[] {
  const options: SelectOption[] = stages
    .filter((stage) => stage.active)
    .map((stage) => ({ value: stage.id, label: stage.name }));
  if (row.stage_id && !options.some((option) => option.value === row.stage_id)) {
    const saved = row.savedStage?.id === row.stage_id ? row.savedStage : null;
    options.push({ value: row.stage_id, label: `${saved?.name ?? "Fase"} (desactivada)`, disabled: true });
  }
  return options;
}

export function rowStageInactive(row: EditorRow, stages: readonly WorkStageDto[]) {
  return Boolean(row.stage_id) && !stages.some((stage) => stage.active && stage.id === row.stage_id);
}

export function memberOptionsForRow(row: EditorRow, members: readonly AssignableMember[]): SelectOption[] {
  const options: SelectOption[] = members.map((member) => ({ value: member.id, label: member.name }));
  if (row.team_member_id && !options.some((option) => option.value === row.team_member_id)) {
    const saved = row.savedPerson?.id === row.team_member_id ? row.savedPerson : null;
    options.push({
      value: row.team_member_id,
      label: saved && personUnavailable(saved) ? personLabel(saved) : `${saved?.name ?? "Persona"} (no disponible)`,
      disabled: true,
    });
  }
  return options;
}

/** Only meaningful once the assignable list is loaded. */
export function rowPersonUnavailable(row: EditorRow, members: readonly AssignableMember[] | null) {
  if (!row.team_member_id) return false;
  if (members) return !members.some((member) => member.id === row.team_member_id);
  return row.savedPerson?.id === row.team_member_id && personUnavailable(row.savedPerson);
}
