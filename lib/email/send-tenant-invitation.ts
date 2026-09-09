import "server-only";

import { Resend } from "resend";
import {
  MEMBERSHIP_ROLE_LABELS,
  type InvitableRole,
  isInvitableRole,
} from "@/lib/auth/membership-roles";
import {
  assertEmailConfigForResend,
  resolveEmailTransport,
} from "@/lib/email/env";

export type SendTenantInvitationInput = {
  email: string;
  tenantName: string;
  role: InvitableRole | string;
  invitationUrl: string;
  expiresAt: string;
};

export type SendTenantInvitationResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      code: "config" | "provider" | "rejected";
      message: string;
    };

function roleLabel(role: string) {
  if (isInvitableRole(role) || role in MEMBERSHIP_ROLE_LABELS) {
    return MEMBERSHIP_ROLE_LABELS[role as keyof typeof MEMBERSHIP_ROLE_LABELS];
  }
  return "Miembro";
}

function formatExpiresAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

function buildPlainText(input: SendTenantInvitationInput, label: string) {
  const expires = formatExpiresAt(input.expiresAt);
  return [
    `Te han invitado a unirte a ${input.tenantName} en Gestcopy.`,
    "",
    `Rol: ${label}`,
    "",
    `Aceptar invitación: ${input.invitationUrl}`,
    "",
    `Esta invitación caduca el ${expires}.`,
    "",
    "Si no esperabas este correo, puedes ignorarlo.",
  ].join("\n");
}

function buildHtml(input: SendTenantInvitationInput, label: string) {
  const expires = formatExpiresAt(input.expiresAt);
  const safeTenant = escapeHtml(input.tenantName);
  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(input.invitationUrl);
  const safeExpires = escapeHtml(expires);

  return `<!DOCTYPE html>
<html lang="es">
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
  <p>Te han invitado a unirte a <strong>${safeTenant}</strong> en Gestcopy.</p>
  <p>Rol: <strong>${safeLabel}</strong></p>
  <p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Aceptar invitación</a></p>
  <p>Esta invitación caduca el ${safeExpires}.</p>
  <p style="color:#555;font-size:14px;">Si no esperabas este correo, puedes ignorarlo.</p>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendTenantInvitationEmail(
  input: SendTenantInvitationInput
): Promise<SendTenantInvitationResult> {
  const label = roleLabel(input.role);
  const subject = `Te han invitado a ${input.tenantName} en Gestcopy`;
  const text = buildPlainText(input, label);
  const html = buildHtml(input, label);
  const transport = resolveEmailTransport();

  if (transport === "console") {
    console.info("[email:console] tenant invitation simulated", {
      to: input.email,
      tenantName: input.tenantName,
      role: input.role,
      expiresAt: input.expiresAt,
      // Intentionally omit invitationUrl and token.
    });
    return { ok: true, providerMessageId: `console-${Date.now()}` };
  }

  if (transport === "fail") {
    return {
      ok: false,
      code: "provider",
      message: "Simulated email delivery failure",
    };
  }

  const config = assertEmailConfigForResend();
  if (!config.ok) {
    return {
      ok: false,
      code: "config",
      message:
        config.reason === "missing_api_key"
          ? "RESEND_API_KEY is not configured"
          : "EMAIL_FROM is not configured",
    };
  }

  try {
    const resend = new Resend(config.apiKey);
    const { data, error } = await resend.emails.send({
      from: config.from,
      to: input.email,
      subject,
      text,
      html,
    });

    if (error) {
      const statusCode =
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : undefined;

      if (statusCode === 422 || statusCode === 403 || statusCode === 400) {
        return {
          ok: false,
          code: "rejected",
          message: error.message || "Email rejected by provider",
        };
      }

      return {
        ok: false,
        code: "provider",
        message: error.message || "Email provider error",
      };
    }

    const providerMessageId =
      data && typeof data === "object" && "id" in data && typeof data.id === "string"
        ? data.id
        : "unknown";

    return { ok: true, providerMessageId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Email provider exception";
    return { ok: false, code: "provider", message };
  }
}
