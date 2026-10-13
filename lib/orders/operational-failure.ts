import { userFacingCreateOrderError } from "@/lib/orders/create";
import { ACCESS_CODES } from "@/lib/tenant/access";

export type OperationalAction = "order" | "client" | "options";

export type OperationalFailure = {
  kind: "session_expired" | "tenant_denied" | "temporary" | "other";
  message: string;
  /** The same POST must not be repeated by itself. */
  retry: boolean;
  login: boolean;
};

const SESSION_MESSAGE = "Tu sesión ha caducado. Inicia sesión para continuar.";
const TEMPORARY_MESSAGE =
  "No se ha podido comprobar la sesión. Vuelve a intentarlo.";
const ORDER_DENIED = "No tienes permiso para crear este pedido";
const CLIENT_DENIED = "No tienes permiso para crear este cliente";

function readCode(body: { code?: unknown; error?: unknown } | null) {
  return typeof body?.code === "string" ? body.code : null;
}

function readError(body: { code?: unknown; error?: unknown } | null) {
  return typeof body?.error === "string" ? body.error : "";
}

export function interpretOperationalFailure(
  status: number,
  body: { code?: unknown; error?: unknown } | null,
  action: OperationalAction
): OperationalFailure {
  const code = readCode(body);

  if (status === 401 || code === ACCESS_CODES.sessionExpired) {
    return {
      kind: "session_expired",
      message: SESSION_MESSAGE,
      retry: false,
      login: true,
    };
  }

  if (status === 503 || status === 0 || code === ACCESS_CODES.unavailable) {
    return {
      kind: "temporary",
      message: TEMPORARY_MESSAGE,
      retry: true,
      login: false,
    };
  }

  if (status >= 500) {
    return {
      kind: "temporary",
      message: TEMPORARY_MESSAGE,
      retry: true,
      login: false,
    };
  }

  if (status === 403 || code === ACCESS_CODES.tenantDenied) {
    return {
      kind: "tenant_denied",
      message: action === "client" ? CLIENT_DENIED : ORDER_DENIED,
      retry: false,
      login: false,
    };
  }

  return {
    kind: "other",
    message: userFacingCreateOrderError(readError(body) || "Could not create order"),
    retry: false,
    login: false,
  };
}
