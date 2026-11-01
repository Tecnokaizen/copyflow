import { isWorkStageIcon, type WorkStageIcon } from "@/lib/orders/work-stage-icons";
import {
  MAX_WORK_STEPS,
  WORK_STAGE_NAME_MAX,
  WORK_STAGE_SORT_MAX,
  type WorkStepInput,
} from "@/lib/orders/work-sequence/types";

// SUR4 E8: request validation for the work-sequence routes. Mirrors the checks
// of the RPCs so a malformed body is a 422 with the step index and field, never
// a 500. Unknown keys are dropped (allowlist); the tenant never comes from the
// body.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidValue(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export type PayloadError = {
  ok: false;
  code: string;
  index?: number;
  field?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** orders.row_version as the decimal text the RPCs expect. */
export function parseExpectedRowVersion(value: unknown): string | null {
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

export function parseReplaceStepsBody(
  body: unknown
):
  | { ok: true; expectedVersion: string; steps: WorkStepInput[] }
  | PayloadError {
  const record = asRecord(body);
  if (!record) {
    return { ok: false, code: "invalid_body" };
  }

  const expectedVersion = parseExpectedRowVersion(record.expected_version);
  if (!expectedVersion) {
    return { ok: false, code: "invalid_version", field: "expected_version" };
  }

  if (!Array.isArray(record.steps)) {
    return { ok: false, code: "invalid_steps", field: "steps" };
  }
  if (record.steps.length > MAX_WORK_STEPS) {
    return { ok: false, code: "too_many_steps" };
  }

  const steps: WorkStepInput[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < record.steps.length; index += 1) {
    const step = asRecord(record.steps[index]);
    if (!step) {
      return { ok: false, code: "invalid_steps", index, field: "step" };
    }

    const id = step.id;
    if (id != null && !isUuidValue(id)) {
      return { ok: false, code: "invalid_steps", index, field: "id" };
    }
    if (isUuidValue(id)) {
      const key = id.toLowerCase();
      if (seen.has(key)) {
        return { ok: false, code: "invalid_steps", index, field: "id" };
      }
      seen.add(key);
    }

    if (!isUuidValue(step.stage_id)) {
      return { ok: false, code: "invalid_steps", index, field: "stage_id" };
    }

    const member = step.team_member_id;
    if (member != null && !isUuidValue(member)) {
      return { ok: false, code: "invalid_steps", index, field: "team_member_id" };
    }

    steps.push({
      ...(isUuidValue(id) ? { id } : {}),
      stage_id: step.stage_id,
      team_member_id: isUuidValue(member) ? member : null,
    });
  }

  return { ok: true, expectedVersion, steps };
}

export function parseStepDoneBody(
  body: unknown
): { ok: true; done: boolean; executedBy: string | null } | PayloadError {
  const record = asRecord(body);
  if (!record) {
    return { ok: false, code: "invalid_body" };
  }
  if (typeof record.done !== "boolean") {
    return { ok: false, code: "invalid_action", field: "done" };
  }
  const executedBy = record.executed_by;
  if (executedBy != null && !isUuidValue(executedBy)) {
    return { ok: false, code: "invalid_executor", field: "executed_by" };
  }
  if (!record.done && executedBy != null) {
    // Undoing clears the executor; naming one is a contradiction.
    return { ok: false, code: "invalid_executor", field: "executed_by" };
  }
  return {
    ok: true,
    done: record.done,
    executedBy: isUuidValue(executedBy) ? executedBy : null,
  };
}

/** Same normalisation as upsert_work_stage_v1: collapse spaces and trim. */
export function normalizeStageName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseStageName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = normalizeStageName(value);
  return name.length >= 1 && name.length <= WORK_STAGE_NAME_MAX ? name : null;
}

function parseSortOrder(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= WORK_STAGE_SORT_MAX
    ? value
    : null;
}

export type CreateStageInput =
  | { ok: true; kind: "suggested" }
  | {
      ok: true;
      kind: "create";
      name: string;
      icon: WorkStageIcon;
      active: boolean | null;
      sortOrder: number | null;
    };

export function parseCreateStageBody(body: unknown): CreateStageInput | PayloadError {
  const record = asRecord(body);
  if (!record) {
    return { ok: false, code: "invalid_body" };
  }
  if (record.suggested === true) {
    return { ok: true, kind: "suggested" };
  }

  const name = parseStageName(record.name);
  if (!name) {
    return { ok: false, code: "invalid_name", field: "name" };
  }
  if (!isWorkStageIcon(record.icon)) {
    return { ok: false, code: "invalid_icon", field: "icon" };
  }
  let sortOrder: number | null = null;
  if (record.sort_order != null) {
    sortOrder = parseSortOrder(record.sort_order);
    if (sortOrder === null) {
      return { ok: false, code: "invalid_sort_order", field: "sort_order" };
    }
  }
  if (record.active != null && typeof record.active !== "boolean") {
    return { ok: false, code: "invalid_active", field: "active" };
  }

  return {
    ok: true,
    kind: "create",
    name,
    icon: record.icon,
    active: typeof record.active === "boolean" ? record.active : null,
    sortOrder,
  };
}

export type UpdateStageInput = {
  ok: true;
  id: string;
  name?: string;
  icon?: WorkStageIcon;
  active?: boolean;
  sortOrder?: number;
};

export function parseUpdateStageBody(body: unknown): UpdateStageInput | PayloadError {
  const record = asRecord(body);
  if (!record) {
    return { ok: false, code: "invalid_body" };
  }
  if (!isUuidValue(record.id)) {
    return { ok: false, code: "not_found", field: "id" };
  }

  const out: UpdateStageInput = { ok: true, id: record.id };

  if (record.name !== undefined) {
    const name = parseStageName(record.name);
    if (!name) return { ok: false, code: "invalid_name", field: "name" };
    out.name = name;
  }
  if (record.icon !== undefined) {
    if (!isWorkStageIcon(record.icon)) return { ok: false, code: "invalid_icon", field: "icon" };
    out.icon = record.icon;
  }
  if (record.active !== undefined) {
    if (typeof record.active !== "boolean") return { ok: false, code: "invalid_active", field: "active" };
    out.active = record.active;
  }
  if (record.sort_order !== undefined) {
    const sortOrder = parseSortOrder(record.sort_order);
    if (sortOrder === null) return { ok: false, code: "invalid_sort_order", field: "sort_order" };
    out.sortOrder = sortOrder;
  }

  if (
    out.name === undefined &&
    out.icon === undefined &&
    out.active === undefined &&
    out.sortOrder === undefined
  ) {
    return { ok: false, code: "invalid_body" };
  }

  return out;
}
