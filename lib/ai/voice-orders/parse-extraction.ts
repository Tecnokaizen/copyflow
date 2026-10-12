import type { ModelExtraction } from "@/lib/ai/providers/types";

function asNullableString(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableInt(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function parseDue(value: unknown): ModelExtraction["due"] | null {
  if (!value || typeof value !== "object") return null;
  const due = value as Record<string, unknown>;
  const kind = due.kind;
  if (
    kind !== "none" &&
    kind !== "absolute" &&
    kind !== "relative_days" &&
    kind !== "weekday"
  ) {
    return null;
  }

  return {
    kind,
    date: asNullableString(due.date),
    offset_days: asNullableInt(due.offset_days),
    weekday: asNullableInt(due.weekday),
    week_offset: asNullableInt(due.week_offset),
    time: asNullableString(due.time),
    expression: asNullableString(due.expression),
  };
}

export function parseModelExtraction(raw: string): ModelExtraction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;

  const priority =
    row.priority === "normal" ||
    row.priority === "high" ||
    row.priority === "urgent" ||
    row.priority === null
      ? row.priority
      : null;

  let client: ModelExtraction["client"] = null;
  if (row.client && typeof row.client === "object") {
    const c = row.client as Record<string, unknown>;
    client = {
      name: asNullableString(c.name),
      phone: asNullableString(c.phone),
      company: asNullableString(c.company),
    };
  } else if (row.client === null) {
    client = null;
  }

  const due = parseDue(row.due);
  if (!due) return null;

  const evidence = Array.isArray(row.evidence)
    ? row.evidence
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const e = item as Record<string, unknown>;
          return {
            field: typeof e.field === "string" ? e.field : "",
            quote: typeof e.quote === "string" ? e.quote : "",
          };
        })
        .filter((item) => item.field && item.quote)
    : [];

  const ambiguities = Array.isArray(row.ambiguities)
    ? row.ambiguities
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const a = item as Record<string, unknown>;
          return {
            field: typeof a.field === "string" ? a.field : "",
            reason: typeof a.reason === "string" ? a.reason : "",
          };
        })
        .filter((item) => item.field && item.reason)
    : [];

  return {
    title: asNullableString(row.title),
    description: asNullableString(row.description),
    notes: asNullableString(row.notes),
    client,
    service_ref: asNullableString(row.service_ref),
    store_ref: asNullableString(row.store_ref),
    channel_ref: asNullableString(row.channel_ref),
    context_ref: asNullableString(row.context_ref),
    assignee_ref: asNullableString(row.assignee_ref),
    priority,
    due,
    evidence,
    ambiguities,
  };
}
