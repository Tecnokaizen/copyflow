import { canWriteTeam } from "@/lib/auth/membership-roles";
import type { TeamAccessUser } from "@/lib/team/link";

export type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  active: boolean;
  can_receive_orders: boolean;
  notes: string | null;
  user_id: string | null;
  has_access: boolean;
  active_orders_count: number;
  total_orders_count: number;
  created_at: string;
  updated_at: string;
};

export type { TeamAccessUser };

export type TeamListResponse = {
  tenant: string;
  members: TeamMember[];
  total: number;
  available_count: number;
  active_orders_count: number;
  access_users: TeamAccessUser[];
};

export type TeamMemberFormData = {
  name: string;
  job_title: string;
  department: string;
  email: string;
  phone: string;
  active: boolean;
  can_receive_orders: boolean;
  user_id: string;
};

export type TeamMemberPayload = {
  name: string;
  job_title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  can_receive_orders: boolean;
  user_id: string | null;
};

export { canWriteTeam };

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

export function mapTeamMember(row: unknown): TeamMember | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name : null;

  if (!id || !name) {
    return null;
  }

  const userId = asNullableString(record.user_id);

  return {
    id,
    name,
    email: asNullableString(record.email),
    phone: asNullableString(record.phone),
    job_title: asNullableString(record.job_title),
    department: asNullableString(record.department),
    active: record.active === undefined ? true : asBoolean(record.active, true),
    can_receive_orders:
      record.can_receive_orders === undefined
        ? true
        : asBoolean(record.can_receive_orders, true),
    notes: asNullableString(record.notes),
    user_id: userId,
    has_access: Boolean(userId),
    active_orders_count: asNumber(record.active_orders_count, 0),
    total_orders_count: asNumber(record.total_orders_count, 0),
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    updated_at: typeof record.updated_at === "string" ? record.updated_at : "",
  };
}

export function applyTeamMemberLinks(
  members: TeamMember[],
  links: Array<{ id: string; user_id: string | null }>
) {
  const userIdByMember = new Map(
    links.map((link) => [link.id, link.user_id] as const)
  );

  return members.map((member) => {
    const userId = userIdByMember.has(member.id)
      ? userIdByMember.get(member.id) ?? null
      : member.user_id;

    return {
      ...member,
      user_id: userId,
      has_access: Boolean(userId),
    };
  });
}

export function memberToForm(member: TeamMember): TeamMemberFormData {
  return {
    name: member.name,
    job_title: member.job_title ?? "",
    department: member.department ?? "",
    email: member.email ?? "",
    phone: member.phone ?? "",
    active: member.active,
    can_receive_orders: member.can_receive_orders,
    user_id: member.user_id ?? "",
  };
}

export function emptyTeamMemberForm(): TeamMemberFormData {
  return {
    name: "",
    job_title: "",
    department: "",
    email: "",
    phone: "",
    active: true,
    can_receive_orders: true,
    user_id: "",
  };
}

export function formToTeamPayload(
  form: TeamMemberFormData
): { ok: true; data: TeamMemberPayload } | { ok: false } {
  const name = form.name.trim();
  if (!name) {
    return { ok: false };
  }

  const userId = form.user_id.trim();
  if (userId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      name,
      job_title: form.job_title.trim() || null,
      department: form.department.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      active: form.active,
      can_receive_orders: form.can_receive_orders,
      user_id: userId || null,
    },
  };
}
