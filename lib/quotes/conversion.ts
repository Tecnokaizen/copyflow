import { isUuid } from "@/lib/team/payload";
export function parseQuoteConversion(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const ids: Record<string, string | null> = {};
  for (const key of ["store_id", "service_id", "assigned_team_member_id"]) {
    if (!(key in value)) return null;
    if (value[key] !== null && (typeof value[key] !== "string" || !isUuid(value[key]))) return null;
    ids[key] = value[key] as string | null;
  }
  if (!Number.isSafeInteger(value.expected_row_version) || Number(value.expected_row_version) < 0 ||
    !["normal", "high", "urgent"].includes(String(value.priority))) return null;
  let due: string | null = null;
  if (!("due_at" in value)) return null;
  if (value.due_at !== null) {
    if (typeof value.due_at !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.due_at) || !Number.isFinite(Date.parse(value.due_at))) return null;
    due = new Date(value.due_at).toISOString();
  }
  return { store_id:ids.store_id,service_id:ids.service_id,assigned_team_member_id:ids.assigned_team_member_id, priority: value.priority as string, due_at: due, expected_row_version: value.expected_row_version as number };
}
