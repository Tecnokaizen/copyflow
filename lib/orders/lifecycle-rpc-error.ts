import { rpcErrorDigest } from "@/lib/access/rpc-error";

export type LifecycleRpcErrorInput = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null | undefined;

export type LifecyclePublicError = {
  status: number;
  body: {
    error: string;
    code?: "ORDER_ARCHIVED" | "ORDER_NOT_TERMINAL";
  };
};

function normalizeMessage(message: string | undefined) {
  return (message ?? "").toLowerCase();
}

function statusForBaseRpcCode(code: string | undefined) {
  switch (code) {
    case "28000":
      return 401;
    case "42501":
      return 403;
    case "22023":
      return 400;
    case "P0002":
      return 404;
    default:
      return 500;
  }
}

function publicMessageForBaseRpcCode(
  code: string | undefined,
  fallback: string
) {
  switch (code) {
    case "28000":
      return "Unauthorized";
    case "42501":
      return "Unauthorized or tenant access denied";
    case "22023":
      return "Invalid request";
    case "P0002":
      return "Order not found";
    default:
      return fallback;
  }
}

/**
 * Maps order lifecycle RPC failures to stable public HTTP responses.
 * Known lifecycle conflicts are detected from our RPC messages only;
 * generic 42501 (e.g. tenant access denied) stays 403.
 */
export function mapLifecycleRpcError(
  error: LifecycleRpcErrorInput,
  fallbackError = "Request failed"
): LifecyclePublicError {
  const digest = rpcErrorDigest(error);
  const normalized = normalizeMessage(digest.message);

  if (normalized.includes("order is archived")) {
    return {
      status: 409,
      body: {
        error: "Order is archived",
        code: "ORDER_ARCHIVED",
      },
    };
  }

  if (normalized.includes("order is not terminal")) {
    return {
      status: 409,
      body: {
        error: "Order must be terminal before archiving",
        code: "ORDER_NOT_TERMINAL",
      },
    };
  }

  return {
    status: statusForBaseRpcCode(digest.code),
    body: {
      error: publicMessageForBaseRpcCode(digest.code, fallbackError),
    },
  };
}

/**
 * Archived-order conflict, or null when the failure is anything else.
 *
 * Lets routes with their own error mapping (order client assignment keeps the
 * client duplicate contract) reuse the exact ORDER_ARCHIVED response without
 * adopting the whole lifecycle mapping.
 */
export function archivedOrderConflict(
  error: LifecycleRpcErrorInput
): LifecyclePublicError | null {
  const mapped = mapLifecycleRpcError(error);

  return mapped.body.code === "ORDER_ARCHIVED" ? mapped : null;
}
