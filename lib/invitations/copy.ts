export const INVITATION_EMAIL_MISMATCH = "INVITATION_EMAIL_MISMATCH";
export const ACCOUNT_EXISTS = "ACCOUNT_EXISTS";

export const INVITATION_INVALID = "La invitación no es válida.";
export const INVITATION_EXPIRED = "Esta invitación ha caducado.";
export const INVITATION_CANCELLED = "Esta invitación fue cancelada.";
export const INVITATION_SUPERSEDED = "Esta invitación ya no está vigente.";
export const INVITATION_ACCEPTED = "Esta invitación ya fue aceptada.";
export const INVITATION_GENERIC_FORBIDDEN =
  "No tienes acceso a esta invitación.";

export const CREATE_ACCOUNT_TITLE = "Crear cuenta";
export const CREATE_ACCOUNT_AND_CONTINUE = "Crear cuenta y continuar";
export const SIGN_IN_TITLE = "Iniciar sesión";
export const PASSWORD_LABEL = "Contraseña";
export const REPEAT_PASSWORD_LABEL = "Repetir contraseña";
export const EMAIL_LABEL = "Correo";
export const PASSWORDS_DO_NOT_MATCH = "Las contraseñas no coinciden.";

export function invitationWrongAccountCopy(
  invitedEmail: string,
  sessionEmail: string
) {
  return {
    title: "Esta invitación es para otra cuenta",
    description: `Esta invitación corresponde a ${invitedEmail} y has iniciado sesión como ${sessionEmail}.`,
    action: `Continuar con ${invitedEmail}`,
  };
}

export function invitationStatusMessage(
  status: "expired" | "cancelled" | "revoked" | "superseded" | "accepted" | "not_found"
) {
  switch (status) {
    case "expired":
      return INVITATION_EXPIRED;
    case "cancelled":
    case "revoked":
      return INVITATION_CANCELLED;
    case "superseded":
      return INVITATION_SUPERSEDED;
    case "accepted":
      return INVITATION_ACCEPTED;
    default:
      return INVITATION_INVALID;
  }
}
