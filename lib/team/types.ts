import { canWriteTeam } from "@/lib/auth/membership-roles";

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
  active_orders_count: number;
  total_orders_count: number;
  created_at: string;
  updated_at: string;
};

export type TeamListResponse = {
  tenant: string;
  members: TeamMember[];
  total: number;
  available_count: number;
  active_orders_count: number;
};

export type TeamMemberFormData = {
  name: string;
  job_title: string;
  department: string;
  active: boolean;
  can_receive_orders: boolean;
};

export type TeamMemberPayload = {
  name: string;
  job_title: string | null;
  department: string | null;
  active: boolean;
  can_receive_orders: boolean;
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
    active_orders_count: asNumber(record.active_orders_count, 0),
    total_orders_count: asNumber(record.total_orders_count, 0),
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    updated_at: typeof record.updated_at === "string" ? record.updated_at : "",
  };
}

export function memberToForm(member: TeamMember): TeamMemberFormData {
  return {
    name: member.name,
    job_title: member.job_title ?? "",
    department: member.department ?? "",
    active: member.active,
    can_receive_orders: member.can_receive_orders,
  };
}

export function formToTeamPayload(
  form: TeamMemberFormData
): { ok: true; data: TeamMemberPayload } | { ok: false } {
  const name = form.name.trim();
  if (!name) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      name,
      job_title: form.job_title.trim() || null,
      department: form.department.trim() || null,
      active: form.active,
      can_receive_orders: form.can_receive_orders,
    },
  };
}
