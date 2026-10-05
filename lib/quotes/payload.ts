import { isUuid } from "@/lib/team/payload";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { isRichTextEmpty, persistRichText } from "@/lib/rich-text/html";
import type {
  QuoteDraftHeader,
  QuoteDraftItemInput,
  QuoteDraftPayload,
  QuotePreparePayload,
} from "@/lib/quotes/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ITEMS = 500;

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

function boundedOptionalText(value: unknown, maxLength: number) {
  const parsed = optionalText(value);
  if (!parsed.ok || (parsed.value?.length ?? 0) > maxLength) {
    return { ok: false as const, error: QUOTE_MESSAGES.invalid };
  }

  return parsed;
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { ok: false, error: QUOTE_MESSAGES.version };
  }

  return { ok: true, data: value };
}

function requiredDate(value: unknown) {
  const parsed = optionalDate(value);
  if (!parsed.ok || !parsed.value) {
    return { ok: false as const, error: QUOTE_MESSAGES.date };
  }

  return parsed;
}

function decimal(
  value: unknown,
  options: { maxIntegerDigits: number; maxFractionDigits: number; positive?: boolean; percent?: boolean }
) {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== "string") {
    return { ok: false as const, error: QUOTE_MESSAGES.invalid };
  }

  const text = raw.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (
    !match ||
    match[1].length > options.maxIntegerDigits ||
    (match[2]?.length ?? 0) > options.maxFractionDigits
  ) {
    return { ok: false as const, error: QUOTE_MESSAGES.invalid };
  }

  const isZero = /^0+$/.test(match[1]) && (!match[2] || /^0+$/.test(match[2]));
  if (options.positive && isZero) {
    return { ok: false as const, error: QUOTE_MESSAGES.invalid };
  }

  if (options.percent) {
    const integer = Number(match[1]);
    if (integer > 100 || (integer === 100 && !!match[2] && !/^0+$/.test(match[2]))) {
      return { ok: false as const, error: QUOTE_MESSAGES.invalid };
    }
  }

  return { ok: true as const, value: text };
}

function commercialHeader(value: unknown): Ok<QuoteDraftHeader> | Fail {
  const payload = record(value);
  if (!payload) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const title = boundedOptionalText(payload.title, 500);
  const contactName = boundedOptionalText(payload.contact_name, 500);
  const contactEmail = boundedOptionalText(payload.contact_email, 320);
  const contactPhone = boundedOptionalText(payload.contact_phone, 100);
  const billingName = boundedOptionalText(payload.billing_name, 500);
  const taxId = boundedOptionalText(payload.tax_id, 100);
  const billingAddress = boundedOptionalText(payload.billing_address, 5_000);
  const validUntil = optionalDate(payload.valid_until);
  const issueDate = requiredDate(payload.issue_date);

  if (!title.ok) return title;
  if (!contactName.ok) return contactName;
  if (!contactEmail.ok) return contactEmail;
  if (!contactPhone.ok) return contactPhone;
  if (!billingName.ok) return billingName;
  if (!taxId.ok) return taxId;
  if (!billingAddress.ok) return billingAddress;
  if (!validUntil.ok) return validUntil;
  if (!issueDate.ok) return issueDate;

  if (contactEmail.value && !EMAIL_PATTERN.test(contactEmail.value)) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  if (typeof payload.description !== "string") {
    return { ok: false, error: QUOTE_MESSAGES.description };
  }
  const description = persistRichText(payload.description);
  if (!description || isRichTextEmpty(description) || description.length > 50_000) {
    return { ok: false, error: QUOTE_MESSAGES.description };
  }

  if (typeof payload.terms !== "string" && payload.terms != null) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }
  const terms = persistRichText(typeof payload.terms === "string" ? payload.terms : "");
  if ((terms?.length ?? 0) > 50_000) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  if (typeof payload.currency !== "string" || !CURRENCY_PATTERN.test(payload.currency)) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }
  if (typeof payload.prices_include_tax !== "boolean") {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  return {
    ok: true,
    data: {
      title: title.value,
      description,
      terms,
      contact_name: contactName.value,
      contact_email: contactEmail.value,
      contact_phone: contactPhone.value,
      billing_name: billingName.value,
      tax_id: taxId.value,
      billing_address: billingAddress.value,
      issue_date: issueDate.value,
      valid_until: validUntil.value,
      currency: payload.currency,
      prices_include_tax: payload.prices_include_tax,
    },
  };
}

