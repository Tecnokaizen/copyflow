import { membershipRoleLabel } from "@/lib/auth/membership-roles";

export type HeaderIdentity = {
  name: string;
  email: string | null;
  role: string | null;
  roleLabel: string;
  initials: string;
};

export function initialsFromDisplayName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }

  const source = trimmed.includes("@")
    ? trimmed.slice(0, trimmed.indexOf("@"))
    : trimmed;
  const words = source.split(/[\s._-]+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  if (words.length === 1) {
    const word = words[0];
    const first = word[0] ?? "";
    const second = word[1] ?? "";
    return `${first}${second}`.toUpperCase();
  }

  const first = words[0][0] ?? "";
  const last = words[words.length - 1][0] ?? "";
  return `${first}${last}`.toUpperCase();
}

export function headerRoleLabel(role: string | null | undefined) {
  return membershipRoleLabel(role);
}

export function headerDisplayName(input: {
  teamMemberName?: string | null;
  fullName?: string | null;
  email?: string | null;
}) {
  const teamMemberName = input.teamMemberName?.trim();
  if (teamMemberName) {
    return teamMemberName;
  }

  const fullName = input.fullName?.trim();
  if (fullName) {
    return fullName;
  }

  const email = input.email?.trim();
  if (email) {
    return email;
  }

  return "Usuario";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function headerIdentityFromContext(
  context: unknown
): HeaderIdentity | null {
  const record = asRecord(context);
  const user = asRecord(record?.user);
  const membership = asRecord(record?.membership);
  const teamMember = asRecord(record?.team_member);

  if (!user && !membership && !teamMember) {
    return null;
  }

  const email = asNullableString(user?.email);
  const name = headerDisplayName({
    teamMemberName: asNullableString(teamMember?.name),
    fullName: asNullableString(user?.full_name),
    email,
  });
  const role = asNullableString(membership?.role);

  return {
    name,
    email,
    role,
    roleLabel: headerRoleLabel(role),
    initials: initialsFromDisplayName(name),
  };
}
