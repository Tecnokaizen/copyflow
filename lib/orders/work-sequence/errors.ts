// SUR4 E8: RPC/payload error codes → HTTP (contract §9).
//   not_found 404 · forbidden 403 · conflict, order_archived, step_done 409
//   (conflict carries row_version) · other validation errors 422 (with index
//   and field when the RPC gives them) · no session 401 (requireCurrentAccess).

export const WORK_SEQUENCE_MESSAGES = {
  orderNotFound: "No se encontró el pedido",
  stepNotFound: "No se encontró el paso",
  stageNotFound: "No se encontró la fase",
  forbiddenSteps: "Tu rol no puede cambiar la secuencia de trabajo",
  forbiddenStages: "Tu rol no puede cambiar las fases de trabajo",
  conflict: "El pedido ha cambiado. Recarga e inténtalo de nuevo",
  orderArchived: "El pedido está archivado y no se puede cambiar",
  stepDone: "Ese paso ya está hecho: deshazlo antes de cambiarlo o quitarlo",
  invalidBody: "La petición no es válida",
  invalidVersion: "Falta la versión del pedido",
  invalidSteps: "Revisa los pasos de la secuencia",
  invalidStepStage: "Elige una fase válida",
  invalidStepMember: "Elige una persona válida",
  invalidStepId: "Ese paso ya no está en el pedido",
  tooManySteps: "La secuencia admite como máximo 10 pasos",
  stageInactive: "Esa fase está desactivada; elige otra",
  memberUnassignable: "La persona elegida no está activa o no puede recibir pedidos",
  stepUnassigned: "Asigna una persona al paso antes de marcarlo como hecho",
  invalidAction: "Acción no válida",
  invalidExecutor: "Elige una persona válida",
  invalidName: "El nombre debe tener entre 1 y 40 caracteres",
  invalidIcon: "Elige un icono de la lista",
  invalidSortOrder: "El orden debe estar entre 0 y 1000",
  invalidActive: "El estado de la fase no es válido",
  duplicateName: "Ya existe una fase con ese nombre",
  tooManyStages: "Se admiten como máximo 30 fases",
  loadSteps: "No se pudo cargar la secuencia de trabajo",
  saveSteps: "No se pudo guardar la secuencia de trabajo",
  loadStages: "No se pudieron cargar las fases de trabajo",
  saveStages: "No se pudo guardar la fase de trabajo",
} as const;

export type WorkSequenceErrorScope = "order" | "step" | "stage";

export type WorkSequenceRpcFailure = {
  ok?: boolean;
  error?: unknown;
  index?: unknown;
  field?: unknown;
  step_id?: unknown;
  row_version?: unknown;
};

export type WorkSequenceErrorBody = {
  error: string;
  code: string;
  index?: number;
  field?: string;
  step_id?: string;
  row_version?: string;
};

const CONFLICT_CODES = new Set(["conflict", "order_archived", "step_done"]);

const VALIDATION_MESSAGES: Record<string, string> = {
  invalid_body: WORK_SEQUENCE_MESSAGES.invalidBody,
  invalid_version: WORK_SEQUENCE_MESSAGES.invalidVersion,
  invalid_steps: WORK_SEQUENCE_MESSAGES.invalidSteps,
  too_many_steps: WORK_SEQUENCE_MESSAGES.tooManySteps,
  stage_inactive: WORK_SEQUENCE_MESSAGES.stageInactive,
  member_unassignable: WORK_SEQUENCE_MESSAGES.memberUnassignable,
  step_unassigned: WORK_SEQUENCE_MESSAGES.stepUnassigned,
  invalid_action: WORK_SEQUENCE_MESSAGES.invalidAction,
  invalid_executor: WORK_SEQUENCE_MESSAGES.invalidExecutor,
  invalid_name: WORK_SEQUENCE_MESSAGES.invalidName,
  invalid_icon: WORK_SEQUENCE_MESSAGES.invalidIcon,
  invalid_sort_order: WORK_SEQUENCE_MESSAGES.invalidSortOrder,
  invalid_active: WORK_SEQUENCE_MESSAGES.invalidActive,
  duplicate_name: WORK_SEQUENCE_MESSAGES.duplicateName,
  too_many_stages: WORK_SEQUENCE_MESSAGES.tooManyStages,
};

const STEP_FIELD_MESSAGES: Record<string, string> = {
  stage_id: WORK_SEQUENCE_MESSAGES.invalidStepStage,
  team_member_id: WORK_SEQUENCE_MESSAGES.invalidStepMember,
  id: WORK_SEQUENCE_MESSAGES.invalidStepId,
};

function notFoundMessage(scope: WorkSequenceErrorScope) {
  if (scope === "step") return WORK_SEQUENCE_MESSAGES.stepNotFound;
  if (scope === "stage") return WORK_SEQUENCE_MESSAGES.stageNotFound;
  return WORK_SEQUENCE_MESSAGES.orderNotFound;
}

function conflictMessage(code: string) {
  if (code === "order_archived") return WORK_SEQUENCE_MESSAGES.orderArchived;
  if (code === "step_done") return WORK_SEQUENCE_MESSAGES.stepDone;
  return WORK_SEQUENCE_MESSAGES.conflict;
}

/**
 * Maps a `{ ok: false, error, ... }` answer (RPC or payload parser) to an HTTP
 * status and a body with a stable `code`. Unknown codes are a 500: the route
 * does not know what happened and must not pretend it was the user's fault.
 */
export function workSequenceErrorResponse(
  failure: WorkSequenceRpcFailure & { code?: unknown },
  scope: WorkSequenceErrorScope
): { status: number; body: WorkSequenceErrorBody } {
  const code =
    typeof failure.error === "string"
      ? failure.error
      : typeof failure.code === "string"
        ? failure.code
        : "unknown";
  const index =
    typeof failure.index === "number" && Number.isInteger(failure.index)
      ? failure.index
      : undefined;
  const field = typeof failure.field === "string" ? failure.field : undefined;
  const extras = {
    ...(index !== undefined ? { index } : {}),
    ...(field !== undefined ? { field } : {}),
  };

  if (code === "not_found") {
    return { status: 404, body: { error: notFoundMessage(scope), code } };
  }

  if (code === "forbidden") {
    return {
      status: 403,
      body: {
        error:
          scope === "stage"
            ? WORK_SEQUENCE_MESSAGES.forbiddenStages
            : WORK_SEQUENCE_MESSAGES.forbiddenSteps,
        code,
      },
    };
  }

  if (CONFLICT_CODES.has(code)) {
    const body: WorkSequenceErrorBody = { error: conflictMessage(code), code, ...extras };
    if (code === "conflict" && (typeof failure.row_version === "string" || typeof failure.row_version === "number")) {
      body.row_version = String(failure.row_version);
    }
    if (code === "step_done" && typeof failure.step_id === "string") {
      body.step_id = failure.step_id;
    }
    return { status: 409, body };
  }

  const message =
    code === "invalid_steps" && field && STEP_FIELD_MESSAGES[field]
      ? STEP_FIELD_MESSAGES[field]
      : VALIDATION_MESSAGES[code];
  if (message) {
    return { status: 422, body: { error: message, code, ...extras } };
  }

  return {
    status: 500,
    body: {
      error:
        scope === "stage" ? WORK_SEQUENCE_MESSAGES.saveStages : WORK_SEQUENCE_MESSAGES.saveSteps,
      code: "unknown",
    },
  };
}
