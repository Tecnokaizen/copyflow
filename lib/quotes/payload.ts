import { isUuid } from "@/lib/team/payload";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type QuoteWriteInput = {
  title: string | null;
  description: string;
  notes: string | null;
  valid_until: string | null;
  client_id: string | null;
  service_id: string | null;
  assigned_team_member_id: string | null;
};

export type QuoteUpdateInput = QuoteWriteInput & {
  expected_row_version: number;
};

export type QuoteStatusInput = {
  status_id: string;
  expected_row_version: number;
};

type Fail = { ok: false; error: string };
type Ok<T> = { ok: true; data: T };

function record(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  return body as Record<string, unknown>;
}

function optionalText(value: unknown) {
  if (value == null) {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false as const, error: QUOTE_MESSAGES.invalid };
  }

  const trimmed = value.trim();
  return { ok: true as const, value: trimmed ? trimmed : null };
}

function optionalUuid(value: unknown) {
  if (value == null || value === "") {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string" || !isUuid(value)) {
    return { ok: false as const, error: QUOTE_MESSAGES.relation };
  }

  return { ok: true as const, value: value };
}

function optionalDate(value: unknown) {
  if (value == null || value === "") {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return { ok: false as const, error: QUOTE_MESSAGES.date };
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false as const, error: QUOTE_MESSAGES.date };
  }

  return { ok: true as const, value };
}

function requiredVersion(value: unknown): Ok<number> | Fail {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { ok: false, error: QUOTE_MESSAGES.version };
  }

  return { ok: true, data: value };
}

function readWriteFields(payload: Record<string, unknown>): Ok<QuoteWriteInput> | Fail {
  const title = optionalText(payload.title);
  if (!title.ok) {
    return title;
  }

  const description = optionalText(payload.description);
  if (!description.ok) {
    return description;
  }

  if (!description.value) {
    return { ok: false, error: QUOTE_MESSAGES.description };
  }

  const notes = optionalText(payload.notes);
  if (!notes.ok) {
    return notes;
  }

  const validUntil = optionalDate(payload.valid_until);
  if (!validUntil.ok) {
    return validUntil;
  }

  const clientId = optionalUuid(payload.client_id);
  if (!clientId.ok) {
    return clientId;
  }

  const serviceId = optionalUuid(payload.service_id);
  if (!serviceId.ok) {
    return serviceId;
  }

  const assigneeId = optionalUuid(payload.assigned_team_member_id);
  if (!assigneeId.ok) {
    return assigneeId;
  }

  return {
    ok: true,
    data: {
      title: title.value,
      description: description.value,
      notes: notes.value,
      valid_until: validUntil.value,
      client_id: clientId.value,
      service_id: serviceId.value,
      assigned_team_member_id: assigneeId.value,
    },
  };
}

export function parseCreateQuotePayload(body: unknown): Ok<QuoteWriteInput> | Fail {
  const payload = record(body);
  if (!payload) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  return readWriteFields(payload);
}

export function parseUpdateQuotePayload(body: unknown): Ok<QuoteUpdateInput> | Fail {
  const payload = record(body);
  if (!payload) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const version = requiredVersion(payload.expected_row_version);
  if (!version.ok) {
    return version;
  }

  const fields = readWriteFields(payload);
  if (!fields.ok) {
    return fields;
  }

  return {
    ok: true,
    data: {
      ...fields.data,
      expected_row_version: version.data,
    },
  };
}

export function parseQuoteStatusPayload(body: unknown): Ok<QuoteStatusInput> | Fail {
  const payload = record(body);
  if (!payload) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  if (typeof payload.status_id !== "string" || !isUuid(payload.status_id)) {
    return { ok: false, error: QUOTE_MESSAGES.status };
  }

  const version = requiredVersion(payload.expected_row_version);
  if (!version.ok) {
    return version;
  }

  return {
    ok: true,
    data: {
      status_id: payload.status_id,
      expected_row_version: version.data,
    },
  };
}
