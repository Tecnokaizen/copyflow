import { leadTimeToMinutes, type ServicePayload } from "@/lib/services/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOptionalText(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

function normalizeUuid(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (!UUID_PATTERN.test(trimmed)) {
    return { ok: false };
  }

  return { ok: true, value: trimmed };
}

function normalizeBoolean(
  value: unknown,
  fallback: boolean
): { ok: true; value: boolean } | { ok: false } {
  if (value == null) {
    return { ok: true, value: fallback };
  }

  if (typeof value === "boolean") {
    return { ok: true, value };
  }

  if (value === "true" || value === 1 || value === "1") {
    return { ok: true, value: true };
  }

  if (value === "false" || value === 0 || value === "0") {
    return { ok: true, value: false };
  }

  return { ok: false };
}

function normalizeNonNegativeInteger(
  value: unknown,
  fallback: number
): { ok: true; value: number } | { ok: false } {
  if (value == null || value === "") {
    return { ok: true, value: fallback };
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
}

function normalizeLeadTime(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "unit" in value
  ) {
    const record = value as { value: unknown; unit: unknown };
    if (
      record.unit !== "minutes" &&
      record.unit !== "hours" &&
      record.unit !== "days"
    ) {
      return { ok: false };
    }

    return leadTimeToMinutes(String(record.value ?? ""), record.unit);
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
}

export function parseServicePayload(
  payload: Record<string, unknown>
): { ok: true; data: ServicePayload } | { ok: false } {
  if (typeof payload.name !== "string") {
    return { ok: false };
  }

  const name = payload.name.trim();
  if (!name) {
    return { ok: false };
  }

  const categoryId = normalizeUuid(payload.category_id);
  const description = normalizeOptionalText(payload.description);
  const leadTime = normalizeLeadTime(payload.standard_lead_time_minutes);
  const requiresFile = normalizeBoolean(payload.requires_file, false);
  const requiresDesign = normalizeBoolean(payload.requires_design, false);
  const requiresQuote = normalizeBoolean(payload.requires_quote, false);
  const active = normalizeBoolean(payload.active, true);
  const sortOrder = normalizeNonNegativeInteger(payload.sort_order, 0);

  if (
    !categoryId.ok ||
    !description.ok ||
    !leadTime.ok ||
    !requiresFile.ok ||
    !requiresDesign.ok ||
    !requiresQuote.ok ||
    !active.ok ||
    !sortOrder.ok
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      category_id: categoryId.value,
      name,
      description: description.value,
      standard_lead_time_minutes: leadTime.value,
      requires_file: requiresFile.value,
      requires_design: requiresDesign.value,
      requires_quote: requiresQuote.value,
      active: active.value,
      sort_order: sortOrder.value,
    },
  };
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export { UUID_PATTERN };
