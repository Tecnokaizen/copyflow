import type { InvitableRole, MembershipRole } from "@/lib/auth/membership-roles";

export type AccessMembership = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: MembershipRole | string;
  active: boolean;
  created_at: string | null;
};

export type AccessInvitation = {
  invitation_id: string;
  email: string;
  role: InvitableRole | string;
  status: string;
  expires_at: string | null;
  invited_by_user_id: string | null;
  created_at: string | null;
  last_sent_at: string | null;
  send_attempts: number;
};

export type AccessListResponse = {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  memberships: AccessMembership[];
  invitations: AccessInvitation[];
};

/** Public HTTP body for create/resend — never includes plaintext token. */
export type CreatedInvitationPublicResponse = {
  invitation: {
    id: string;
    email: string;
    role: string;
    expires_at: string | null;
    send_attempts: number;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
};

/** Server-only mapping of RPC create/resend payload (token stays in memory). */
export type CreatedInvitationResult = CreatedInvitationPublicResponse & {
  token: string;
};

export type AcceptInvitationResponse = {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    role: string;
    active: boolean;
  };
  tenant_origin: string;
};

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

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function unwrapRpcPayload(data: unknown): Record<string, unknown> {
  const payload = Array.isArray(data) ? data[0] : data;
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }

  return {};
}

export function mapAccessMembership(row: unknown): AccessMembership | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const userId = asNullableString(record.user_id);
  const role = asNullableString(record.role);

  if (!userId || !role) {
    return null;
  }

  return {
    user_id: userId,
    full_name: asNullableString(record.full_name),
    email: asNullableString(record.email),
    role,
    active: asBoolean(record.active, true),
    created_at: asNullableString(record.created_at),
  };
}

export function mapAccessInvitation(row: unknown): AccessInvitation | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const invitationId = asNullableString(record.invitation_id);
  const email = asNullableString(record.email);
  const role = asNullableString(record.role);
  const status = asNullableString(record.status);

  if (!invitationId || !email || !role || !status) {
    return null;
  }

  // Never surface token/token_hash even if an RPC accidentally includes them.
  return {
    invitation_id: invitationId,
    email,
    role,
    status,
    expires_at: asNullableString(record.expires_at),
    invited_by_user_id: asNullableString(record.invited_by_user_id),
    created_at: asNullableString(record.created_at),
    last_sent_at: asNullableString(record.last_sent_at),
    send_attempts: asNumber(record.send_attempts, 0),
  };
}

export function mapCreateInvitationResult(
  data: unknown
): CreatedInvitationResult | null {
  const record = unwrapRpcPayload(data);
  const invitationId = asNullableString(record.invitation_id);
  const email = asNullableString(record.email);
  const role = asNullableString(record.role);
  const token = asNullableString(record.token);
  const tenantId = asNullableString(record.tenant_id);
  const tenantName = asNullableString(record.tenant_name);
  const tenantSlug = asNullableString(record.tenant_slug);

  if (
    !invitationId ||
    !email ||
    !role ||
    !token ||
    !tenantId ||
    !tenantName ||
    !tenantSlug
  ) {
    return null;
  }

  return {
    invitation: {
      id: invitationId,
      email,
      role,
      expires_at: asNullableString(record.expires_at),
      send_attempts: asNumber(record.send_attempts, 1),
    },
    token,
    tenant: {
      id: tenantId,
      name: tenantName,
      slug: tenantSlug,
    },
  };
}

export function toPublicCreatedInvitation(
  mapped: CreatedInvitationResult
): CreatedInvitationPublicResponse {
  return {
    invitation: mapped.invitation,
    tenant: mapped.tenant,
  };
}

export function mapAcceptInvitationResult(
  data: unknown
): Omit<AcceptInvitationResponse, "tenant_origin"> | null {
  const record = unwrapRpcPayload(data);
  const tenantRaw = record.tenant;
  const membershipRaw = record.membership;

  if (
    !tenantRaw ||
    typeof tenantRaw !== "object" ||
    !membershipRaw ||
    typeof membershipRaw !== "object"
  ) {
    return null;
  }

  const tenant = tenantRaw as Record<string, unknown>;
  const membership = membershipRaw as Record<string, unknown>;
  const id = asNullableString(tenant.id);
  const name = asNullableString(tenant.name);
  const slug = asNullableString(tenant.slug);
  const role = asNullableString(membership.role);

  if (!id || !name || !slug || !role) {
    return null;
  }

  return {
    tenant: { id, name, slug },
    membership: {
      role,
      active: asBoolean(membership.active, true),
    },
  };
}

export function containsTokenMaterial(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value === "string") {
    return false;
  }

  const json = JSON.stringify(value);
  return (
    /"token_hash"\s*:/i.test(json) ||
    /"token"\s*:/i.test(json)
  );
}
