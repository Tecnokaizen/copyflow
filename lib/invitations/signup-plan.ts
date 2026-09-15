import type { InvitationPreview } from "./preview";

export type InvitationSignupPlan =
  | {
      action: "activate";
      email: string;
      password: string;
      name: string | null;
      emailConfirm: true;
    }
  | { action: "login_required"; email: string }
  | { action: "reject"; code: string; error: string; status: number };

function invitedEmail(preview: InvitationPreview) {
  return preview.email?.trim().toLowerCase() ?? "";
}

export function planInvitationSignup(input: {
  preview: InvitationPreview;
  password: string;
  emailFromClient?: unknown;
}): InvitationSignupPlan {
  void input.emailFromClient;

  if (input.password.length < 8) {
    return {
      action: "reject",
      code: "INVALID_PASSWORD",
      error: "La contraseña debe tener al menos 8 caracteres.",
      status: 400,
    };
  }

  if (input.preview.status !== "pending") {
    const status =
      input.preview.status === "accepted"
        ? 409
        : input.preview.status === "not_found"
          ? 404
          : 410;
    return {
      action: "reject",
      code: "INVITATION_UNAVAILABLE",
      error: "La invitación ya no está disponible.",
      status,
    };
  }

  const email = invitedEmail(input.preview);
  if (!email) {
    return {
      action: "reject",
      code: "INVITATION_UNAVAILABLE",
      error: "La invitación no es válida.",
      status: 400,
    };
  }

  if (input.preview.requires_login) {
    return { action: "login_required", email };
  }

  return {
    action: "activate",
    email,
    password: input.password,
    name: input.preview.name,
    emailConfirm: true,
  };
}
