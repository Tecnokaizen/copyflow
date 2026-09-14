import type { InvitationPreview } from "./preview";
import {
  invitationAcceptPath,
  parseInvitationToken,
} from "./token";
import {
  INVITATION_GENERIC_FORBIDDEN,
  INVITATION_INVALID,
  INVITATION_EMAIL_MISMATCH,
  invitationStatusMessage,
} from "./copy";

export type InvitationAcceptView =
  | { kind: "error"; message: string }
  | {
      kind: "wrong_account";
      invitedEmail: string;
      sessionEmail: string;
      returnTo: string;
    }
  | {
      kind: "signup";
      email: string;
      emailReadOnly: true;
      name: string | null;
      tenantName: string | null;
    }
  | {
      kind: "login";
      email: string;
      emailReadOnly: true;
      tenantName: string | null;
    }
  | { kind: "auto_accept"; email: string };

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function invitationAcceptView(input: {
  token: string | null;
  preview: InvitationPreview | null;
  sessionEmail: string | null;
}): InvitationAcceptView {
  const token = parseInvitationToken(input.token);
  if (!token) {
    return { kind: "error", message: INVITATION_INVALID };
  }

  const preview = input.preview;
  if (!preview) {
    return { kind: "error", message: INVITATION_INVALID };
  }

  if (preview.status !== "pending") {
    return {
      kind: "error",
      message: invitationStatusMessage(preview.status),
    };
  }

  const invitedEmail = normalizeEmail(preview.email);
  if (!invitedEmail) {
    return { kind: "error", message: INVITATION_INVALID };
  }

  const sessionEmail = normalizeEmail(input.sessionEmail);
  if (sessionEmail && sessionEmail !== invitedEmail) {
    return {
      kind: "wrong_account",
      invitedEmail,
      sessionEmail,
      returnTo: invitationAcceptPath(token),
    };
  }

  if (sessionEmail && sessionEmail === invitedEmail) {
    return { kind: "auto_accept", email: invitedEmail };
  }

  if (preview.account_exists && preview.email_confirmed) {
    return {
      kind: "login",
      email: invitedEmail,
      emailReadOnly: true,
      tenantName: preview.tenant?.name ?? null,
    };
  }

  return {
    kind: "signup",
    email: invitedEmail,
    emailReadOnly: true,
    name: preview.name,
    tenantName: preview.tenant?.name ?? null,
  };
}

export function invitationAcceptFailureView(input: {
  status: number;
  payload: { error?: string; code?: string } | null;
  sessionEmail: string | null;
  invitedEmail: string | null;
  returnTo: string;
}):
  | {
      kind: "wrong_account";
      invitedEmail: string;
      sessionEmail: string;
      returnTo: string;
    }
  | { kind: "error"; message: string } {
  if (input.payload?.code === INVITATION_EMAIL_MISMATCH) {
    const invitedEmail = normalizeEmail(input.invitedEmail);
    const sessionEmail = normalizeEmail(input.sessionEmail);
    if (invitedEmail && sessionEmail) {
      return {
        kind: "wrong_account",
        invitedEmail,
        sessionEmail,
        returnTo: input.returnTo,
      };
    }
  }

  if (input.status === 403) {
    return {
      kind: "error",
      message: INVITATION_GENERIC_FORBIDDEN,
    };
  }

  return {
    kind: "error",
    message:
      input.payload?.error?.trim() ||
      "No se pudo aceptar la invitación.",
  };
}
