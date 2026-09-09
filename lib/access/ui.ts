import type {
  AccessInvitation,
  AccessListResponse,
  AccessMembership,
} from "@/lib/access/types";
import { mapAccessInvitation, mapAccessMembership } from "@/lib/access/types";

export function parseAccessListResponse(
  payload: unknown
): AccessListResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const tenantRaw = record.tenant;
  if (!tenantRaw || typeof tenantRaw !== "object") {
    return null;
  }

  const tenant = tenantRaw as Record<string, unknown>;
  const id = typeof tenant.id === "string" ? tenant.id : null;
  const name = typeof tenant.name === "string" ? tenant.name : null;
  const slug = typeof tenant.slug === "string" ? tenant.slug : null;

  if (!id || !name || !slug) {
    return null;
  }

  const memberships = (
    Array.isArray(record.memberships) ? record.memberships : []
  )
    .map((row) => mapAccessMembership(row))
    .filter((row): row is AccessMembership => row !== null);

  const invitations = (
    Array.isArray(record.invitations) ? record.invitations : []
  )
    .map((row) => mapAccessInvitation(row))
    .filter((row): row is AccessInvitation => row !== null);

  return {
    tenant: { id, name, slug },
    memberships,
    invitations,
  };
}

export function isInvitationVisuallyExpired(invitation: AccessInvitation) {
  if (!invitation.expires_at) {
    return false;
  }
  const expires = new Date(invitation.expires_at);
  if (Number.isNaN(expires.getTime())) {
    return false;
  }
  return expires.getTime() < Date.now();
}

export function formatAccessDate(value: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export function publicAccessUiError(
  status: number,
  payload: { error?: string; code?: string } | null
) {
  if (payload?.code === "email_delivery_failed") {
    return "La invitación se creó, pero no se pudo enviar el email. Prueba a reenviar.";
  }
  if (status === 429) {
    return (
      payload?.error ??
      "Debes esperar un momento antes de reenviar esta invitación."
    );
  }
  if (status === 409) {
    return "Ese email ya tiene acceso o una invitación pendiente.";
  }
  if (status === 403) {
    return "No tienes permiso para realizar esta acción.";
  }
  if (status === 404) {
    return "No se encontró el recurso.";
  }
  if (status === 410) {
    return "La invitación ya no está disponible.";
  }
  if (status === 400) {
    return "Revisa los datos indicados.";
  }
  if (status === 502) {
    return (
      payload?.error ??
      "No se pudo enviar el email de invitación. Inténtalo de nuevo."
    );
  }
  return payload?.error ?? "No se pudo completar la operación.";
}
