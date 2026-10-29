import type {
  AssignableMember,
  WorkSequenceDto,
  WorkStageListDto,
  WorkStepInput,
} from "@/lib/orders/work-sequence/types";

// SUR4 E8: browser calls of the work-sequence API. Every write answers with
// the order's new row_version, which the page must adopt.

export type WorkSequenceApiError = {
  status: number;
  code: string | null;
  message: string;
  index: number | null;
  field: string | null;
  stepId: string | null;
  rowVersion: string | null;
};

const NETWORK_ERROR = "No se pudo conectar. Revisa la conexión e inténtalo de nuevo.";

export async function readWorkSequenceError(response: Response, fallback: string): Promise<WorkSequenceApiError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  return {
    status: response.status,
    code: typeof body.code === "string" ? body.code : null,
    message: typeof body.error === "string" && body.error ? body.error : fallback,
    index: typeof body.index === "number" ? body.index : null,
    field: typeof body.field === "string" ? body.field : null,
    stepId: typeof body.step_id === "string" ? body.step_id : null,
    rowVersion: typeof body.row_version === "string" ? body.row_version : null,
  };
}

function networkError(): WorkSequenceApiError {
  return { status: 0, code: "network", message: NETWORK_ERROR, index: null, field: null, stepId: null, rowVersion: null };
}

export function isWorkSequenceDto(value: unknown): value is WorkSequenceDto {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.row_version === "string" &&
    Array.isArray(record.steps) &&
    Array.isArray(record.stages) &&
    typeof record.can_edit === "boolean"
  );
}

export type WorkSequenceLoad =
  | { kind: "ok"; data: WorkSequenceDto }
  /** 404: no feature, or no such order for this tenant. Nothing is shown. */
  | { kind: "hidden" }
  | { kind: "error"; message: string };

export async function fetchWorkSequence(orderId: string, signal?: AbortSignal): Promise<WorkSequenceLoad> {
  let response: Response;
  try {
    response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/work-steps`, {
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "error", message: NETWORK_ERROR };
  }
  if (response.status === 404) return { kind: "hidden" };
  if (!response.ok) {
    const error = await readWorkSequenceError(response, "No se pudo cargar la secuencia de trabajo.");
    return { kind: "error", message: error.message };
  }
  const body = await response.json().catch(() => null);
  return isWorkSequenceDto(body)
    ? { kind: "ok", data: body }
    : { kind: "error", message: "No se pudo cargar la secuencia de trabajo." };
}

export type WorkSequenceWrite =
  | { ok: true; rowVersion: string; changed: boolean; data: WorkSequenceDto | null }
  | { ok: false; error: WorkSequenceApiError };

async function writeSequence(url: string, method: string, payload: unknown, fallback: string): Promise<WorkSequenceWrite> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: networkError() };
  }
  if (!response.ok) {
    return { ok: false, error: await readWorkSequenceError(response, fallback) };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const rowVersion = typeof body?.row_version === "string" ? body.row_version : null;
  if (!rowVersion) {
    return { ok: false, error: { ...networkError(), status: response.status, code: "invalid_response", message: fallback } };
  }
  return {
    ok: true,
    rowVersion,
    changed: body?.changed === true,
    data: isWorkSequenceDto(body) ? body : null,
  };
}

export function saveWorkSequence(orderId: string, expectedVersion: string, steps: WorkStepInput[]) {
  return writeSequence(
    `/api/orders/${encodeURIComponent(orderId)}/work-steps`,
    "PUT",
    { expected_version: expectedVersion, steps },
    "No se pudo guardar la secuencia."
  );
}

export function setWorkStepDone(orderId: string, stepId: string, done: boolean, executedBy?: string | null) {
  return writeSequence(
    `/api/orders/${encodeURIComponent(orderId)}/work-steps/${encodeURIComponent(stepId)}/done`,
    "POST",
    done && executedBy ? { done, executed_by: executedBy } : { done },
    done ? "No se pudo marcar el paso." : "No se pudo deshacer el paso."
  );
}

/**
 * Assignable people (R6: active and able to receive orders), from the same
 * endpoint the responsible-person picker uses.
 */
export async function fetchAssignableMembers(): Promise<AssignableMember[]> {
  const response = await fetch("/api/orders/options", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar el personal.");
  }
  const body = (await response.json()) as { team_members?: unknown };
  return Array.isArray(body.team_members)
    ? body.team_members.flatMap((member) =>
        member && typeof member === "object" && typeof (member as AssignableMember).id === "string"
          ? [{ id: (member as AssignableMember).id, name: String((member as AssignableMember).name ?? "") }]
          : []
      )
    : [];
}

// --- Settings: /api/work-stages ------------------------------------------

export type WorkStageWrite =
  | { ok: true; list: WorkStageListDto | null; created: number }
  | { ok: false; error: WorkSequenceApiError };

function isStageList(value: unknown): value is WorkStageListDto {
  return Boolean(value && typeof value === "object" && Array.isArray((value as WorkStageListDto).stages));
}

export async function fetchWorkStages(): Promise<WorkStageListDto> {
  const response = await fetch("/api/work-stages", { cache: "no-store" });
  if (!response.ok) {
    const error = await readWorkSequenceError(response, "No se pudieron cargar las fases de trabajo.");
    throw new Error(error.message);
  }
  const body = await response.json();
  if (!isStageList(body)) throw new Error("No se pudieron cargar las fases de trabajo.");
  return { stages: body.stages, can_manage: body.can_manage === true };
}

export async function writeWorkStage(method: "POST" | "PATCH", payload: Record<string, unknown>): Promise<WorkStageWrite> {
  let response: Response;
  try {
    response = await fetch("/api/work-stages", {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: networkError() };
  }
  if (!response.ok) {
    return { ok: false, error: await readWorkSequenceError(response, "No se pudo guardar la fase.") };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return {
    ok: true,
    list: isStageList(body) ? { stages: body.stages, can_manage: body.can_manage === true } : null,
    created: typeof body?.created === "number" ? body.created : 0,
  };
}
