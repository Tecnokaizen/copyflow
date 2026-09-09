type AccessErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "invalid"
  | "rate_limited_cooldown"
  | "rate_limited_max"
  | "generic";

function normalizeMessage(message: string | undefined) {
  return (message ?? "").toLowerCase();
}

export function classifyAccessRpcError(
  code: string | undefined,
  message?: string
): AccessErrorKind {
  const normalized = normalizeMessage(message);

  if (code === "28000") {
    return "unauthorized";
  }

  if (code === "42501") {
    return "forbidden";
  }

  if (code === "P0002") {
    return "not_found";
  }

  if (code === "GTC01" || normalized.includes("resend too soon")) {
    return "rate_limited_cooldown";
  }

  if (
    code === "GTC02" ||
    normalized.includes("resend limit reached") ||
    normalized.includes("send attempts")
  ) {
    return "rate_limited_max";
  }

  if (code === "23505" || code === "54000") {
    return "conflict";
  }

  if (
    code === "22023" &&
    (normalized.includes("expired") ||
      normalized.includes("not pending") ||
      normalized.includes("revoked") ||
      normalized.includes("superseded"))
  ) {
    return "gone";
  }

  if (code === "22023" || code === "23514") {
    return "invalid";
  }

  return "generic";
}

export function statusForAccessRpcError(
  code: string | undefined,
  message?: string
) {
  switch (classifyAccessRpcError(code, message)) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "gone":
      return 410;
    case "invalid":
      return 400;
    case "rate_limited_cooldown":
    case "rate_limited_max":
      return 429;
    default:
      return 500;
  }
}

export function publicMessageForAccessRpcError(
  code: string | undefined,
  message?: string,
  fallback = "Request failed"
) {
  switch (classifyAccessRpcError(code, message)) {
    case "unauthorized":
      return "Unauthorized";
    case "forbidden":
      return "Unauthorized or tenant access denied";
    case "not_found":
      return "Not found";
    case "conflict":
      return "Conflict";
    case "gone":
      return "Invitation no longer available";
    case "invalid":
      return "Invalid value";
    case "rate_limited_cooldown":
      return "Please wait before resending the invitation";
    case "rate_limited_max":
      return "Invitation resend limit reached";
    default:
      return fallback;
  }
}
