export type InvitationPreviewStatus =
  | "pending"
  | "expired"
  | "cancelled"
  | "revoked"
  | "superseded"
  | "accepted"
  | "not_found";

export type InvitationPreviewTenant = {
  id: string;
  name: string;
  slug: string;
};

export type InvitationPreview = {
  status: InvitationPreviewStatus;
  email: string | null;
  name: string | null;
  tenant: InvitationPreviewTenant | null;
  account_exists: boolean;
  email_confirmed: boolean;
  auth_user_id: string | null;
  role: string | null;
  add_to_personal: boolean;
};

export type PublicInvitationPreview = Omit<InvitationPreview, "auth_user_id">;

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true || value === "t" || value === "true" || value === 1;
}

const STATUSES = new Set<InvitationPreviewStatus>([
  "pending",
  "expired",
  "cancelled",
  "revoked",
  "superseded",
  "accepted",
  "not_found",
]);

function mapTenant(value: unknown): InvitationPreviewTenant | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = asNullableString(record.id);
  const name = asNullableString(record.name);
  const slug = asNullableString(record.slug);
  if (!id || !name || !slug) {
    return null;
  }
  return { id, name, slug };
}

export function mapInvitationPreview(data: unknown): InvitationPreview | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : (data as Record<string, unknown>);

  if (!record) {
    return null;
  }

  const statusRaw = asNullableString(record.status);
  const status =
    statusRaw && STATUSES.has(statusRaw as InvitationPreviewStatus)
      ? (statusRaw as InvitationPreviewStatus)
      : null;

  if (!status) {
    return null;
  }

  return {
    status,
    email: asNullableString(record.email),
    name: asNullableString(record.name),
    tenant: mapTenant(record.tenant),
    account_exists: asBoolean(record.account_exists, false),
    email_confirmed: asBoolean(record.email_confirmed, false),
    auth_user_id: asNullableString(record.auth_user_id),
    role: asNullableString(record.role),
    add_to_personal: asBoolean(record.add_to_personal, false),
  };
}

export function toPublicInvitationPreview(
  preview: InvitationPreview
): PublicInvitationPreview {
  return {
    status: preview.status,
    email: preview.email,
    name: preview.name,
    tenant: preview.tenant,
    account_exists: preview.account_exists,
    email_confirmed: preview.email_confirmed,
    role: preview.role,
    add_to_personal: preview.add_to_personal,
  };
}
