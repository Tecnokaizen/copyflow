import { isOrderArchived, isOrderTerminal } from "@/lib/orders/operational";

export type LifecycleStatusFlags = {
  is_closed?: boolean | null;
  is_cancelled?: boolean | null;
  is_ready?: boolean | null;
} | null | undefined;

export type TerminalKind = "closed" | "cancelled";

export type ConfirmCopy = {
  title: string;
  description: string;
  confirmLabel: string;
};

export const ARCHIVE_CONFIRM_COPY: ConfirmCopy = {
  title: "Archivar pedido",
  description:
    "El pedido seguirá disponible para consulta, pero quedará fuera de las vistas operativas.",
  confirmLabel: "Archivar",
};

const CLOSED_CONFIRM_COPY: ConfirmCopy = {
  title: "Marcar pedido como entregado",
  description:
    "Este estado cierra el pedido y dejará de aparecer en las colas operativas.",
  confirmLabel: "Confirmar entrega",
};

const CANCELLED_CONFIRM_COPY: ConfirmCopy = {
  title: "Cancelar pedido",
  description:
    "El pedido dejará de aparecer en las colas operativas. Podrás consultarlo y archivarlo después.",
  confirmLabel: "Confirmar cancelación",
};

const GENERIC_TERMINAL_CONFIRM_COPY: ConfirmCopy = {
  title: "Cerrar pedido",
  description:
    "Este estado es terminal. El pedido dejará de aparecer en las colas operativas.",
  confirmLabel: "Confirmar",
};

/**
 * Flag-first terminal kind. Prefer cancelled when both flags are set
 * (safer destructive confirmation path). Never use status names/codes.
 */
export function terminalKindFromStatus(
  status: LifecycleStatusFlags
): TerminalKind | null {
  if (status?.is_cancelled === true) {
    return "cancelled";
  }
  if (status?.is_closed === true) {
    return "closed";
  }
  return null;
}

export function resolveTerminalConfirmCopy(
  status: LifecycleStatusFlags
): ConfirmCopy {
  const kind = terminalKindFromStatus(status);
  if (kind === "cancelled") {
    return CANCELLED_CONFIRM_COPY;
  }
  if (kind === "closed") {
    return CLOSED_CONFIRM_COPY;
  }
  return GENERIC_TERMINAL_CONFIRM_COPY;
}

export type StatusSavePlan =
  | { type: "noop" }
  | { type: "save_direct"; statusId: string }
  | {
      type: "require_terminal_confirm";
      statusId: string;
      copy: ConfirmCopy;
    };

export function planStatusSave(input: {
  currentStatusId: string;
  nextStatusId: string;
  nextStatus: LifecycleStatusFlags;
  terminalConfirmed: boolean;
}): StatusSavePlan {
  if (!input.nextStatusId || input.nextStatusId === input.currentStatusId) {
    return { type: "noop" };
  }

  const kind = terminalKindFromStatus(input.nextStatus);
  if (kind && !input.terminalConfirmed) {
    return {
      type: "require_terminal_confirm",
      statusId: input.nextStatusId,
      copy: resolveTerminalConfirmCopy(input.nextStatus),
    };
  }

  return { type: "save_direct", statusId: input.nextStatusId };
}

export function canShowArchiveAction(order: {
  archived_at?: string | null;
  status?: LifecycleStatusFlags;
}): boolean {
  if (isOrderArchived(order)) {
    return false;
  }
  return isOrderTerminal(order);
}

export function canMutateOrderActions(input: {
  canWrite: boolean;
  archived_at?: string | null;
}): boolean {
  return input.canWrite === true && !isOrderArchived(input);
}

/** Stable API code for "this order is archived" conflicts (HTTP 409). */
export const ORDER_ARCHIVED_CODE = "ORDER_ARCHIVED";

/** Stable API code for optimistic concurrency conflicts (HTTP 409). */
export const ORDER_STALE_CODE = "ORDER_STALE";

/**
 * True when an API error body is the archived-order conflict.
 * Used to stop a multi-step save as soon as the order became archived
 * under us, instead of pushing the remaining steps against the server.
 */
export function isArchivedApiError(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }

  return (body as { code?: unknown }).code === ORDER_ARCHIVED_CODE;
}

/**
 * Thrown when a mutation lost the race against another actor archiving the
 * order. Carries the Lifecycle copy and tells the workspace to stop mutating
 * and resync from the server.
 */
export class OrderArchivedError extends Error {
  readonly code = ORDER_ARCHIVED_CODE;

  constructor(message = lifecycleUxErrorMessage(ORDER_ARCHIVED_CODE)) {
    super(message);
    this.name = "OrderArchivedError";
  }
}

/**
 * True when an API error body is the stale-order conflict.
 */
export function isStaleApiError(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }

  return (body as { code?: unknown }).code === ORDER_STALE_CODE;
}

/**
 * Thrown when a mutation lost the race against another write.
 * The workspace keeps the draft and refreshes the server snapshot.
 */
export class OrderStaleError extends Error {
  readonly code = ORDER_STALE_CODE;

  constructor(message = lifecycleUxErrorMessage(ORDER_STALE_CODE)) {
    super(message);
    this.name = "OrderStaleError";
  }
}

export function archiveOrderPath(orderId: string) {
  return `/api/orders/${orderId}/archive`;
}

export function lifecycleUxErrorMessage(
  code: string | null | undefined,
  fallback = "No se pudo completar la acción"
): string {
  switch (code) {
    case "ORDER_ARCHIVED":
      return "Este pedido está archivado y no admite cambios.";
    case "ORDER_STALE":
      return "Este pedido ha cambiado desde que empezaste a editarlo.";
    case "ORDER_NOT_TERMINAL":
      return "Solo puedes archivar un pedido entregado o cancelado.";
    default:
      return fallback;
  }
}

export function parseLifecycleApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const record = body as { code?: unknown; error?: unknown };
  const code = typeof record.code === "string" ? record.code : null;
  const apiError = typeof record.error === "string" ? record.error : null;
  return lifecycleUxErrorMessage(code, apiError ?? fallback);
}

/**
 * Archive RPC/API returns a partial order row. Merge onto the loaded ficha
 * snapshot so nested relations are not wiped.
 */
export function mergeArchivedOrderResult<T extends { archived_at?: string | null }>(
  current: T,
  partial: unknown
): T {
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) {
    return current;
  }

  const patch = partial as Record<string, unknown>;
  const next = {
    ...current,
    ...patch,
  } as T;

  const archivedAt = patch.archived_at;
  if (typeof archivedAt === "string" || archivedAt === null) {
    next.archived_at = archivedAt;
  } else {
    next.archived_at = current.archived_at ?? null;
  }

  return next;
}
