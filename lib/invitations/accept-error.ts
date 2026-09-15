import {
  classifyAccessRpcError,
  publicApiErrorCode,
  rpcErrorDigest,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";

export type InvitationAcceptRpcFailure = {
  status: number;
  error: string;
  code?: string;
};

function invitationAcceptPublicMessage(
  kind: ReturnType<typeof classifyAccessRpcError>,
  rpcMessage: string | undefined
) {
  const trimmed = rpcMessage?.trim();

  switch (kind) {
    case "email_mismatch":
      return "Esta invitación es para otra cuenta";
    case "unauthorized":
      return "Inicia sesión para aceptar la invitación.";
    case "not_found":
      return "La invitación no es válida.";
    case "gone":
      return "La invitación ya no está disponible.";
    case "conflict":
      if (trimmed && /already a member/i.test(trimmed)) {
        return "Ya formas parte de esta organización.";
      }
      return "Esta invitación ya fue aceptada.";
    case "invalid":
      return trimmed || "La invitación no es válida.";
    default:
      return trimmed || "No se pudo aceptar la invitación.";
  }
}

export function invitationAcceptRpcFailure(
  error:
    | {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      }
    | null
    | undefined
): InvitationAcceptRpcFailure {
  const digest = rpcErrorDigest(error);
  const kind = classifyAccessRpcError(digest.code, digest.message);
  const code = publicApiErrorCode(digest.code, digest.message);
  const status = statusForAccessRpcError(digest.code, digest.message);

  return {
    status,
    error: invitationAcceptPublicMessage(kind, digest.message),
    ...(code ? { code } : {}),
  };
}