function commercialItem(value: unknown): Ok<QuoteDraftItemInput> | Fail {
  const payload = record(value);
  if (!payload) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const concept = boundedOptionalText(payload.concept, 2_000);
  const itemDescription = boundedOptionalText(payload.description, 10_000);
  const unit = boundedOptionalText(payload.unit, 100);
  const quantity = decimal(payload.quantity, {
    maxIntegerDigits: 12,
    maxFractionDigits: 6,
    positive: true,
  });
  const unitPrice = decimal(payload.unit_price, {
    maxIntegerDigits: 12,
    maxFractionDigits: 6,
  });
  const discount = decimal(payload.discount_percent ?? "0", {
    maxIntegerDigits: 3,
    maxFractionDigits: 6,
    percent: true,
  });
  const taxRate = decimal(payload.tax_rate ?? "0", {
    maxIntegerDigits: 3,
    maxFractionDigits: 6,
    percent: true,
  });

  if (!concept.ok || !concept.value) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }
  if (!itemDescription.ok) return itemDescription;
  if (!unit.ok) return unit;
  if (!quantity.ok) return quantity;
  if (!unitPrice.ok) return unitPrice;
  if (!discount.ok) return discount;
  if (!taxRate.ok) return taxRate;

  return {
    ok: true,
    data: {
      concept: concept.value,
      description: itemDescription.value,
      quantity: quantity.value,
      unit: unit.value,
      unit_price: unitPrice.value,
      discount_percent: discount.value,
      tax_rate: taxRate.value,
    },
  };
}

function readWriteFields(payload: Record<string, unknown>): Ok<QuoteWriteInput> | Fail {
  const title = optionalText(payload.title);
  if (!title.ok) {
    return title;
  }

  if (typeof payload.description !== "string" && payload.description != null) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const description = persistRichText(
    typeof payload.description === "string" ? payload.description : ""
  );
  if (!description || isRichTextEmpty(description)) {
    return { ok: false, error: QUOTE_MESSAGES.description };
  }

  if (typeof payload.notes !== "string" && payload.notes != null) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const notes = persistRichText(
    typeof payload.notes === "string" ? payload.notes : ""
  );

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
      description,
      notes,
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

export function parseQuoteDraftPayload(body: unknown): Ok<QuoteDraftPayload> | Fail {
  const payload = record(body);
  if (!payload || typeof payload.version_id !== "string" || !isUuid(payload.version_id)) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const version = requiredVersion(payload.expected_row_version);
  if (!version.ok) {
    return version;
  }

  const header = commercialHeader(payload.header);
  if (!header.ok) {
    return header;
  }

  if (!Array.isArray(payload.items) || payload.items.length > MAX_ITEMS) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const items: QuoteDraftItemInput[] = [];
  for (const value of payload.items) {
    const parsed = commercialItem(value);
    if (!parsed.ok) {
      return parsed;
    }
    items.push(parsed.data);
  }

  return {
    ok: true,
    data: {
      version_id: payload.version_id,
      expected_row_version: version.data,
      header: header.data,
      items,
    },
  };
}

export function parseQuotePreparePayload(body: unknown): Ok<QuotePreparePayload> | Fail {
  const payload = record(body);
  if (!payload || typeof payload.version_id !== "string" || !isUuid(payload.version_id)) {
    return { ok: false, error: QUOTE_MESSAGES.invalid };
  }

  const version = requiredVersion(payload.expected_row_version);
  if (!version.ok) {
    return version;
  }

  return {
    ok: true,
    data: {
      version_id: payload.version_id,
      expected_row_version: version.data,
    },
  };
}
